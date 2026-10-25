const crypto = require('crypto');
const cloudinary = require('../../config/cloudinary');
const Order = require('./order.model');
const ReturnRequest = require('./return.model');
const { z } = require('zod');
const service = require('./return.service');

async function requestRefund(paymentId, amount, orderNumber) {
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: Math.round(amount * 100), notes: { orderNumber } }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id) { const error = new Error('Payment provider could not process the refund.'); error.status = 502; throw error; }
  return body;
}

const imageMagic = (buffer) => buffer && (
  (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
  buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
  (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP')
);
const videoMagic = (buffer) => buffer && buffer.length > 12 && (buffer.subarray(4, 8).toString() === 'ftyp' || buffer.subarray(0, 4).toString() === 'RIFF');
const upload = (file, orderNumber) => new Promise((resolve, reject) => {
  cloudinary.assertConfigured();
  const resourceType = file.mimetype.startsWith('video/') ? 'video' : 'image';
  const stream = cloudinary.uploader.upload_stream({ folder: `return-proofs/${orderNumber}`, type: 'authenticated', resource_type: resourceType }, (error, result) => error ? reject(error) : resolve({ ...result, resourceType }));
  stream.end(file.buffer);
});
const requestNumber = () => `RR${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

exports.policy = async (req, res, next) => { try { res.json(await service.getSettings()); } catch (error) { next(error); } };

exports.create = async (req, res, next) => {
  const uploaded = [];
  try {
    const orderNumber = String(req.params.orderNumber).trim().toUpperCase();
    const order = await Order.findOne({ orderNumber, customerAccount: req.user._id });
    if (!order) return res.status(404).json({ message: 'Order details could not be verified.' });
    const settings = await service.getSettings();
    if (!service.isEligible(order, settings)) return res.status(409).json({ message: 'This order is not eligible for a return.' });
    const existing = await ReturnRequest.findOne({ order: order._id, status: { $in: service.OPEN_STATUSES } });
    if (existing) return res.status(409).json({ message: 'A return request is already open for this order.' });
    const reason = z.enum(service.DEFAULT_REASONS).parse(req.body.reason);
    if (!(settings.eligibleReasons || service.DEFAULT_REASONS).includes(reason)) return res.status(400).json({ message: 'That return reason is not currently accepted.' });
    const details = z.string().trim().min(20).max(3000).parse(req.body.details);
    const files = req.files || [];
    const images = files.filter((file) => file.fieldname === 'proof');
    const videos = files.filter((file) => file.fieldname === 'video');
    if (images.length < 2 || images.length > 6 || videos.length > 1 || images.some((file) => !imageMagic(file.buffer)) || videos.some((file) => !videoMagic(file.buffer))) {
      return res.status(400).json({ message: 'Upload 2 to 6 valid proof images and at most one valid video.' });
    }
    const proofs = [];
    for (const file of files) { const result = await upload(file, order.orderNumber); uploaded.push(result); proofs.push({ publicId: result.public_id, resourceType: result.resourceType, bytes: file.size }); }
    const request = await ReturnRequest.create({
      requestNumber: requestNumber(), order: order._id, orderNumber: order.orderNumber, customerPhone: order.customer.phone, customerAccount: req.user._id,
      reason, details, proofs, refundAmount: service.calculateRefundAmount(order, settings),
      returnChargeDeducted: settings.returnShippingMode === 'deduct_from_refund' ? Number(settings.returnShippingCharge || 0) : 0,
      statusHistory: [{ action: 'requested', detail: 'Return request submitted.' }],
    });
    res.status(201).json({ requestNumber: request.requestNumber, status: request.status, refundAmount: request.refundAmount });
  } catch (error) {
    await Promise.allSettled(uploaded.map((file) => cloudinary.uploader.destroy(file.public_id, { resource_type: file.resourceType, type: 'authenticated' })));
    next(error);
  }
};

exports.status = async (req, res, next) => {
  try {
    const request = await ReturnRequest.findOne({ requestNumber: String(req.params.requestNumber).toUpperCase(), customerAccount: req.user._id }).select('-proofs');
    if (!request) return res.status(404).json({ message: 'Return request could not be verified.' });
    res.json({ requestNumber: request.requestNumber, orderNumber: request.orderNumber, reason: request.reason, details: request.details,
      refundAmount: request.refundAmount, returnChargeDeducted: request.returnChargeDeducted, status: request.status,
      rejectionReason: request.rejectionReason, adminNote: request.adminNote, returnCourier: request.returnCourier, returnTracking: request.returnTracking,
      createdAt: request.createdAt, updatedAt: request.updatedAt, statusHistory: (request.statusHistory || []).map(({ action, at }) => ({ action, at })) });
  } catch (error) { next(error); }
};

exports.mine = async (req, res, next) => { try {
  const requests = await ReturnRequest.find({ customerAccount: req.user._id }).sort({ createdAt: -1 }).limit(100).select('-proofs -customerPhone -customerAccount -order').lean();
  res.json({ items: requests.map(({ requestNumber, orderNumber, reason, details, refundAmount, returnChargeDeducted, status, createdAt, updatedAt, statusHistory }) =>
    ({ requestNumber, orderNumber, reason, details, refundAmount, returnChargeDeducted, status, createdAt, updatedAt,
      statusHistory: (statusHistory || []).map(({ action, at }) => ({ action, at })) })) });
} catch (error) { next(error); } };

exports.list = async (req, res, next) => { try { res.json(await ReturnRequest.find({}).sort({ createdAt: -1 }).limit(200).select('-proofs')); } catch (error) { next(error); } };
exports.detail = async (req, res, next) => { try { const value = await ReturnRequest.findById(req.params.id).populate('order'); if (!value) return res.status(404).json({ message: 'Return request not found.' }); res.json(value); } catch (error) { next(error); } };

exports.action = async (req, res, next) => {
  try {
    const action = z.enum(['seen', 'approve', 'reject', 'received', 'inspection-accepted', 'inspection-rejected', 'refund']).parse(req.params.action);
    const request = await ReturnRequest.findById(req.params.id).populate('order');
    if (!request) return res.status(404).json({ message: 'Return request not found.' });
    if (action === 'reject' || action === 'inspection-rejected') z.string().trim().min(1).parse(req.body.reason);
    const transitions = {
      seen: ['requested'], approve: ['requested'], reject: ['requested', 'approved'],
      received: ['awaiting_return_shipment', 'return_in_transit', 'approved'],
      'inspection-accepted': ['received'], 'inspection-rejected': ['received'], refund: ['inspection_accepted'],
    };
    const nextStatus = { seen: 'requested', approve: 'approved', reject: 'rejected', received: 'received', 'inspection-accepted': 'inspection_accepted', 'inspection-rejected': 'inspection_rejected', refund: 'refund_pending' }[action];
    if (!(transitions[action] || []).includes(request.status)) return res.status(409).json({ message: 'Invalid return status transition.' });
    if (action === 'refund') {
      if (!request.order.razorpayPaymentId) return res.status(409).json({ message: 'No captured payment is available for refund.' });
      if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ message: 'Payment provider is not configured.' });
      const refund = await requestRefund(request.order.razorpayPaymentId, request.refundAmount, request.order.orderNumber);
      request.order.refundExpectedAmount = request.refundAmount; request.order.refundAmount = request.refundAmount;
      request.order.razorpayRefundId = refund.id; request.order.status = 'refund_pending'; request.order.paymentStatus = 'refund_pending'; request.order.refundRequestedAt = new Date(); await request.order.save();
    }
    if (action === 'seen') request.adminSeenAt = new Date();
    if (action === 'approve') request.status = 'awaiting_return_shipment';
    else request.status = nextStatus;
    if (req.body && req.body.reason) request.rejectionReason = String(req.body.reason).trim();
    if (req.body && req.body.note) request.adminNote = String(req.body.note).trim().slice(0, 2000);
    request.statusHistory.push({ action: request.status, actor: req.user._id, detail: req.body && (req.body.reason || req.body.note) || '' });
    await request.save(); res.json(request);
  } catch (error) { next(error); }
};

exports.validImage = imageMagic;
