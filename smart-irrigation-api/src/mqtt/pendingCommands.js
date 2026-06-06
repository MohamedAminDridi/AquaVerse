// In-memory queue of commands waiting for a (possibly sleeping) node's next wake.
// A duty-cycled node only listens ~8 s per wake, with its radio off in between,
// so a command published while it sleeps is lost. Instead we hold the command
// here and flush it the instant the node's telemetry arrives — that telemetry
// IS the proof the node just woke and opened its RX window. Reliable, and it
// needs no time-prediction (the deep-sleep timer drifts ±10%).
const q = new Map();   // device_id -> [{ topic, message, ts }]

// Queue a command. A newer command of the same `type` supersedes an older one
// (no point opening a valve twice), so the node always gets the latest intent.
exports.queue = (deviceId, topic, message) => {
  if (!deviceId) return;
  const list = q.get(deviceId) || [];
  const type = message && message.type;
  const kept = type ? list.filter((c) => c.message?.type !== type) : list;
  kept.push({ topic, message, ts: Date.now() });
  q.set(deviceId, kept.slice(-10));
};

// Publish + clear everything queued for this node. Call on its telemetry/wake.
exports.flush = (deviceId, publish) => {
  const list = q.get(deviceId);
  if (!list || !list.length) return 0;
  q.delete(deviceId);
  for (const c of list) publish(c.topic, c.message);
  return list.length;
};

// What's waiting (for the UI's "queued" indicator).
exports.pending = (deviceId) => (q.get(deviceId) || []).map((c) => ({ type: c.message?.type, ts: c.ts }));
exports.count   = (deviceId) => (q.get(deviceId) || []).length;
