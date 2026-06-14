import { create } from 'zustand';

// ── Live-state persistence ───────────────────────────────────────────────────
// The store is in-memory, so a refresh (or leaving and returning) loses the last
// telemetry — a problem for sleeping nodes, which only report on wake and would
// otherwise show blank for an entire sleep window. We mirror the live fields per
// farm to localStorage (debounced) and re-hydrate on seed. The sleep countdown is
// anchored to an absolute timestamp (slpStamp), so restoring it lets the countdown
// resume exactly where it was — no conflict, no reset.
const LIVE_KEY = (farmId) => `twin_live_${farmId}`;
// NOTE: `status` is intentionally NOT persisted — online/offline must always
// come from the backend (its sweep marks silent devices offline), otherwise a
// cached 'online' would survive a refresh with the hardware powered off.
const LIVE_FIELDS = [
  'soil', 'temp', 'hum', 'bat', 'bat_v', 'bat_ma', 'bat_mah', 'time_min',
  'charging', 'valve', 'valve_pct', 'pump', 'rssi', 'lastUpdate', 'wokeAt',
  'slpOn', 'slpAwk', 'slpNap', 'slpUp', 'slpStamp',
];
// How long a valve click stays in "opening…/closing…" before the UI gives up
// waiting: one node report interval (5 s) + 3 s backup margin. Telemetry that
// confirms the new state clears it sooner.
const VALVE_PENDING_MS = 5000 + 3000;

let _saveTimer = null;
function persistLive(get) {
  if (_saveTimer) return;                          // debounce a burst of telemetry
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    const { farmId, byId } = get();
    if (!farmId) return;
    const slim = {};
    for (const [id, d] of Object.entries(byId)) {
      const o = {};
      for (const k of LIVE_FIELDS) if (d[k] !== undefined) o[k] = d[k];
      slim[id] = o;
    }
    try { localStorage.setItem(LIVE_KEY(farmId), JSON.stringify(slim)); } catch { /* quota */ }
  }, 1500);
}

// Holds the live state of every device in the currently-viewed farm, keyed by
// device_id. Telemetry patches land here (NOT in React state) so the 3D Canvas
// can read values via useFrame without re-rendering the whole component tree.
//
// `positions` is kept here too so a single dragged marker (and its link) can
// re-render in isolation while the rest of the scene stays still.
export const useTwinStore = create((set, get) => ({
  farmId: null,      // farm currently seeded (used to key persisted live state)
  byId: {},          // { [device_id]: { ...device, soil, temp, hum, bat, status, valve, pump, zone, lastUpdate } }
  positions: {},     // { [device_id]: [x, 0, z] }  ground-plane layout
  custom: {},        // { [device_id]: { size, rot, color, label } }  per-plot customization
  zones: {},         // { [zoneName]: color }  irrigation-zone tints
  selectedId: null,  // device_id of the clicked node, or null
  weather: null,     // live Open-Meteo conditions for this farm (or null)
  weatherLocked: false, // true while a manual demo override is active (ignores live)
  // "Future Reality" overlay: real Open-Meteo daily forecast (today + next 3
  // days) and which day the twin is previewing. futureDay 0 = live/now,
  // 1..3 = that future day re-skinning the sky/weather/solar.
  forecast: [],      // [{ date, condition, tempMax, tempMin, precipProb, sunshineHours, solarScore, ... }]
  futureDay: 0,
  // Deep-sleep config per node (device_id → { enabled, intervalMin, daily, startTime, wakeTime, state }).
  // Populated by the Sleep layer's scheduler; read by the 3D sleep tags.
  sleepCfg: {},
  // ── AI Brain layer ──────────────────────────────────────────────────────
  aiEnabled: null,        // global edge-AI switch (null = not loaded yet)
  aiDecisions: [],        // newest-first ring of shadow DECISION records (≤100)
  // What-if lens: when active, verdict chips show what the model WOULD decide
  // under these simulated conditions instead of live data.
  whatIf: { active: false, soil: 30, temp: 25, hum: 60 },
  // Master feature switches for the 3D twin (toggled from the settings gear).
  // Deeply-nested components (crops/energy inside nodes) read these directly.
  features: {
    weather: true, crops: true, pipes: true, energy: true,
    labels: true, ground: true, signal: false,   // signal = Electromagnetic / Signal Spectrum mode
    innerPipes: false,   // per-node internal pipeline architecture (off by default; always shown in the Water layer)
    scenery: true,       // procedural environment: mountains, forest, lake, birds, fog
  },
  // "Two Worlds": digital = the invisible intelligence layer is revealed.
  // digitalLayer selects which hidden system: comms | water | ai | climate |
  // energy | prediction | biology.
  digital: false,
  digitalLayer: 'comms',
  // "All" layer: overlay several hidden systems at once, each toggleable like
  // the settings panel. Keys match digitalLayer ids.
  allLayers: { comms: true, water: true, energy: true, sleep: true, prediction: false, ai: false, climate: false, biology: false },
  // LoRa link health: per-device rolling window of telemetry seq numbers,
  // used to derive packet-loss % (gaps in seq) for the network diagnostic.
  linkStats: {},     // { [device_id]: { seqs: number[] } }
  // Real packet events for the comms layer's travelling pulses. Each genuine
  // telemetry RX (uplink) or command TX (downlink) stamps a timestamp+direction
  // here; SignalWave launches one moving point per event (dir -1 = node→gateway).
  packets: {},       // { [device_id]: { ts: number, dir: -1|1 } }
  live: false,       // socket connected?
  editMode: false,   // layout-edit (drag) mode on?
  dragging: false,   // a marker is currently being dragged

  // view / UX
  layers:  { links: true, labels: true, grid: true },  // toggled visibility
  colorBy: 'status', // 'status' | 'zone'  — what drives the plot fill colour
  topDown: false,    // orthographic top-down "map" view
  walk:    false,    // first-person walk mode (WASD + mouse-look, eye height)
  focus:   null,     // fly-to request { key, ts }  (ts retriggers same-key flights)

  // playback (24h replay) — frames: [{ ts, byId: { [deviceId]: { soil, temp, hum, bat } } }]
  playback: { active: false, playing: false, idx: 0, frames: [], from: null, interval: 'hour' },

  // Replace the whole device map (called once per farm load). Re-hydrates the
  // last-known live telemetry saved before a refresh/leave so sleeping nodes show
  // their last data immediately and the countdown resumes mid-cycle.
  seed: (devices, farmId = null) => set(() => {
    const byId = {};
    devices.forEach((d) => { byId[d.device_id] = d; });
    if (farmId) {
      try {
        const saved = JSON.parse(localStorage.getItem(LIVE_KEY(farmId)) || '{}');
        for (const [id, live] of Object.entries(saved)) {
          if (!byId[id]) continue;
          // NEVER restore `status` from cache — the backend's offline sweep is
          // authoritative. Restoring a stale 'online' made dead devices look
          // alive after a refresh with everything powered off.
          const { status: _drop, ...rest } = live;
          // Drop a stale sleep anchor (older than ~2 full duty cycles): without
          // fresh packets the countdown would resurrect from outdated data.
          const cycleSec = (rest.slpAwk || 60) + (rest.slpNap || 900);
          if (rest.slpStamp && Date.now() - rest.slpStamp > cycleSec * 2 * 1000) {
            delete rest.slpOn; delete rest.slpAwk; delete rest.slpNap;
            delete rest.slpUp; delete rest.slpStamp;
          }
          byId[id] = { ...byId[id], ...rest };
        }
      } catch { /* ignore corrupt cache */ }
    }
    return { byId, selectedId: null, farmId };
  }),

  // Pending valve intent per device. Instead of optimistically flipping the
  // state (which flip-flopped against late telemetry on a lossy LoRa link),
  // a click marks the device "opening…/closing…" and the button stays locked
  // until the node's REAL state confirms it — or the backup timeout expires
  // (node report interval + 3 s). The button changes exactly once.
  valvePending: {},   // { [device_id]: { want: 'open'|'closed', pct, ts, expires } }

  commandValve: (deviceId, open, pct) => set((s) => {
    if (!s.byId[deviceId]) return {};
    const now = Date.now();
    return { valvePending: { ...s.valvePending, [deviceId]: {
      want: open ? 'open' : 'closed', pct: open ? pct : 0,
      ts: now, expires: now + VALVE_PENDING_MS,
    } } };
  }),

  // Merge a partial update into one device. No-op if we don't know that device.
  apply: (deviceId, patch) => set((s) => {
    const prev = s.byId[deviceId];
    if (!prev) return {};
    const now = Date.now();
    // Detect a wake: a fresh report after a >20s silence means the node was
    // deep-sleeping and just woke. Stamp wokeAt so the UI can run the awake→
    // sleep / sleep→wake countdown for the duty cycle.
    const isReport = patch.soil !== undefined || patch.temp !== undefined || patch.bat !== undefined;
    const wokeAt = (isReport && prev.lastUpdate && now - prev.lastUpdate > 20000) ? now : prev.wokeAt;
    // Resolve a pending valve click: the node's REAL state matching the intent
    // (or the backup timeout passing) unlocks the button — exactly one change.
    let valvePending = s.valvePending;
    const pend = valvePending[deviceId];
    if (pend && ((patch.valve != null && patch.valve === pend.want) || now > pend.expires)) {
      valvePending = { ...valvePending };
      delete valvePending[deviceId];
    }
    persistLive(get);     // debounced mirror to localStorage (survives refresh)
    return { byId: { ...s.byId, [deviceId]: { ...prev, ...patch, wokeAt, lastUpdate: now } }, valvePending };
  }),

  setPositions: (map)       => set({ positions: map }),
  setPosition:  (key, pos)  => set((s) => ({ positions: { ...s.positions, [key]: pos } })),

  // Per-plot customization (size / rotation / color tint / crop label).
  setCustomMap: (map)        => set({ custom: map }),
  setCustom:    (key, patch) => set((s) => ({ custom: { ...s.custom, [key]: { ...s.custom[key], ...patch } } })),

  // Irrigation zones.
  setZones: (map) => set({ zones: map }),

  // view / UX setters
  toggleLayer: (name) => set((s) => ({ layers: { ...s.layers, [name]: !s.layers[name] } })),
  setColorBy:  (v)    => set({ colorBy: v }),
  setTopDown:  (v)    => set({ topDown: v }),
  setWalk:     (v)    => set({ walk: v }),
  requestFocus:(key)  => set({ focus: { key, ts: Date.now() } }),

  // playback
  setPlayback: (patch) => set((s) => ({ playback: { ...s.playback, ...patch } })),

  setWeather:       (w) => set({ weather: w }),
  setWeatherLocked: (v) => set({ weatherLocked: v }),
  setForecast:      (f) => set({ forecast: Array.isArray(f) ? f : [] }),
  setFutureDay:     (n) => set({ futureDay: n }),
  setSleepCfg: (deviceId, cfg) => set((s) => (deviceId ? { sleepCfg: { ...s.sleepCfg, [deviceId]: cfg } } : {})),
  setAiEnabled: (v) => set({ aiEnabled: v }),
  addAiDecision: (d) => set((s) => ({ aiDecisions: [d, ...s.aiDecisions].slice(0, 100) })),
  setAiDecisions: (list) => set({ aiDecisions: Array.isArray(list) ? list.slice(0, 100) : [] }),
  setWhatIf: (patch) => set((s) => ({ whatIf: { ...s.whatIf, ...patch } })),
  setFeature:    (k, v) => set((s) => ({ features: { ...s.features, [k]: v } })),
  toggleFeature: (k)    => set((s) => ({ features: { ...s.features, [k]: !s.features[k] } })),
  setDigital:      (v)  => set({ digital: v }),
  setDigitalLayer: (l)  => set({ digital: true, digitalLayer: l }),
  toggleAllLayer:  (k)  => set((s) => ({ allLayers: { ...s.allLayers, [k]: !s.allLayers[k] } })),
  // Record a telemetry packet's sequence number for link-quality stats.
  recordPacket: (deviceId, seq) => set((s) => {
    if (seq == null || !deviceId) return {};
    const prev = s.linkStats[deviceId]?.seqs || [];
    const last = prev.length ? prev[prev.length - 1] : null;
    // a much smaller seq means the node rebooted (seq restarts at 0) → reset window
    const base = last != null && seq < last - 5 ? [] : prev;
    const seqs = [...base, seq].slice(-80);
    return { linkStats: { ...s.linkStats, [deviceId]: { seqs } } };
  }),
  // Stamp a real packet event so the comms layer fires a travelling pulse.
  // dir: -1 = uplink (node → gateway, telemetry RX), 1 = downlink (command TX).
  firePacket: (deviceId, dir = -1) => set((s) => {
    if (!deviceId) return {};
    return { packets: { ...s.packets, [deviceId]: { ts: (typeof performance !== 'undefined' ? performance.now() : Date.now()), dir } } };
  }),
  select:      (deviceId) => set({ selectedId: deviceId }),
  setLive:     (v)        => set({ live: v }),
  setEditMode: (v)        => set({ editMode: v, dragging: false }),
  setDragging: (v)        => set({ dragging: v }),
  reset:       ()         => set({
    byId: {}, positions: {}, custom: {}, zones: {}, selectedId: null, valvePending: {},
    editMode: false, dragging: false, focus: null,
    weatherLocked: false, futureDay: 0, forecast: [],
    playback: { active: false, playing: false, idx: 0, frames: [], from: null, interval: 'hour' },
  }),
}));
