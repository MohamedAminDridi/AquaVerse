const Node    = require('../models/Node.model');
const Gateway = require('../models/Gateway.model');
const Command = require('../models/Command.model');
const { publish }  = require('../mqtt/mqttClient');
const pendingCommands = require('../mqtt/pendingCommands');
const topics       = require('../utils/mqttTopics');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');

const clampPercent = (p) => Math.max(0, Math.min(100, Math.round(Number(p) || 0)));

// Send a command now if the node was heard within its ~8 s listen window;
// otherwise queue it for delivery on the node's next wake (telemetry). Returns
// 'sent' or 'queued' so callers/UI can show the right state. Exported so the
// sleep cron and sleep endpoints reuse the same reliable delivery.
const LISTEN_WINDOW_MS = 9000;
function deliver(node, message) {
  const topic = topics.command(node.farm.toString(), node.device_id);
  const heard = node.last_seen && (Date.now() - new Date(node.last_seen).getTime() < LISTEN_WINDOW_MS);
  if (heard) { publish(topic, message); return 'sent'; }
  pendingCommands.queue(node.device_id, topic, message);
  return 'queued';
}
exports.deliverToNode = deliver;

// ───────────────────────────────────────────────────────────────────────────
// Shared-pump reconciler.
// One pump per farm, wired to the gateway / pump controller. The pump must run
// while ANY node's valve is open and stop only when EVERY valve is closed. We
// derive the desired pump state from the live count of open valves and publish
// ONE pump command to every gateway in the farm (only the pump-wired gateway
// acts on it; firmware also ignores redundant toggles). This is why opening a
// 2nd/3rd node never "re-pulses" an already-running pump, and closing one node
// no longer kills the pump while other nodes are still irrigating.
// ───────────────────────────────────────────────────────────────────────────
async function reconcileFarmPump(farmId) {
  const openValves = await Node.countDocuments({ farm: farmId, valve_state: 'open' });
  const on   = openValves > 0;
  const type = on ? 'pump_start' : 'pump_stop';

  const gateways = await Gateway.find({ farm: farmId }).select('device_id');
  gateways.forEach((gw) => {
    publish(topics.command(String(farmId), gw.device_id), {
      type, payload: { reason: 'valve-sync', openValves }, ts: Date.now(),
    });
  });

  // Reflect the shared pump state on every node so the UI agrees.
  await Node.updateMany({ farm: farmId }, { pump_state: on ? 'on' : 'off' });
  return { on, openValves, gateways: gateways.length };
}

// Log + publish a valve command to a single node, mirror its intended valve
// state, then reconcile the farm's shared pump.
async function issueValve(req, res, type) {
  const node = await Node.findById(req.params.nodeId);
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });

  // Opening carries a 0–100% servo position (100% = 90° at the node).
  let payload = req.body || {};
  if (type === 'valve_open') payload = { ...payload, percent: clampPercent(payload.percent ?? 100) };

  const cmd = await Command.create({
    node: node._id, farm: node.farm, type, payload,
    issuedBy: req.user._id, source: 'manual',
  });
  // Opening a valve keeps the node awake while it waters (a servo can't hold its
  // position in deep sleep), but the duty cycle is only PAUSED, not cancelled —
  // the firmware resumes sleep automatically once the valve closes. So we leave
  // node.sleep.enabled untouched here to stay in sync with the device.

  const delivery = deliver(node, {
    id: node.device_id,          // node firmware checks this to filter its own commands
    cmd_id: cmd._id.toString(), type, payload: cmd.payload, ts: Date.now(),
  });
  cmd.status = delivery === 'sent' ? 'sent' : 'queued';
  await cmd.save();

  // Mirror the intended valve state so the reconciler can count it.
  if (type === 'valve_toggle')      node.valve_state = node.valve_state === 'open' ? 'closed' : 'open';
  else                              node.valve_state = type === 'valve_open' ? 'open' : 'closed';
  node.valve_pct = node.valve_state === 'open' ? clampPercent(payload.percent ?? 100) : 0;
  await node.save();

  const pump = await reconcileFarmPump(node.farm);
  const note = delivery === 'queued'
    ? 'Queued — delivers on the node’s next wake'
    : `Command sent · pump ${pump.on ? 'running' : 'stopped'} (${pump.openValves} valve${pump.openValves === 1 ? '' : 's'} open)`;
  created(res, { command: cmd, pump, delivery }, note);
}

// Exported so the schedule cron can reuse the shared-pump reconciler.
exports.reconcileFarmPump = reconcileFarmPump;

exports.openValve   = asyncHandler((req, res) => issueValve(req, res, 'valve_open'));
exports.closeValve  = asyncHandler((req, res) => issueValve(req, res, 'valve_close'));
exports.toggleValve = asyncHandler((req, res) => issueValve(req, res, 'valve_toggle'));

// Manual pump override. The pump lives on the gateway / pump controller, so we
// publish straight to every gateway in the node's farm. Use sparingly — the
// reconciler will re-derive the pump from valve states on the next valve change.
async function manualPump(req, res, type) {
  const node = await Node.findById(req.params.nodeId);
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  const gateways = await Gateway.find({ farm: node.farm }).select('device_id');
  gateways.forEach((gw) => {
    publish(topics.command(node.farm.toString(), gw.device_id), {
      type, payload: { reason: 'manual' }, ts: Date.now(),
    });
  });
  const on = type === 'pump_start';
  await Node.updateMany({ farm: node.farm }, { pump_state: on ? 'on' : 'off' });
  created(res, { pump: { on } }, on ? 'Pump started' : 'Pump stopped');
}

exports.startPump = asyncHandler((req, res) => manualPump(req, res, 'pump_start'));
exports.stopPump  = asyncHandler((req, res) => manualPump(req, res, 'pump_stop'));

// ───────────────────────────────────────────────────────────────────────────
// Deep-sleep duty cycle. The node has no RTC, so the backend owns the calendar:
// it stores the per-node schedule and publishes timed sleep/wake commands (the
// daily-window cron in jobs/index.js fires them at startTime / wakeTime). The
// node just toggles its duty cycle on receipt. Commands carry an "id" so the
// gateway forwards them over LoRa (pump-style broadcasts without "id" don't).
// ───────────────────────────────────────────────────────────────────────────
function publishSleepCmd(node, type, payload = {}) {
  // Reliable: queues if the node is asleep, delivered on its next wake.
  return deliver(node, { id: node.device_id, type, payload, ts: Date.now() });
}

// 24h band schedule helpers. A band's interval applies from its start time until
// the next band's start (wrapping midnight). The node has no RTC, so the backend
// resolves the active band each minute and pushes the matching interval.
const hhmmToMin = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
// Resolve the active band's { awakeMin, sleepMin } for a minute-of-day, or null.
function currentBand(bands, mins) {
  if (!bands || !bands.length) return null;
  const parsed = bands.filter((b) => b && b.start)
    .map((b) => ({ m: hhmmToMin(b.start), awakeMin: b.awakeMin, sleepMin: b.sleepMin })).sort((a, b) => a.m - b.m);
  if (!parsed.length) return null;
  let cur = parsed[parsed.length - 1];        // covers midnight wrap before the first band
  for (const b of parsed) { if (b.m <= mins) cur = b; else break; }
  return cur;
}
exports.currentBand = currentBand;
exports.hhmmToMin = hhmmToMin;

// GET the node's sleep config.
exports.getSleep = asyncHandler(async (req, res) => {
  const node = await Node.findById(req.params.nodeId).select('sleep device_id name');
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  success(res, { sleep: node.sleep || {} });
});

const clampMin = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0.05, Math.min(1440, n)) : d; };

// PUT the node's sleep config (awake/sleep durations, optional bands, daily
// window). Pass `enabled` to also activate/deactivate the duty cycle now.
exports.setSleep = asyncHandler(async (req, res) => {
  const node = await Node.findById(req.params.nodeId);
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  const b = req.body || {};
  const s = node.sleep;
  if (Array.isArray(b.bands)) {
    s.bands = b.bands.filter((x) => x && x.start).map((x) => ({
      start: String(x.start), awakeMin: clampMin(x.awakeMin, 1), sleepMin: clampMin(x.sleepMin, 15),
    }));
  }
  if (b.awakeMin != null) s.awakeMin = clampMin(b.awakeMin, s.awakeMin);
  if (b.sleepMin != null) s.sleepMin = clampMin(b.sleepMin, s.sleepMin);
  if (b.daily    != null) s.daily    = !!b.daily;
  if (b.startTime)        s.startTime = String(b.startTime);
  if (b.wakeTime)         s.wakeTime  = String(b.wakeTime);

  let delivery;
  if (b.enabled != null) {
    s.enabled = !!b.enabled;
    s.state   = b.enabled ? 'sleeping' : 'awake';
    if (b.enabled) {
      const now  = new Date();
      const band = currentBand(s.bands, now.getHours() * 60 + now.getMinutes());
      const awake_min = band?.awakeMin ?? s.awakeMin ?? 1;
      const sleep_min = band?.sleepMin ?? s.sleepMin ?? 15;
      delivery = publishSleepCmd(node, 'sleep_now', { awake_min, sleep_min });
    } else {
      delivery = publishSleepCmd(node, 'wake', {});
    }
  }
  node.markModified('sleep');
  await node.save();
  created(res, { sleep: node.sleep, delivery },
    delivery === 'queued' ? 'Saved — applies on the node’s next wake' : 'Sleep config saved');
});

// Manual activate: turn the duty cycle on with the given awake/sleep durations.
exports.sleepNow = asyncHandler(async (req, res) => {
  const node = await Node.findById(req.params.nodeId);
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  const s = node.sleep;
  if (req.body?.awakeMin != null) s.awakeMin = clampMin(req.body.awakeMin, s.awakeMin);
  if (req.body?.sleepMin != null) s.sleepMin = clampMin(req.body.sleepMin, s.sleepMin);
  s.enabled = true; s.state = 'sleeping';
  node.markModified('sleep');
  await node.save();
  const delivery = publishSleepCmd(node, 'sleep_now', { awake_min: s.awakeMin, sleep_min: s.sleepMin });
  created(res, { sleep: node.sleep, delivery }, `Sleep on · awake ${s.awakeMin}m / sleep ${s.sleepMin}m`);
});

// Manual deactivate: command the node back to normal continuous (awake) mode.
exports.wakeNode = asyncHandler(async (req, res) => {
  const node = await Node.findById(req.params.nodeId);
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  node.sleep.enabled = false; node.sleep.state = 'awake';
  node.markModified('sleep');
  await node.save();
  const delivery = publishSleepCmd(node, 'wake', {});
  created(res, { sleep: node.sleep, delivery }, 'Sleep off — node staying awake');
});

exports.getCommands = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const filter = { node: req.params.nodeId };
  if (status) filter.status = status;
  const total    = await Command.countDocuments(filter);
  const commands = await Command.find(filter)
    .populate('issuedBy', 'name').sort({ createdAt: -1 })
    .skip((page - 1) * limit).limit(+limit);
  res.json({ success: true, data: commands, pagination: { page: +page, limit: +limit, total } });
});

exports.getCommandStatus = asyncHandler(async (req, res) => {
  const cmd = await Command.findOne({ _id: req.params.cmdId, node: req.params.nodeId })
    .populate('issuedBy', 'name');
  if (!cmd) return res.status(404).json({ success: false, message: 'Command not found' });
  success(res, { command: cmd });
});
