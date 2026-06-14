const mongoose = require('mongoose');

// One shadow-mode AI decision (F1). Written only when the decision CHANGES for
// a node (not every 5 s packet). `agree` = did the model match what the cloud/
// user was actually doing at that moment — the live audit the dashboard shows.
const decisionSchema = new mongoose.Schema({
  farm:         { type: mongoose.Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  deviceId:     { type: String, required: true, index: true },
  inputs:       { soil: Number, temp: Number, hum: Number, hour: Number },
  irrigate:     { type: Boolean, required: true },
  duration_s:   { type: Number, default: 0 },
  why:          { type: String },
  agree:        { type: Boolean, default: null },
  trust_score:  { type: Number, default: 1 },
  trust_reasons:[String],
  modelVersion: { type: String, default: 'v0-rules' },
  ts:           { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('Decision', decisionSchema);
