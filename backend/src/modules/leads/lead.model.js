const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },   // normalized +91...
  name: String,
  preferredContact: { type: String, enum: ['whatsapp', 'call', 'either'], default: 'either' },
  enquiryType: { type: String, enum: ['hold-request', 'callback', 'product-enquiry', 'repair'], default: 'callback' },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productSnapshot: { name: String, price: Number, slug: String },
  consent: {
    contactAllowed: { type: Boolean, required: true },
    marketingAllowed: { type: Boolean, default: false },
    purpose: String,
    policyVersion: String,
    capturedAt: Date,
    source: String,        // 'add-to-cart', 'product-page', 'homepage'
  },
  status: {
    type: String,
    enum: ['new', 'contacted', 'interested', 'follow-up', 'converted', 'lost'],
    default: 'new', index: true,
  },
  followUpDate: Date,
  notes: [{ text: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });

module.exports = mongoose.model('Lead', leadSchema);