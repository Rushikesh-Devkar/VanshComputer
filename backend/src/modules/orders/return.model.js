const mongoose = require('mongoose');

const proofSchema = new mongoose.Schema({
  publicId: { type: String, required: true },
  resourceType: { type: String, enum: ['image', 'video'], required: true },
  bytes: { type: Number, required: true, min: 1 },
}, { _id: false });

const returnSchema = new mongoose.Schema({
  requestNumber: { type: String, required: true, unique: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  orderNumber: { type: String, required: true, index: true },
  customerPhone: { type: String, required: true },
  reason: { type: String, required: true, enum: ['not_as_described', 'defective_or_not_working', 'damaged_in_transit', 'wrong_item'] },
  details: { type: String, required: true, minlength: 20, maxlength: 3000 },
  proofs: { type: [proofSchema], required: true, minlength: 2, maxlength: 7 },
  refundAmount: { type: Number, required: true, min: 0 },
  returnChargeDeducted: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['requested', 'approved', 'rejected', 'awaiting_return_shipment', 'return_in_transit', 'received', 'inspection_accepted', 'inspection_rejected', 'refund_pending', 'refunded', 'closed'], default: 'requested', index: true },
  statusHistory: { type: [new mongoose.Schema({ action: String, actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, detail: String, at: { type: Date, default: Date.now } }, { _id: false })], default: [] },
  adminNote: { type: String, default: '', maxlength: 2000 },
  rejectionReason: { type: String, default: '' },
  returnCourier: { type: String, default: '' },
  returnTracking: { type: String, default: '' },
  adminSeenAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

returnSchema.index({ order: 1 }, {
  unique: true,
  partialFilterExpression: { status: { $in: ['requested', 'approved', 'awaiting_return_shipment', 'return_in_transit', 'received', 'inspection_accepted', 'inspection_rejected', 'refund_pending'] } },
});

module.exports = mongoose.model('ReturnRequest', returnSchema);
