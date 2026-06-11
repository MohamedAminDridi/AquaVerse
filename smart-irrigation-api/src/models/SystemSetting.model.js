const mongoose = require('mongoose');

// Singleton-style key/value store for runtime system settings that must survive
// restarts (e.g. whether the cloud MQTT broker is currently enabled).
const systemSettingSchema = new mongoose.Schema({
  key:          { type: String, unique: true, required: true },
  cloudEnabled: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('SystemSetting', systemSettingSchema);
