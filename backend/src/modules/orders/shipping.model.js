const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  at: { type: Date, default: Date.now },
}, { _id: false });

const shippingSchema = new mongoose.Schema({
  _id: { type: String, default: 'maharashtra' },
  maharashtraCharge: { type: Number, min: 0, default: null },
    freeDeliveryEnabled: { type: Boolean, default: true },
  freeDeliveryMinimum: { type: Number, min: 0, default: null },
  freeDeliveryEndsAt: { type: Date, default: null },
  returnPolicyText: { type: String, default: '', maxlength: 2000 },
  returnsEnabled: { type: Boolean, default: false },
  returnWindowDays: { type: Number, min: 0, max: 90, default: null },
  eligibleReasons: { type: [String], default: ['not_as_described', 'defective_or_not_working', 'damaged_in_transit', 'wrong_item'] },
  returnShippingMode: { type: String, enum: ['customer_ships', 'deduct_from_refund'], default: 'customer_ships' },
  returnShippingCharge: { type: Number, min: 0, default: null },
  refundOriginalDelivery: { type: Boolean, default: false },
  refundProcessingDays: { type: Number, min: 0, max: 90, default: null },
  gstin: { type: String, default: '', maxlength: 20 },
  gstRate: { type: Number, min: 0, max: 100, default: null },
  gstCalculationEnabled: { type: Boolean, default: false },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  auditHistory: { type: [auditSchema], default: [] },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('ShippingSettings', shippingSchema);
