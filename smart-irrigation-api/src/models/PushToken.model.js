const mongoose = require('mongoose');

// One row per device that has agreed to receive alerts. The FCM token is the
// address; it is rotated by the OS, so `token` is unique and re-registering the
// same device simply updates the row rather than adding another.
const pushTokenSchema = new mongoose.Schema({
  token:    { type: String, required: true, unique: true, index: true },
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
  last_seen:{ type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('PushToken', pushTokenSchema);
