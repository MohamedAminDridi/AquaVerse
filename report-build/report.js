// AquaVerse — Final Year Project report generator (docx)
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, AlignmentType, LevelFormat, TableOfContents, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
} = require('docx');

const FIGS = path.join(__dirname, 'figs');

/* ── helpers ────────────────────────────────────────────────────────────── */
const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 120, line: 312 },
  alignment: AlignmentType.JUSTIFIED,
  ...opts.para,
  children: [new TextRun({ text, size: 22, font: 'Calibri', ...opts.run })],
});
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const BULLET = (t, bold = false) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 },
  children: [new TextRun({ text: t, size: 22, font: 'Calibri', bold })],
});
const FORMULA = (t) => new Paragraph({
  spacing: { before: 60, after: 60 }, indent: { left: 720 },
  shading: { fill: 'F1F5F9', type: ShadingType.CLEAR },
  children: [new TextRun({ text: t, size: 21, font: 'Consolas', color: '1E3A8A' })],
});
const CODE = (t) => new Paragraph({
  spacing: { after: 40 }, indent: { left: 560 },
  children: [new TextRun({ text: t, size: 19, font: 'Consolas', color: '334155' })],
});
const CAPTION = (t) => new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 60, after: 200 },
  children: [new TextRun({ text: t, size: 19, italics: true, color: '64748B', font: 'Calibri' })],
});

let figN = 0;
function FIG(file, caption, w = 600) {
  figN++;
  const img = fs.readFileSync(path.join(FIGS, file));
  // keep aspect from known generation sizes; approx via fixed ratios
  const ratios = { 'fig_architecture.png': 6.2/13, 'fig_uplink.png': 5.6/12, 'fig_valve.png': 6.4/12,
                   'fig_sleep.png': 4.6/12, 'fig_energy.png': 6.0/12.5, 'fig_lwt.png': 3.8/12, 'fig_deploy.png': 5.4/12.5 };
  const h = Math.round(w * (ratios[file] || 0.5));
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 }, children: [
      new ImageRun({ type: 'png', data: img, transformation: { width: w, height: h },
        altText: { title: caption, description: caption, name: file } }),
    ]}),
    CAPTION(`Figure ${figN} — ${caption}`),
  ];
}

const border = { style: BorderStyle.SINGLE, size: 2, color: 'CBD5E1' };
const borders = { top: border, bottom: border, left: border, right: border };
function TBL(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (text, isHead, w, i) => new TableCell({
    borders, width: { size: w, type: WidthType.DXA },
    shading: isHead ? { fill: '0E7490', type: ShadingType.CLEAR } : (i % 2 ? { fill: 'F8FAFC', type: ShadingType.CLEAR } : undefined),
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({
      text: String(text), size: 19, font: 'Calibri', bold: isHead, color: isHead ? 'FFFFFF' : '1E293B' })] })],
  });
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, j) => cell(h, true, widths[j])) }),
      ...rows.map((r, i) => new TableRow({ children: r.map((c, j) => cell(c, false, widths[j], i)) })),
    ],
  });
}
const SP = () => new Paragraph({ spacing: { after: 120 }, children: [] });

/* ── content ────────────────────────────────────────────────────────────── */
const children = [];

/* Cover */
children.push(
  new Paragraph({ spacing: { before: 2200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'FINAL YEAR PROJECT REPORT', size: 26, font: 'Calibri', color: '64748B', bold: true })] }),
  new Paragraph({ spacing: { before: 500 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'AquaVerse', size: 96, font: 'Calibri', bold: true, color: '0E7490' })] }),
  new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'A Smart Irrigation Platform with a Living 3D Digital Twin', size: 32, font: 'Calibri', color: '334155' })] }),
  new Paragraph({ spacing: { before: 120 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'LoRa wireless sensing · ESP32 firmware · Cloud IoT backend · Real-time 3D visualisation', size: 22, font: 'Calibri', italics: true, color: '64748B' })] }),
  new Paragraph({ spacing: { before: 2600 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Author: Mohamed Amine Dridi', size: 26, font: 'Calibri', bold: true })] }),
  new Paragraph({ spacing: { before: 80 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Academic year 2025 – 2026', size: 24, font: 'Calibri', color: '64748B' })] }),
);

/* Abstract */
children.push(
  H1('Abstract'),
  P('AquaVerse is a complete smart-irrigation platform built end-to-end for this project: from soldered hardware to a cloud-deployed web application. Battery-powered sensor nodes measure soil moisture, air temperature/humidity and their own energy state, and drive a servo water valve. They communicate over LoRa (433 MHz) with an ESP32 gateway that bridges the field to MQTT — either a local Mosquitto broker or HiveMQ Cloud over TLS, switchable with a single firmware flag. A Node.js backend ingests telemetry into MongoDB time-series collections, exposes a secured REST API and pushes realtime events over Socket.IO. The signature feature is the AquaVerse 3D digital twin: a living, navigable 3D mirror of the farm in which every plot, pipe, packet and watt is visualised, and from which the real field is controlled.'),
  P('Beyond visualisation, the project solves the hard problems of real low-power IoT: a deep-sleep duty cycle whose commands are queued and delivered inside the node’s brief listening window; a coulomb-counting battery gauge that survives deep sleep and accounts for unmeasurable sleep current; acknowledged valve commands with automatic retries over a lossy half-duplex radio link; instant offline detection through MQTT Last Will; and a dual-environment deployment in which localhost and the cloud (Netlify + Render + MongoDB Atlas + HiveMQ) operate on the same data simultaneously.'),
  P('Keywords: IoT, LoRa, ESP32, MQTT, digital twin, deep sleep, coulomb counting, React Three Fiber, Node.js, MongoDB.', { run: { italics: true, color: '475569' } }),
);

/* TOC */
children.push(
  H1('Table of Contents'),
  new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }),
);

/* 1 Introduction */
children.push(
  H1('1. General Introduction'),
  H2('1.1 Context and motivation'),
  P('Agriculture consumes roughly 70 % of the world’s fresh water, and a large share of it is wasted by irrigating on fixed timers rather than on the actual state of the soil. Smallholder farms rarely adopt precision-irrigation products because commercial systems are expensive, closed, and require connectivity that fields do not have. The motivation of this project is to prove that a complete, open, end-to-end precision irrigation platform can be built with accessible hardware (ESP32, LoRa RA-02 modules, hobby servos) while still offering an experience that exceeds commercial dashboards: a real-time 3D digital twin of the farm.'),
  H2('1.2 Problem statement'),
  P('The project must answer five engineering problems at once: (1) sensing and actuating in a field with no WiFi coverage, using a long-range, low-bandwidth radio; (2) surviving on battery for weeks, which demands aggressive deep sleep yet must keep the device commandable; (3) trustworthy state — the user interface must always reflect what the devices are really doing, even over a lossy link; (4) remote operation — the farmer must be able to monitor and control from anywhere, not only on the local network; and (5) comprehension — the system’s many invisible mechanisms (radio links, water flow, energy, schedules) must be made visible and understandable.'),
  H2('1.3 Objectives'),
  BULLET('Design and build the sensor node and gateway hardware, including the power chain (3S Li-ion + BMS + buck converter + current monitoring).'),
  BULLET('Develop node firmware: telemetry, valve actuation, a deep-sleep duty cycle, an energy gauge, and over-the-air updates through LoRa.'),
  BULLET('Develop gateway firmware bridging LoRa to MQTT, with a pump relay, instant offline signalling, and a local/cloud broker switch.'),
  BULLET('Develop the backend: ingestion, storage, REST API, realtime events, command queueing with acknowledgement and retry, schedulers.'),
  BULLET('Develop AquaVerse, the 3D digital twin web application, with full control of valves, pumps and sleep schedules.'),
  BULLET('Deploy the whole platform to the cloud (Netlify, Render, MongoDB Atlas, HiveMQ Cloud) while keeping local development functional.'),
  H2('1.4 Report structure'),
  P('Chapter 2 presents the global architecture. Chapters 3 and 4 cover hardware and the communication layer. Chapters 5 to 8 detail every feature of the node firmware, gateway firmware, backend and 3D twin — including the exact formulas and parameters used. Chapter 9 walks through the operating scenarios the system handles. Chapter 10 covers deployment, Chapter 11 validation and measured results, and Chapter 12 limitations and future work.'),
);

/* 2 Architecture */
children.push(
  H1('2. System Architecture'),
  P('AquaVerse follows a classic four-tier IoT architecture — device, gateway, platform, application — with one distinctive property: every tier exists in two interchangeable flavours (local and cloud), selected by configuration rather than by code changes.'),
  ...FIG('fig_architecture.png', 'Global architecture of the AquaVerse platform'),
  TBL(['Tier', 'Component', 'Technology', 'Role'], [
    ['Device', 'Sensor node', 'ESP32 + SX1278 (RA-02)', 'Measures soil/climate/energy, drives the valve, deep-sleeps'],
    ['Gateway', 'LoRa↔MQTT bridge', 'ESP32 + SX1278 + WiFi', 'Forwards packets both ways, drives the pump relay'],
    ['Transport', 'MQTT brokers', 'Mosquitto (LAN) + HiveMQ Cloud (TLS)', 'Publish/subscribe message bus; Last Will for liveness'],
    ['Platform', 'Backend API', 'Node.js, Express, Mongoose, MQTT.js, Socket.IO, node-cron', 'Ingestion, storage, REST, realtime, command queue, schedulers'],
    ['Storage', 'Database', 'MongoDB Atlas (time-series + documents)', 'Single source of truth shared by every deployment'],
    ['Application', 'AquaVerse UI', 'React 18, Vite, Zustand, react-three-fiber, Tailwind', '3D digital twin, dashboards, administration'],
  ], [1300, 1900, 3000, 3160]),
  SP(),
  H2('2.1 Data paths'),
  BULLET('Uplink: node → LoRa → gateway → MQTT → backend → MongoDB + Socket.IO → browser (Figure 2).'),
  BULLET('Downlink: browser → REST → backend → MQTT → gateway → LoRa → node, with acknowledgement and retries (Figure 3).'),
  BULLET('The backend connects to BOTH brokers simultaneously; the cloud connection can be enabled/disabled live from the Settings page and the choice is persisted in the database.'),
  H2('2.2 Design principles'),
  BULLET('The device is the source of truth: the UI never trusts its own optimism; every state shown is confirmed by telemetry echoed from the node.'),
  BULLET('Event-driven over time-predicted: commands for sleeping nodes are released by the node’s own wake packet, never by guessing its timer (which drifts ±10 %).'),
  BULLET('Degrade visibly, never silently: power cuts, lost packets and stale data are all surfaced in the UI within seconds.'),
);

/* 3 Hardware */
children.push(
  H1('3. Hardware Design'),
  H2('3.1 Sensor node'),
  TBL(['Component', 'Reference', 'Interface / pin', 'Purpose'], [
    ['MCU + radio', 'ESP32 DevKit + RA-02 (SX1278, 433 MHz)', 'SPI: NSS 5, DIO0 26, RST 14', 'Processing + LoRa link'],
    ['Soil moisture', 'Capacitive v1.2', 'ADC GPIO 32', 'Volumetric soil water (calibrated raw→%)'],
    ['Air sensor', 'DHT22', 'GPIO 4', 'Temperature + relative humidity'],
    ['Battery monitor', 'INA219', 'I²C: SDA 21, SCL 22 (0x40)', 'Bus voltage + signed current (shunt)'],
    ['Valve actuator', 'SG90-class servo', 'PWM GPIO 13, powered from 5 V rail', '0–100 % → 0–90° ball-valve opening'],
    ['Power', '3S Li-ion + BMS → LM2596 buck', '12 V → 5 V', 'Field power for ESP32 + servo'],
  ], [1700, 2700, 2500, 2460]),
  SP(),
  H2('3.2 Gateway'),
  TBL(['Component', 'Reference', 'Interface / pin', 'Purpose'], [
    ['MCU + radio', 'ESP32 + RA-02 (SX1278)', 'SPI: NSS 5, DIO0 26, RST 14', 'LoRa ↔ WiFi/MQTT bridge'],
    ['Pump relay', 'SRD-05VDC module', 'GPIO 27 (active HIGH)', 'Drives the shared irrigation pump'],
    ['Connectivity', 'WiFi (2.4 GHz)', '—', 'MQTT to Mosquitto (LAN) or HiveMQ Cloud (TLS)'],
  ], [1700, 2700, 2500, 2460]),
  SP(),
  H2('3.3 Power engineering lessons (measured failures and fixes)'),
  P('Two real failures shaped the final power design — both diagnosed from serial logs during this project:'),
  BULLET('Pump EMI: running the 5 V pump from the same supply as the gateway corrupted LoRa reception (RadioLib code −16). Fix: separate supply for the pump, common ground only.'),
  BULLET('Servo brown-out: powering the servo from the ESP32 board’s 5 V pin worked at full battery but crashed the node the instant the servo moved once the pack dropped to ~74 % (log evidence: an "alive" packet with uptime 0 and a sequence counter reset 70→0 about 1.2 s after valve_open). Fixes applied: (1) the servo is fed directly from the LM2596 output; (2) firmware ramps the servo 2° per 15 ms instead of slamming it, cutting inrush current; (3) a 470–1000 µF capacitor across the servo supply is recommended.'),
  P('General rule derived: motors and radios must never share a thin power path with the MCU; brown-out is a threshold phenomenon that hides at full charge and appears as the battery drains.'),
);

/* 4 Communication */
children.push(
  H1('4. Communication Layer'),
  H2('4.1 LoRa physical link'),
  TBL(['Parameter', 'Value', 'Rationale'], [
    ['Frequency', '433 MHz (RA-02)', 'License-free ISM band, good penetration'],
    ['Spreading factor', 'SF7', 'Shortest airtime (≈150 ms per packet) → smallest collision window'],
    ['Bandwidth / CR', '125 kHz / 4:5', 'Standard robust setting'],
    ['TX power', '14 dBm', 'Sufficient for farm range, battery-friendly'],
    ['Sync word', '0x12', 'Private network isolation'],
    ['Hard limit', '255 bytes/packet', 'Drove the compact telemetry schema (§4.2)'],
  ], [2300, 2600, 4460]),
  SP(),
  P('LoRa here is half-duplex: a node cannot receive while transmitting. With telemetry every 5 s (airtime ≈150 ms) the node is deaf ≈3 % of the time, which is why the downlink uses acknowledgement and retries (§7.4). The report interval must stay ≥5 s to preserve a usable listening window.'),
  H2('4.2 Compact telemetry schema'),
  P('Adding the sleep-cycle fields pushed the original packet to 261 bytes — past the 255-byte hard limit, observed as RadioLib error −4 on every transmit. The schema was therefore redesigned with 1–2 character keys, numeric booleans, and derived fields removed. Only "type" and "id" keep long names because the gateway routes on them.'),
  TBL(['Key', 'Meaning', 'Key', 'Meaning'], [
    ['s', 'soil moisture %', 'tm', 'minutes to empty/full'],
    ['t', 'temperature °C', 'c', 'charging flag (0/1)'],
    ['h', 'humidity %', 'q', 'sequence number (loss detection)'],
    ['b', 'battery SoC %', 'vp', 'valve % (0 ⇒ closed — state is derived)'],
    ['bv', 'battery volts', 'p', 'pump flag (0/1)'],
    ['bi', 'battery current mA', 'slp/awk/nap/up', 'sleep on / awake s / sleep s / s since wake'],
    ['bm', 'battery mAh remaining', '', ''],
  ], [900, 3760, 1400, 3300]),
  SP(),
  P('Result: 137 bytes awake, ~171 bytes in sleep mode — comfortably inside the limit. The backend accepts both the new compact keys and the legacy long keys, so mixed firmware versions keep working during rollouts.'),
  H2('4.3 MQTT topic contract'),
  TBL(['Topic', 'Direction', 'Content'], [
    ['farms/{farmId}/nodes/{id}/telemetry', 'uplink', 'compact telemetry + gateway-added rssi/snr'],
    ['farms/{farmId}/nodes/{id}/status', 'uplink', 'alive packets (fw version, uptime)'],
    ['farms/{farmId}/nodes/{id}/command', 'downlink', 'valve_open/close, sleep_now/config, wake, pump_*'],
    ['farms/{farmId}/nodes/{id}/ota', 'downlink', 'firmware update orders (LoRa FUOTA)'],
    ['farms/{farmId}/gateways/{id}/heartbeat', 'uplink', 'every 10 s: ip, wifi rssi, uptime, fw'],
    ['farms/{farmId}/gateways/{id}/status', 'both', 'birth ("online") + broker-published Last Will ("offline")'],
  ], [4300, 1300, 3760]),
  SP(),
  P('A hard lesson: the gateway firmware and the backend MUST agree on this contract exactly. An older gateway subscribed to farm/{id}/+/command (singular) while the backend published farms/…/nodes/…/command — commands silently never arrived. Any topic change requires reflashing the gateway.'),
  H2('4.4 Dual broker and TLS'),
  P('The gateway selects its broker with one compile-time flag (USE_CLOUD): plain MQTT to the LAN Mosquitto, or TLS (WiFiClientSecure, port 8883) to HiveMQ Cloud with username/password. The backend, by contrast, can listen to both brokers at the same time; its cloud connection is toggled at runtime from the Settings page and persisted. Publishing fans out to every connected broker, so the same code path serves both topologies. One operational rule applies: only one backend instance may process a given broker, otherwise every packet is handled twice (duplicate readings, competing schedulers).'),
);

/* 5 Node firmware */
children.push(
  H1('5. Node Firmware — Feature by Feature'),
  H2('5.1 Telemetry acquisition'),
  P('Every 5 s the node reads its sensors and transmits one compact packet. Soil moisture is converted from the raw 12-bit ADC reading by linear calibration between a measured dry value and wet value:'),
  FORMULA('soil% = clamp( (DRY_RAW − raw) / (DRY_RAW − WET_RAW) ) × 100'),
  P('DHT22 supplies temperature and humidity; a failed read skips the packet rather than sending NaN. Each packet carries a sequence number q so the platform can compute packet loss from gaps.'),

  H2('5.2 Energy monitoring — the battery gauge'),
  ...FIG('fig_energy.png', 'Energy measurement chain and the formulas implemented in firmware'),
  P('The INA219 measures pack voltage and signed current (positive = discharging). Two estimators are combined:'),
  H3('a) Voltage-based estimate (fallback and reseed)'),
  P('Open-circuit voltage is smoothed by an exponential moving average to reject load transients, then mapped linearly over the pack’s usable window (3S Li-ion: 9.0 V empty → 12.6 V full). A ±1 % dead-band stops the display flickering:'),
  FORMULA('V_ema ← V_ema + α·(V_oc − V_ema)            α = 0.18'),
  FORMULA('pct_v = clamp( (V_ema − 9.0) / (12.6 − 9.0) ) × 100'),
  H3('b) Coulomb counter (the real fuel gauge)'),
  P('Voltage alone is misleading (it rises under charge and sags under load), so the firmware integrates current into charge every second. At rest it slowly re-synchronises to the voltage estimate to cancel integration drift:'),
  FORMULA('mAh ← mAh − I_mA × Δt_h                    (discharge drains, charge fills)'),
  FORMULA('if |I| < 20 mA:   mAh ← mAh + 0.02·(mAh_v − mAh)     (rest re-sync)'),
  FORMULA('SoC% = mAh / CAPACITY × 100                 CAPACITY = pack mAh'),
  H3('c) Time remaining'),
  FORMULA('discharging (I > 5 mA):     t_min = mAh / I × 60          (to empty)'),
  FORMULA('charging   (I < −40 mA):    t_min = (CAP − mAh) / |I| × 60 (to full)'),
  H3('d) Sleep energy accounting'),
  P('During deep sleep the INA219 cannot be read, so the gauge would silently ignore everything consumed while asleep. Two mechanisms fix this: the charge counter lives in RTC memory (RTC_DATA_ATTR) so it survives the reboot that ends each sleep, and on every wake the firmware debits the assumed sleep consumption:'),
  FORMULA('on wake:   mAh ← mAh − DEEP_SLEEP_MA × nap_s / 3600        DEEP_SLEEP_MA = 0.5 mA'),
  H3('e) Projected life under a sleep schedule (computed in the UI)'),
  P('The dashboard projects how long the battery lasts on the CURRENT duty cycle by weighting the measured awake current with the assumed sleep current over one cycle:'),
  FORMULA('I_avg = (I_awake·T_awake + I_sleep·T_sleep) / (T_awake + T_sleep)'),
  FORMULA('life_min = mAh / I_avg × 60'),
  P('Example: 2000 mAh, 6.6 mA awake, 0.5 mA asleep, cycle 1 min awake / 15 min asleep → I_avg = (6.6·1 + 0.5·15)/16 ≈ 0.88 mA → ≈ 94 days, versus ≈12.6 days always-on: a 7.5× gain.'),

  H2('5.3 Valve actuation'),
  P('The valve maps percentage to servo angle linearly (100 % → 90°). After the brown-out incident (§3.3) the firmware never slams the servo; it ramps:'),
  FORMULA('angle = pct × 90 / 100        ramp: 2° per 15 ms  (full travel ≈ 0.7 s)'),
  BULLET('After executing any command the node immediately echoes a full telemetry packet — this echo is the acknowledgement the backend’s retry system waits for.'),
  BULLET('Opening a valve PAUSES the sleep timer (a powered-down ESP32 cannot hold a servo) without cancelling the schedule; sleep resumes automatically when the valve closes.'),

  H2('5.4 Deep-sleep duty cycle'),
  ...FIG('fig_sleep.png', 'The duty cycle: awake window, deep sleep, and what survives each transition'),
  P('The node alternates between an awake window (g_awakeSec — reporting and listening) and timer deep sleep (g_wakeIntervalSec — radio off, ≈µA). All cycle state lives in RTC memory. On boot the firmware distinguishes a timer wake from a real reset with esp_reset_reason(): only ESP_RST_DEEPSLEEP continues the cycle; a power-on or reflash starts awake with sleep disabled, so a technician never fights a sleeping board. Each packet carries the node’s own clock (up = seconds since wake), which the UI uses to display an accurate "sleeps in … / wakes in …" countdown re-synchronised on every packet. The awake-window check is underflow-guarded: command handlers may touch timestamps after the loop sampled millis(), and an unsigned subtraction there once produced an instant (wrong) sleep.'),
  P('Configuration commands (queued if the node is asleep): sleep_now {awake_min, sleep_min} activates the cycle; sleep_config updates durations; wake returns to continuous mode. A 24-hour band schedule (§7.6) lets the backend vary the durations across the day.'),

  H2('5.5 Firmware update over LoRa (FUOTA)'),
  P('The gateway downloads a firmware binary from the backend over HTTP(S), then streams it to the node in 200-byte LoRa chunks. Each chunk is ACKed or NACKed by the node (5 s timeout, 4 retransmissions); the node writes to the OTA partition and reboots into the new image on completion. During OTA the duty cycle and reporting are suspended.'),
);

/* 6 Gateway firmware */
children.push(
  H1('6. Gateway Firmware — Feature by Feature'),
  BULLET('Bidirectional bridge: every LoRa packet with type "telemetry"/"alive" is published on the matching MQTT topic with link metadata added (rssi, snr); every MQTT command whose payload carries an "id" is forwarded over LoRa.'),
  BULLET('Pump relay: farm-level pump_start/pump_stop broadcasts (no "id" field) actuate GPIO 27 directly and are not forwarded over LoRa.'),
  BULLET('Heartbeat every 10 s: ip, WiFi rssi, uptime, firmware version. (Reduced from 3 s — at 3 s the TLS publish workload was starving LoRa forwarding on a hotspot uplink.)'),
  BULLET('Instant liveness — MQTT Last Will: at connect the gateway registers {"status":"offline"} as its will; the broker publishes it itself ~1.5×keepalive (keepalive = 6 s → ≈9 s) after a power cut. A "birth" {"status":"online"} publish right after connecting flips the platform back instantly.'),
  BULLET('Local/cloud switch: one #define selects Mosquitto (plain :1883) or HiveMQ Cloud (WiFiClientSecure TLS :8883 with credentials); the OTA HTTP client switches to HTTPS in the same flag.'),
  BULLET('Self-OTA: the gateway can download and flash its own firmware from the backend (Update.h), reporting progress over the heartbeat topic.'),
);

/* 7 Backend */
children.push(
  H1('7. Backend — Feature by Feature'),
  H2('7.1 REST API surface'),
  TBL(['Area', 'Endpoints (prefix /api)', 'Highlights'], [
    ['Auth', 'auth/register · login · refresh · me', 'JWT access (15 min) + refresh (7 d); roles admin/manager/viewer'],
    ['Resources', 'farms · farms/:id/gateways · farms/:id/nodes · admin/users', 'CRUD + per-node 3D twin layout persistence'],
    ['Irrigation', 'nodes/:id/valve/open|close|toggle · pump/start|stop', 'percentage payload; shared-pump reconciliation'],
    ['Sleep', 'nodes/:id/sleep (GET/PUT) · sleep/now · sleep/wake', 'durations, 24 h bands, daily window; queue-aware delivery'],
    ['Data', 'nodes/:id/history · analytics/farms/:id/summary', '24 h hourly buckets from the time-series collection'],
    ['Alerts', 'alerts · farms/:id/alert-rules', 'engine evaluated on every telemetry packet'],
    ['Weather', 'weather/farms/:id (live + 3-day daily)', 'Open-Meteo, refreshed each 15 min, solar score'],
    ['OTA', 'ota/upload · ota/firmware · ota/download/:id', 'download route is deliberately public for ESP32 fetches'],
    ['System', 'system/broker (GET/PUT) · health', 'live cloud-broker toggle · public keep-alive endpoint'],
  ], [1500, 3900, 3960]),
  SP(),
  H2('7.2 Telemetry ingestion pipeline'),
  P('One handler does, in order: look the node up; flush its queued commands (the packet proves the radio is listening RIGHT NOW); normalise compact keys (accepting legacy names); derive valve state from vp; record the real valve state for the acknowledgement system; update the Node document; insert a SensorReading into the time-series collection; emit sensor:data and node:status over Socket.IO; evaluate the low-battery and user-defined alert rules.'),
  H2('7.3 Command queue for sleeping nodes'),
  P('A command published while the node sleeps is simply lost on air. Instead, the backend decides at issue time: if the node was heard within the last 9 s (its listening window), publish immediately; otherwise queue in memory. The queue obeys three rules:'),
  BULLET('Families — valve_open/valve_close/valve_toggle are mutually exclusive intents (likewise sleep_now/sleep_config/wake): queueing or sending one VOIDS any queued sibling, so a stale "close" can never fire right after a fresh "open". (This exact bug was observed: the valve opened then instantly closed.)'),
  BULLET('TTL 15 min — stale intent is never delivered: a two-hour-old close must not actuate at the next wake.'),
  BULLET('Flush on wake — the node’s first telemetry after sleeping releases everything inside its listening window. Event-driven, immune to timer drift.'),
  H2('7.4 Acknowledged valve commands (retry ladder)'),
  P('The downlink is lossy, so a single send is a coin flip. The node echoes its REAL valve state immediately after executing; the backend therefore waits 1.8 s for an echo matching the intent and re-publishes if absent — up to 4 retries. One retry loop exists per node, and a newer click cancels the older loop (newest intent wins), preventing a late "open" retry from re-opening a valve the user just closed. Spacing retries 1.8 s apart decorrelates them from the node’s 5 s transmit phase. With per-attempt loss p, failure probability falls to p⁵ (e.g. 50 % loss → ~3 % residual).'),
  H2('7.5 Shared pump reconciliation'),
  P('One pump serves the whole farm: it must run while ANY valve is open and stop only when ALL are closed. After every valve change the backend recounts open valves in the database and broadcasts one pump command to the farm’s gateways — idempotent by design, so opening a second valve never re-pulses an already-running pump.'),
  H2('7.6 Schedulers (cron)'),
  TBL(['Job', 'Period', 'What it does'], [
    ['Offline sweep', 'every 20 s (+ once 5 s after boot)', 'gateway silent > 35 s → offline; node > 30 s; SLEEPING node > 1.5×(awake+sleep)+60 s — sleepers are judged by their own cycle, not a fixed cutoff; pump flag cleared on offline'],
    ['Irrigation schedules', 'every minute', 'opens/closes valves on their weekly time windows'],
    ['Sleep band scheduler', 'every minute', 'resolves the active 24 h band and pushes new awake/sleep durations (the node has no real-time clock — the backend is its calendar)'],
    ['Daily sleep window', 'every minute', 'legacy night window: sleep_now at start, wake at end'],
    ['Weather refresh', 'every 15 min', 'Open-Meteo per farm → broadcast weather:update'],
    ['Keep-alive', 'every 10 min', 'self-ping /api/health so the free cloud host never idles out'],
  ], [2200, 2300, 4860]),
  SP(),
  H2('7.7 Security'),
  BULLET('JWT with short-lived access tokens and refresh rotation; role-based guards (admin/manager/viewer) and farm-scoped access.'),
  BULLET('Helmet headers, CORS allow-list (comma-separated env: localhost + Netlify origin), 500 req/15 min rate limit (health endpoint exempted).'),
  BULLET('Deliberate exception, documented: the OTA download route is public so bare ESP32 HTTP clients can fetch firmware.'),
);

/* 8 AquaVerse twin */
children.push(
  H1('8. AquaVerse — the 3D Digital Twin'),
  P('AquaVerse is the application’s identity: the farm is not a table of numbers but a navigable world. It is rendered with react-three-fiber (Three.js) at 60 fps; live values flow into a Zustand store that the render loop reads directly, so telemetry never re-renders the React tree.'),
  H2('8.1 The physical world (reality view)'),
  BULLET('Terrain plots per node — colour = state (green online, BLUE sleeping, red offline), soil disc moisture-tinted, furrows, corner posts in the owning gateway’s colour.'),
  BULLET('Crops: 20+ species; plants grow and wilt with live soil moisture.'),
  BULLET('Gateway and centrifugal pump models — the impeller spins only while the pump truly runs; water spray particles only while a valve is genuinely open.'),
  BULLET('Sky: real day/night cycle, sun/moon, live weather (clouds, rain, wind) from Open-Meteo or a demo override; neon "cyberpunk" self-illumination at night.'),
  BULLET('Drag-and-drop layout editing, per-plot customisation (size, rotation, colour, crop, label) — persisted server-side per node.'),
  H2('8.2 The digital layers (the invisible made visible)'),
  TBL(['Layer', 'Reveals'], [
    ['📡 Comms', 'real packet pulses (one moving point per actual uplink/downlink), RSSI-coloured links, live spectrum panel, packet-loss % derived from sequence-number gaps'],
    ['🌊 Water', 'pipe network gateway→plots + per-plot internal pipelines (comb/grid/loop/spiral) glowing under flow'],
    ['⚡ Energy', 'solar panel + battery per node, animated production/consumption flows, energy HUD'],
    ['💤 Sleep', 'per-node duty-cycle tags with live countdown, full schedule editor (durations + 24 h bands)'],
    ['🔮 Prediction', '3-day future overlay: the real forecast re-skins the sky, rain and solar potential of the whole scene'],
    ['🌐 All', 'composite layer: each sub-layer toggleable; per-node unified floating HUD (all metrics + valve control + hide chip)'],
  ], [1700, 7660]),
  SP(),
  H2('8.3 Truthful-state mechanisms (the UX engineering)'),
  BULLET('Pending lock: clicking Open/Close locks the button to "Opening…/Closing…" until the node’s echo confirms — or a backup timeout of report-interval + 3 s (= 8 s) expires. The button changes exactly once; double-clicks are impossible.'),
  BULLET('liveOn 60 s grace: valve/pump/spray displays treat a device as alive if heard within 60 s, so a brief offline blip (a burst of lost packets trips the 30 s sweep) cannot flap the UI; a genuinely dead device still falls to "off" after a minute.'),
  BULLET('Countdown anchored to the device’s clock: remaining = awk − (up + (now − t_packet)); the next packet re-synchronises it, and commands never reset it.'),
  BULLET('Persistence: last telemetry and sleep anchors are mirrored to localStorage per farm and re-hydrated on refresh — a sleeping node shows its last data immediately and its countdown resumes mid-cycle. Online/offline status is deliberately NOT restored: only the backend may claim a device is alive.'),
  H2('8.4 Other pages'),
  P('Dashboard (fleet stats + 7-day analytics), Farms, Gateways, Nodes, Users (admin), Alerts with acknowledgement, Analytics (farm → node → 24 h chart), OTA manager (upload, version list, push to device), Settings (live cloud-broker toggle with connection status), and a collapsible navigation shell.'),
);

/* 9 Scenarios */
children.push(
  H1('9. Operating Scenarios'),
  P('This chapter walks through every situation the platform is designed to handle, as validated on real hardware.'),
  H2('Scenario A — Normal monitoring'),
  ...FIG('fig_uplink.png', 'Telemetry uplink path (every 5 s)'),
  P('Steady state: a packet every 5 s travels node → gateway → broker → backend in well under a second; the 3D twin’s plots, HUDs and charts update live; the time-series collection accumulates history.'),
  H2('Scenario B — Opening a valve (with packet loss)'),
  ...FIG('fig_valve.png', 'Acknowledged valve command with the retry ladder'),
  P('The user picks a percentage; the button locks to "Opening…"; the command is sent and, if no echo returns within 1.8 s, re-sent up to four times. The node soft-ramps the servo, echoes vp:100, the pump reconciler starts the farm pump, and the button unlocks to "Close valve" — exactly one visual change even when several attempts were needed.'),
  H2('Scenario C — Commanding a sleeping node'),
  P('The node is mid-sleep, radio off. The backend queues the command (family rules + TTL). At the next wake the node’s first telemetry flushes the queue inside its 9 s listening window; the UI had honestly shown "Queued — delivers on next wake".'),
  H2('Scenario D — Gateway power cut'),
  ...FIG('fig_lwt.png', 'Last-Will timeline: unplug to red in ~9 seconds'),
  P('Pulling the gateway’s power leaves no chance to say goodbye — so the broker says it instead: the pre-registered Last Will fires ~9 s after the cut (1.5 × 6 s keepalive), the backend marks the gateway offline and the UI turns red. Plugging back in produces a birth message and an instant return to green. The 20 s sweep remains as a net for cases the will cannot cover (broker restart).'),
  H2('Scenario E — Node goes silent'),
  P('A normal node missing for 30 s is marked offline (and its pump claim cleared). A SLEEPING node is judged against its own cycle — offline only after 1.5×(awake+sleep)+60 s — so duty-cycle silence never false-alarms, while a sleeper that misses two wakes is genuinely flagged.'),
  H2('Scenario F — Valve during sleep mode'),
  P('Opening a valve on a duty-cycled node pauses sleep (the servo must stay powered) without cancelling the schedule; the countdown freezes honestly ("awake · watering"); closing the valve lets the cycle resume by itself. Earlier behaviour — open cancelling the schedule permanently — was identified from serial logs and corrected.'),
  H2('Scenario G — Conflicting clicks under lag'),
  P('Impatient repeated clicks once created command floods that arrived in delayed waves. Three defences now stack: the pending lock makes rapid re-clicks impossible; each new command voids queued siblings (families); and each new command cancels the previous retry loop (newest intent wins).'),
  H2('Scenario H — Node brown-out (failure case, diagnosed)'),
  P('Observed signature: valve opens, then 1.2 s later an "alive" packet with uptime 0 and the sequence counter reset — the servo’s inrush rebooted the ESP32, whose boot code drives the servo to 0°. No software command "closed" the valve; the logs proved it. Fixes: direct 5 V wiring, soft-ramp, capacitor (§3.3).'),
  H2('Scenario I — Browser refresh / return visit'),
  P('localStorage re-hydration restores the last telemetry and the sleep countdown mid-cycle; status is re-fetched fresh so a powered-off farm shows red within seconds (boot sweep runs 5 s after backend start).'),
  H2('Scenario J — Cloud and local in parallel'),
  P('Netlify+Render and localhost share one Atlas database, so both show identical data. The operating rule: one active backend per broker — the laptop’s cloud toggle stays OFF while Render is live, else every packet is processed twice.'),
  H2('Scenario K — Firmware update in the field'),
  P('Gateway: downloads from the backend and flashes itself. Node: receives the image over LoRa in ACKed 200-byte chunks (FUOTA) — no USB cable in the field.'),
);

/* 10 Deployment */
children.push(
  H1('10. Deployment'),
  ...FIG('fig_deploy.png', 'Cloud topology: Netlify + Render + Atlas + HiveMQ, with localhost coexisting'),
  TBL(['Concern', 'Local development', 'Cloud production'], [
    ['Frontend', 'Vite dev server :5173 (proxy → :5000)', 'Netlify (wicosmartirrigation), VITE_API_URL → Render'],
    ['Backend', 'nodemon on laptop', 'Render web service (render.yaml blueprint)'],
    ['Database', 'MongoDB Atlas (same!)', 'MongoDB Atlas — one source of truth for both'],
    ['Broker', 'Mosquitto :1883 (+ cloud via toggle)', 'HiveMQ Cloud TLS :8883 as the primary'],
    ['Gateway flag', 'USE_CLOUD 0', 'USE_CLOUD 1'],
    ['CORS', 'comma list covers both origins simultaneously', 'same env value'],
  ], [1700, 3700, 3960]),
  SP(),
  P('Render’s free tier idles services after 15 min without traffic, which would kill MQTT and the schedulers; a self-ping of the public /api/health every 10 min keeps it awake (the endpoint is mounted before the rate limiter and excluded from logs). Honest caveats recorded for production: the free tier’s disk is ephemeral (OTA uploads vanish on redeploy), the gateway’s TLS uses setInsecure() (encrypted but not certificate-verified), and a paid always-on tier is the correct choice once real crops depend on the system. The backend was also confirmed unsuitable for serverless hosting: it needs persistent MQTT, WebSockets and cron — a stateful process.'),
  P('Operational hygiene implemented for the cloud: production logs show only meaningful events (HTTP errors only, per-packet logs demoted to debug), environment is fully 12-factor (.env / Render dashboard), and migration from the local database to Atlas was performed with an idempotent upsert-by-_id script.'),
);

/* 11 Validation */
children.push(
  H1('11. Validation and Measured Results'),
  TBL(['Test', 'Evidence (serial / logs)', 'Result'], [
    ['Telemetry packet size', 'RadioLib error −4 at 261 B; clean TX after compaction', '137 B awake / ~171 B asleep — under the 255 B limit'],
    ['Duty cycle endurance', 'wake #N counters across timer wakes; "fresh start" on reflash', 'cycles indefinitely; reset semantics correct'],
    ['Countdown accuracy', 'UI countdown vs node "up" field', 're-synchronised every packet; commands no longer reset it'],
    ['Valve ACK retry', 'gateway log: cmd + retry:N; node echo vp', 'multi-click era ended; single click always lands (≤3–15 s on a lossy day)'],
    ['Brown-out diagnosis', 'alive uptime:0 + seq reset 70→0 1.2 s after open', 'root-caused to servo inrush; fixed in hardware + soft-ramp'],
    ['Last Will liveness', 'unplug → broker will → UI red', '≈9–10 s offline detection (was 1–2 min)'],
    ['Queue for sleepers', 'command queued → flushed on wake telemetry', 'delivered inside the 9 s listen window'],
    ['Battery accounting', 'batt=… mAh printed on each wake, persisted in RTC', 'sleep energy now debited; gauge survives sleep'],
    ['Cloud chain', 'Netlify → Render → HiveMQ → gateway → node', 'full remote valve actuation verified'],
  ], [2300, 3760, 3300]),
  SP(),
  P('Known open issues, stated honestly: the soil probe currently reads raw 0 (hardware fault — the platform’s core metric is a placeholder until replaced); downlink loss remains higher than RF theory predicts with strong circumstantial evidence pointing at servo electrical noise (the retry ladder masks it, the unplug-test will confirm it); the measured 6.6 mA awake current is suspiciously low and suggests the INA219 shunt does not see the whole circuit, which would skew the life projections; and the exposed development credentials (Atlas, HiveMQ) must be rotated before any defence demo.'),
);

/* 12 Limitations & future work */
children.push(
  H1('12. Limitations and Future Work'),
  H2('12.1 Limitations'),
  BULLET('Single node + single gateway validated; multi-node collision behaviour (ALOHA-style) is designed for but not yet measured at scale.'),
  BULLET('The command queue is in-memory: a backend restart drops queued intents (mitigated by TTL semantics and the UI’s truthful state).'),
  BULLET('The 3D twin is one ~4,300-line module — functional, but due for decomposition before the next major feature.'),
  BULLET('TLS without certificate pinning on the gateway; secrets hygiene incomplete (development credentials were exposed during the project).'),
  H2('12.2 Future work'),
  BULLET('Replace the soil probe and calibrate per-soil-type curves; add multi-depth probes per plot.'),
  BULLET('Closed-loop irrigation: let the alert-rule engine drive valves automatically from soil targets, with the 3D twin previewing the plan.'),
  BULLET('Real machine-learning soil forecasting (the API placeholder was removed during the final cleanup rather than shipped as fake).'),
  BULLET('LoRaWAN migration path for multi-gateway farms; downlink scheduling synchronised to each node’s wake calendar.'),
  BULLET('Persistent command queue (MongoDB-backed) and S3-class storage for OTA artefacts.'),
  BULLET('Mobile companion app reusing the Socket.IO contract.'),
);

/* 13 Conclusion */
children.push(
  H1('13. General Conclusion'),
  P('This project set out to prove that a serious precision-irrigation platform — long-range sensing, weeks of battery life, remote actuation, cloud operation — can be built end-to-end with accessible components, and that its complexity can be made not just manageable but visible. The result, AquaVerse, meets that bar: a farmer can stand anywhere in the world, open a web page, walk through a living 3D mirror of the field, watch real packets fly between real devices, and open a real valve with one click that is guaranteed to either happen or be honestly reported as failed.'),
  P('The deepest lessons were not in any framework but at the boundaries between domains: a 255-byte radio limit reshaping a JSON schema; a servo’s inrush current masquerading as a software bug; a half-duplex radio demanding acknowledgement semantics in a web backend; a sleeping microcontroller requiring the server to become its calendar and its mailbox. Engineering the truth — making the interface incapable of claiming more than the devices have confirmed — turned out to be the project’s defining discipline, and the one most worth carrying forward.'),
);

/* ── document ───────────────────────────────────────────────────────────── */
const doc = new Document({
  numbering: { config: [
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•',
      alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 620, hanging: 300 } } } }] },
  ]},
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 34, bold: true, font: 'Calibri', color: '0E7490' },
        paragraph: { spacing: { before: 280, after: 220 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 27, bold: true, font: 'Calibri', color: '155E75' },
        paragraph: { spacing: { before: 220, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 23, bold: true, font: 'Calibri', color: '334155' },
        paragraph: { spacing: { before: 160, after: 100 }, outlineLevel: 2 } },
    ],
  },
  sections: [{
    properties: { page: {
      size: { width: 11906, height: 16838 },              // A4
      margin: { top: 1300, right: 1250, bottom: 1300, left: 1250 },
    }},
    headers: { default: new Header({ children: [ new Paragraph({
      tabStops: [{ type: 'right', position: 9406 }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '0E7490', space: 2 } },
      children: [
        new TextRun({ text: 'AquaVerse — Smart Irrigation 3D Twin', size: 18, color: '64748B', font: 'Calibri' }),
        new TextRun({ text: '\tFinal Year Project 2025/26', size: 18, color: '64748B', font: 'Calibri' }),
      ]})]})},
    footers: { default: new Footer({ children: [ new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'Page ', size: 18, color: '64748B', font: 'Calibri' }),
        new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '64748B', font: 'Calibri' }),
        new TextRun({ text: ' / ', size: 18, color: '64748B', font: 'Calibri' }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '64748B', font: 'Calibri' }),
      ]})]})},
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(__dirname, '..', 'AquaVerse_Final_Year_Project_Report.docx');
  fs.writeFileSync(out, buf);
  console.log('WROTE', out, buf.length, 'bytes');
});
