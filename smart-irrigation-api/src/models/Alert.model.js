const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  farm:            { type: mongoose.Schema.Types.ObjectId, ref: 'Farm', required: true },
  node:            { type: mongoose.Schema.Types.ObjectId, ref: 'Node' },
  // Set when the alert is about the GATEWAY itself (offline, etc). Alerts about
  // a node carry `node` instead and are attributed to that node's gateway.
  gateway:         { type: mongoose.Schema.Types.ObjectId, ref: 'Gateway' },
  rule:            { type: mongoose.Schema.Types.ObjectId, ref: 'AlertRule' },
  type:            { type: String, default: 'threshold_breach' },
  severity:        { type: String, enum: ['info','warning','critical'], default: 'warning' },
  message:         { type: String, required: true },
  metric:          { type: String },
  value:           { type: Number },
  threshold:       { type: Number },
  acknowledged:    { type: Boolean, default: false },
  acknowledged_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acknowledged_at: { type: Date, default: null },
  // Free-text note captured at acknowledge time — why it was dismissed, what
  // was done about it. Shown in the acknowledged log next to who acked it.
  acknowledged_note: { type: String, default: '', trim: true, maxlength: 500 },
}, { timestamps: true });

alertSchema.index({ farm: 1, createdAt: -1 });
alertSchema.index({ acknowledged: 1 });
alertSchema.index({ gateway: 1, createdAt: -1 });

// Every new alert notifies the registered devices. Hooked on the model rather
// than at the four call sites that create alerts (the offline sweep for
// gateways and for nodes, the low-battery check, and the threshold rules) so a
// fifth source added later is covered without anyone remembering to wire it.
//
// Fire-and-forget: a push failure must never roll back or delay the alert — but
// it must never be SILENT either. An earlier version swallowed every error with
// a bare catch, which made "alert saved, no notification" impossible to explain.
const logger = require('../utils/logger');

// $locals is Mongoose's scratch space for one document's lifecycle. `isNew` is
// already false by the time a post-save hook runs, so it is captured here.
alertSchema.pre('save', function (next) {
  this.$locals.wasNew = this.isNew;
  next();
});

alertSchema.post('save', function (doc) {
  const isNew = doc?.$locals?.wasNew;
  logger.info(`Alert saved (${doc?.type}/${doc?.severity}) isNew=${isNew} — ${isNew ? 'notifying' : 'no notification (update)'}`);
  if (!isNew) return;

  setImmediate(async () => {
    try {
      const push = require('../services/push.service');
      if (typeof push.sendAlert !== 'function') {
        logger.error('Push: sendAlert is not available — module failed to load');
        return;
      }
      push.noteAlert(doc);
      const r = await push.sendAlert(doc);
      logger.info(`Push result: sent=${r?.sent ?? 0}${r?.skipped ? ' (skipped)' : ''}${r?.error ? ' error=' + r.error : ''}`);
    } catch (e) {
      logger.error(`Push: notify threw — ${e.stack || e.message}`);
    }
  });
});

module.exports = mongoose.model('Alert', alertSchema);
