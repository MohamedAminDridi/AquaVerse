// In-memory queue of commands waiting for a (possibly sleeping) node's next wake.
// A duty-cycled node only listens ~8 s per wake, with its radio off in between,
// so a command published while it sleeps is lost. Instead we hold the command
// here and flush it the instant the node's telemetry arrives — that telemetry
// IS the proof the node just woke and opened its RX window. Reliable, and it
// needs no time-prediction (the deep-sleep timer drifts ±10%).
const q = new Map();   // device_id -> [{ topic, message, ts }]

// Commands within a family are mutually exclusive intents: a new one VOIDS any
// queued sibling, not just the same type. Without this, a stale valve_close
// queued while the node slept would flush right after a fresh valve_open and
// slam the valve shut again ("opens then instantly closes").
const FAMILIES = [
  ['valve_open', 'valve_close', 'valve_toggle'],
  ['sleep_now', 'sleep_config', 'wake', 'sleep_off'],
];
const familyOf = (type) => FAMILIES.find((f) => f.includes(type)) || (type ? [type] : []);

// Queued commands older than this are stale intent — never deliver them.
const TTL_MS = 15 * 60 * 1000;

// Drop every queued command in `type`'s family. Called by deliver() BEFORE any
// send-or-queue, so the newest intent always wins regardless of path.
exports.clearFamily = (deviceId, type) => {
  if (!deviceId || !type) return;
  const list = q.get(deviceId);
  if (!list) return;
  const fam = familyOf(type);
  const kept = list.filter((c) => !fam.includes(c.message?.type));
  if (kept.length) q.set(deviceId, kept); else q.delete(deviceId);
};

// Queue a command, superseding anything in the same family.
exports.queue = (deviceId, topic, message) => {
  if (!deviceId) return;
  exports.clearFamily(deviceId, message?.type);
  const list = q.get(deviceId) || [];
  list.push({ topic, message, ts: Date.now() });
  q.set(deviceId, list.slice(-10));
};

// Publish + clear everything queued for this node. Call on its telemetry/wake.
// Silently drops entries past the TTL (a 2-hour-old "close" must not fire now).
exports.flush = (deviceId, publish) => {
  const list = q.get(deviceId);
  if (!list || !list.length) return 0;
  q.delete(deviceId);
  const now = Date.now();
  const fresh = list.filter((c) => now - c.ts < TTL_MS);
  for (const c of fresh) publish(c.topic, c.message);
  return fresh.length;
};

// What's waiting (for the UI's "queued" indicator).
exports.pending = (deviceId) => (q.get(deviceId) || []).map((c) => ({ type: c.message?.type, ts: c.ts }));
exports.count   = (deviceId) => (q.get(deviceId) || []).length;

// ── Real valve state echoes ──────────────────────────────────────────────────
// The node echoes a telemetry packet right after executing a command, carrying
// its REAL valve state. telemetryHandler records it here so the valve-command
// retry loop can tell "node confirmed" apart from "command lost over LoRa"
// (the DB can't be used for this — issueValve mirrors the INTENT there).
const lastValve = new Map();   // device_id -> { state: 'open'|'closed', ts }
exports.noteValve = (deviceId, state) => {
  if (deviceId && state) lastValve.set(deviceId, { state, ts: Date.now() });
};
exports.lastValve = (deviceId) => lastValve.get(deviceId);
