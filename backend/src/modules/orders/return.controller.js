const crypto = require('crypto');
const cloudinary = require('../../config/cloudinary');
const Order = require('./order.model');
const ReturnRequest = require('./return.model');
const { z } = require('zod');
const service = require('./return.service');
const { escapeHtml, appAdminUrl, notifyOwner } = require('../../utils/ownerAlerts');
const orderMails = require('../../utils/orderMails');

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
    const adminUrl = appAdminUrl();
    notifyOwner({
      subject: `New return request ${request.requestNumber}`,
      text: `New return request ${request.requestNumber}\nOrder: ${request.orderNumber}\nReason: ${request.reason}\nRefund amount: ₹${Number(request.refundAmount || 0).toLocaleString('en-IN')}\nAdmin: ${adminUrl}`,
      html: `<p><strong>New return request:</strong> ${escapeHtml(request.requestNumber)}</p><p>Order: ${escapeHtml(request.orderNumber)}<br>Reason: ${escapeHtml(request.reason)}<br>Refund amount: ${escapeHtml(`₹${Number(request.refundAmount || 0).toLocaleString('en-IN')}`)}</p><p><a href="${escapeHtml(adminUrl)}">Open admin</a></p>`,
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
    const settings = await service.getSettings();
    res.json({ requestNumber: request.requestNumber, orderNumber: request.orderNumber, reason: request.reason, details: request.details,
      refundAmount: request.refundAmount, returnChargeDeducted: request.returnChargeDeducted, status: request.status,
      rejectionReason: request.rejectionReason, adminNote: request.adminNote, returnCourier: request.returnCourier, returnTracking: request.returnTracking,
      returnAddress: settings.returnAddress || '', createdAt: request.createdAt, updatedAt: request.updatedAt,
      statusHistory: (request.statusHistory || []).map(({ action, at }) => ({ action, at })) });
  } catch (error) { next(error); }
};

exports.mine = async (req, res, next) => { try {
  const requests = await ReturnRequest.find({ customerAccount: req.user._id }).sort({ createdAt: -1 }).limit(100).select('-proofs -customerPhone -customerAccount -order').lean();
  res.json({ items: requests.map(({ requestNumber, orderNumber, reason, details, refundAmount, returnChargeDeducted, status, rejectionReason, adminNote, returnCourier, returnTracking, createdAt, updatedAt, statusHistory }) =>
    ({ requestNumber, orderNumber, reason, details, refundAmount, returnChargeDeducted, status, rejectionReason, adminNote, returnCourier, returnTracking, createdAt, updatedAt,
      statusHistory: (statusHistory || []).map(({ action, at }) => ({ action, at })) })) });
} catch (error) { next(error); } };

exports.shipment = async (req, res, next) => {
  try {
    const input = z.object({
      courier: z.string().trim().min(1).max(100),
      trackingNumber: z.string().trim().min(1).max(100),
    }).strict().parse(req.body);
    const request = await ReturnRequest.findOne({
      requestNumber: String(req.params.requestNumber).trim().toUpperCase(),
      customerAccount: req.user._id,
    });
    if (!request) return res.status(404).json({ message: 'Return request could not be verified.' });
    if (request.status !== 'awaiting_return_shipment') {
      return res.status(409).json({ message: 'This return is not awaiting shipment.' });
    }
    request.returnCourier = input.courier;
    request.returnTracking = input.trackingNumber;
    request.status = 'return_in_transit';
    request.statusHistory.push({
      action: 'return_in_transit',
      actor: req.user._id,
      detail: `${input.courier} · ${input.trackingNumber}`,
      at: new Date(),
    });
    await request.save();
    res.json({
      requestNumber: request.requestNumber,
      status: request.status,
      returnCourier: request.returnCourier,
      returnTracking: request.returnTracking,
    });
  } catch (error) { next(error); }
};

exports.list = async (req, res, next) => { try { res.json(await ReturnRequest.find({}).sort({ createdAt: -1 }).limit(200).select('-proofs')); } catch (error) { next(error); } };
exports.detail = async (req, res, next) => {
  try {
    const value = await ReturnRequest.findById(req.params.id).select('-proofs').populate('order');
    if (!value) return res.status(404).json({ message: 'Return request not found.' });
    const settings = await service.getSettings();
    const order = value.order;
    const deliveryDeducted = settings.refundOriginalDelivery ? 0 : Number(order.shippingCharge || 0);
    const returnChargeDeducted = value.returnChargeDeducted != null
      ? Number(value.returnChargeDeducted)
      : (settings.returnShippingMode === 'deduct_from_refund' ? Number(settings.returnShippingCharge || 0) : 0);
    res.json({
      ...value.toObject(),
      refundBreakdown: {
        orderTotal: Number(order.total || 0),
        deliveryDeducted,
        returnChargeDeducted,
        refundAmount: Number(value.refundAmount || 0),
      },
    });
  } catch (error) { next(error); }
};

exports.proofs = async (req, res, next) => {
  try {
    cloudinary.assertConfigured();
    const request = await ReturnRequest.findById(req.params.id).select('proofs');
    if (!request) return res.status(404).json({ message: 'Return request not found.' });
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    const proofs = (request.proofs || []).map((proof) => ({
      resourceType: proof.resourceType,
      bytes: proof.bytes,
      url: cloudinary.url(proof.publicId, {
        type: 'authenticated',
        resource_type: proof.resourceType,
        sign_url: true,
        secure: true,
        expires_at: expiresAt,
      }),
    }));
    res.json({ proofs, expiresAt });
  } catch (error) { next(error); }
};

const returnTransitions = {
  seen: ['requested', 'approved', 'rejected', 'awaiting_return_shipment', 'return_in_transit', 'received', 'inspection_accepted', 'inspection_rejected', 'refund_pending', 'refunded', 'closed'],
  approve: ['requested'],
  reject: ['requested', 'approved'],
  received: ['awaiting_return_shipment', 'return_in_transit', 'approved'],
  'inspection-accepted': ['received'],
  'inspection-rejected': ['received'],
  refund: ['inspection_accepted'],
  close: ['rejected', 'refunded', 'inspection_rejected'],
};

const nextReturnStatus = {
  seen: null,
  approve: 'awaiting_return_shipment',
  reject: 'rejected',
  received: 'received',
  'inspection-accepted': 'inspection_accepted',
  'inspection-rejected': 'inspection_rejected',
  refund: 'refund_pending',
  close: 'closed',
};

exports.returnTransitions = returnTransitions;
exports.nextReturnStatus = nextReturnStatus;

exports.action = async (req, res, next) => {
  try {
    const action = z.enum(['seen', 'approve', 'reject', 'received', 'inspection-accepted', 'inspection-rejected', 'refund', 'close']).parse(req.params.action);
    const request = await ReturnRequest.findById(req.params.id).populate('order');
    if (!request) return res.status(404).json({ message: 'Return request not found.' });
    if (action === 'reject' || action === 'inspection-rejected') z.string().trim().min(1).parse(req.body.reason);
    if (!(returnTransitions[action] || []).includes(request.status)) return res.status(409).json({ message: 'Invalid return status transition.' });
    if (action === 'refund') {
      if (!request.order.razorpayPaymentId) return res.status(409).json({ message: 'No captured payment is available for refund.' });
      if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ message: 'Payment provider is not configured.' });
      const refund = await requestRefund(request.order.razorpayPaymentId, request.refundAmount, request.order.orderNumber);
      request.order.refundExpectedAmount = request.refundAmount; request.order.refundAmount = request.refundAmount;
      request.order.razorpayRefundId = refund.id; request.order.status = 'refund_pending'; request.order.paymentStatus = 'refund_pending'; request.order.refundRequestedAt = new Date(); await request.order.save();
    }
    if (action === 'seen') request.adminSeenAt = new Date();
    if (['approve', 'reject', 'refund'].includes(action)) {
      const nextStatus = nextReturnStatus[action];
      const $set = { status: nextStatus };
      if (req.body && req.body.reason) $set.rejectionReason = String(req.body.reason).trim();
      if (req.body && req.body.note) $set.adminNote = String(req.body.note).trim().slice(0, 2000);
      const updated = await ReturnRequest.findOneAndUpdate(
        { _id: request._id, status: request.status },
        { $set, $push: { statusHistory: { action: nextStatus, actor: req.user._id, detail: req.body && (req.body.reason || req.body.note) || '', at: new Date() } } },
        { new: true }
      );
      if (!updated) return res.status(409).json({ message: 'Return status changed. Reload and try again.' });
      if (action === 'approve') orderMails.sendReturnStatus(updated, request.order, 'approved');
      if (action === 'reject') orderMails.sendReturnStatus(updated, request.order, 'rejected', $set.rejectionReason || '');
      if (action === 'refund') orderMails.sendReturnStatus(updated, request.order, 'refund_pending');
      return res.json(updated);
    }
    if (nextReturnStatus[action]) request.status = nextReturnStatus[action];
    if (req.body && req.body.reason) request.rejectionReason = String(req.body.reason).trim();
    if (req.body && req.body.note) request.adminNote = String(req.body.note).trim().slice(0, 2000);
    request.statusHistory.push({ action: request.status, actor: req.user._id, detail: req.body && (req.body.reason || req.body.note) || '' });
    await request.save(); res.json(request);
  } catch (error) { next(error); }
};

exports.validImage = imageMagic;
