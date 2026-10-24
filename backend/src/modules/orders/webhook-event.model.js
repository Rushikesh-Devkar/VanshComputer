const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema({
  _id: { type: String },
  event: { type: String, required: true },
  status: { type: String, enum: ['processing', 'processed'], default: 'processing', required: true },
  receivedAt: { type: Date, default: Date.now },
}, { versionKey: false });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
