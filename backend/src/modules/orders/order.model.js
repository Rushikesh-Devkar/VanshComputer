const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  slug: { type: String, required: true },
  name: { type: String, required: true },
  sku: { type: String, required: true },
  hsnCode: { type: String, default: '' },
  type: { type: String, enum: ['new', 'refurbished'], required: true },
  warrantyMonths: { type: Number, default: 0 },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  originalPrice: { type: Number, min: 1, default: null },
  lineTotal: { type: Number, required: true, min: 0 },
  imageUrl: { type: String, default: '' },
}, { _id: false });

const addressSchema = new mongoose.Schema({
  line1: { type: String, required: true },
  line2: { type: String, default: '' },
  city: { type: String, required: true },
  district: { type: String, required: true },
  state: { type: String, required: true, default: 'Maharashtra' },
  pinCode: { type: String, required: true },
}, { _id: false });

const auditSchema = new mongoose.Schema({
  action: { type: String, required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  detail: { type: String, default: '' },
  at: { type: Date, default: Date.now },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  checkoutRequestId: { type: String, unique: true, sparse: true, select: false },
  customer: {
    name: { type: String, required: true },
    phone: { type: String, required: true, index: true },
    email: { type: String, default: '' },
    gstin: { type: String, default: '' },
  },
  address: { type: addressSchema, required: true },
  items: { type: [orderItemSchema], required: true },
  subtotal: { type: Number, required: true, min: 0 },
  discount: { type: Number, required: true, default: 0, min: 0 },
  shippingCharge: { type: Number, required: true, min: 0 },
  shippingRuleSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  total: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'INR' },
  taxStatus: { type: String, enum: ['not_configured', 'not_applicable'], default: 'not_configured' },
  taxSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'payment_failed', 'cancelled', 'expired', 'refund_pending', 'refund_review', 'refunded', 'refund_failed'], default: 'pending_payment', index: true },
  paymentStatus: { type: String, enum: ['created', 'authorized', 'captured', 'failed', 'expired', 'refund_pending', 'refund_review', 'refunded', 'refund_failed'], default: 'created', index: true },
  paymentProvider: { type: String, default: 'razorpay' },
  razorpayOrderId: { type: String, sparse: true, unique: true },
  accessTokenHash: { type: String, select: false },
  razorpayPaymentId: { type: String, default: '' },
  razorpayRefundId: { type: String, default: '' },
  refundRequestedAt: { type: Date, default: null },
  reservationExpiresAt: { type: Date, required: true, index: true },
  courierName: { type: String, default: '' },
  trackingNumber: { type: String, default: '' },
  statusHistory: { type: [auditSchema], default: [] },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Order', orderSchema);
