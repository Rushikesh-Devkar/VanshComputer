const crypto = require('crypto');
const { z } = require('zod');
const Order = require('./order.model');
const WebhookEvent = require('./webhook-event.model');
const { itemsSchema, addressSchema, quoteAddressSchema, customerSchema, trackingSchema } = require('./schemas');
const { normalizeIndianPhone } = require('../../utils/phone');
const service = require('./order.service');

const reservationMinutes = () => Math.min(60, Math.max(5, Number(process.env.PAYMENT_RESERVATION_MINUTES) || 15));
const gatewayReady = () => process.env.PAYMENT_MODE === 'test'
  && /^rzp_test_[A-Za-z0-9]+$/.test(process.env.RAZORPAY_KEY_ID || '')
  && !!process.env.RAZORPAY_KEY_SECRET && !!process.env.RAZORPAY_WEBHOOK_SECRET
  && !/replace|placeholder|your_/i.test(process.env.RAZORPAY_KEY_ID || '')
  && !/replace|placeholder|your_/i.test(process.env.RAZORPAY_KEY_SECRET || '')
  && !/replace|placeholder|your_/i.test(process.env.RAZORPAY_WEBHOOK_SECRET || '')
  && !/^rzp_live_/i.test(process.env.RAZORPAY_KEY_ID || '');

async function razorpayRequest(path, payload) {
  let response;
  try {
    response = await fetch('https://api.razorpay.com/v1' + path, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify(payload),
    });
  } catch (_) {
    const error = new Error('Payment provider response is uncertain. Keep the order number and contact support before retrying.'); error.status = 502; error.uncertain = true; throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Payment provider could not process the request. Please try again later.');
    error.status = 502;
    throw error;
  }
  return data;
}

exports.verifySignature = (message, signature, secret) => {
  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const a = Buffer.from(expected, 'hex'), b = Buffer.from(signature || '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

exports.quote = async (req, res, next) => {
  try {
    const input = z.object({ items: itemsSchema, address: quoteAddressSchema }).strict().parse(req.body);
    const quote = await service.priceQuote(input.items, input.address);
    const { taxSnapshot, ...displayQuote } = quote;
    res.json({ ...displayQuote, currency: 'INR', taxStatus: 'not_configured' });
  } catch (error) { next(error); }
};

function paymentOrderPayload(order, accessToken, pendingProviderReconciliation = false) {
  return {
    orderNumber: order.orderNumber, status: order.status, amount: Math.round(order.total * 100), currency: order.currency,
    razorpayOrderId: order.razorpayOrderId || '', accessToken, keyId: process.env.RAZORPAY_KEY_ID,
    customer: { name: order.customer.name, email: order.customer.email, phone: order.customer.phone },
    total: order.total, reservationExpiresAt: order.reservationExpiresAt,
    items: order.items.map((item) => ({ name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, warrantyMonths: item.warrantyMonths })),
    pendingProviderReconciliation,
  };
}

exports.create = async (req, res, next) => {
  let order, accessToken, checkoutRequestId;
  try {
    if (!gatewayReady()) return res.status(503).json({ message: 'Online payment is temporarily unavailable while the store completes Razorpay Test Mode and webhook setup. No order or payment has been created.' });
    const input = z.object({ customer: customerSchema, address: addressSchema, items: itemsSchema, expectedTotal: z.number().finite().nonnegative(), checkoutRequestId: z.string().uuid(), accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(req.body);
    accessToken = input.accessToken;
    checkoutRequestId = input.checkoutRequestId;
    const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    const prior = await Order.findOne({ checkoutRequestId }).select('+checkoutRequestId +accessTokenHash');
    if (prior) {
      if (prior.accessTokenHash !== accessTokenHash) return res.status(409).json({ message: 'Checkout request could not be verified.' });
      return res.status(prior.razorpayOrderId ? 200 : 202).json(paymentOrderPayload(prior, accessToken, !prior.razorpayOrderId));
    }
    const phone = normalizeIndianPhone(input.customer.phone);
    if (!phone) return res.status(400).json({ message: 'Enter a valid Indian mobile number.' });
    const address = { ...input.address, state: 'Maharashtra' };
    const reserved = await service.reserveAndCreate({
      customer: { ...input.customer, phone }, address,
      items: input.items, expectedTotal: input.expectedTotal, reservationMinutes: reservationMinutes(), accessTokenHash, checkoutRequestId,
    });
    order = reserved.order;
    const gatewayOrder = await razorpayRequest('/orders', {
      amount: Math.round(reserved.quote.total * 100), currency: 'INR', receipt: order.orderNumber,
      notes: { orderNumber: order.orderNumber },
    });
    if (!gatewayOrder.id || gatewayOrder.amount !== Math.round(reserved.quote.total * 100) || gatewayOrder.currency !== 'INR') {
      const error = new Error('Payment provider returned an invalid order. Please contact the store.'); error.status = 502; throw error;
    }
    order.razorpayOrderId = gatewayOrder.id;
    order.statusHistory.push({ action: 'payment_order_created', detail: 'Razorpay test order created.' });
    try { await order.save(); }
    catch (error) { error.uncertain = true; throw error; }
    res.status(201).json(paymentOrderPayload(order, accessToken));
  } catch (error) {
    if (error.code === 11000 && checkoutRequestId) {
      const prior = await Order.findOne({ checkoutRequestId }).select('+checkoutRequestId +accessTokenHash');
      const hash = accessToken && crypto.createHash('sha256').update(accessToken).digest('hex');
      if (prior && prior.accessTokenHash === hash) return res.status(prior.razorpayOrderId ? 200 : 202).json(paymentOrderPayload(prior, accessToken, !prior.razorpayOrderId));
    }
    if (order && !error.uncertain) await service.releaseReservation(order._id, 'payment_failed').catch(() => console.error('Reservation rollback failed.'));
    next(error);
  }
};

exports.receipt = async (req, res, next) => {
  try {
    const input = z.object({ accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(req.body);
    const hash = crypto.createHash('sha256').update(input.accessToken).digest('hex');
    const order = await Order.findOne({ orderNumber: req.params.orderNumber, accessTokenHash: hash })
      .select('+accessTokenHash orderNumber customer.name address items subtotal discount shippingCharge total currency status paymentStatus razorpayPaymentId createdAt reservationExpiresAt courierName trackingNumber').lean();
    if (!order) return res.status(404).json({ message: 'Order details could not be verified.' });
    res.json({ orderNumber: order.orderNumber, customer: { name: order.customer.name }, address: order.address,
      items: order.items, subtotal: order.subtotal, discount: order.discount, shippingCharge: order.shippingCharge,
      total: order.total, currency: order.currency, status: order.status, paymentStatus: order.paymentStatus,
      paymentId: order.paymentStatus === 'captured' ? order.razorpayPaymentId : '', createdAt: order.createdAt,
      reservationExpiresAt: order.reservationExpiresAt, courierName: order.courierName, trackingNumber: order.trackingNumber });
  } catch (error) { next(error); }
};

const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(5).max(100),
  razorpay_payment_id: z.string().min(5).max(100),
  razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i),
}).strict();
exports.verifyPayment = async (req, res, next) => {
  try {
    if (!gatewayReady()) return res.status(503).json({ message: 'Test payment is not configured.' });
    const input = verifyPaymentSchema.parse(req.body);
    const order = await Order.findOne({ orderNumber: req.params.orderNumber, razorpayOrderId: input.razorpay_order_id });
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (!exports.verifySignature(`${order.razorpayOrderId}|${input.razorpay_payment_id}`, input.razorpay_signature, process.env.RAZORPAY_KEY_SECRET)) {
      return res.status(400).json({ message: 'Payment signature could not be verified.' });
    }
    await Order.updateOne({ _id: order._id, status: 'pending_payment', reservationExpiresAt: { $gt: new Date() } }, {
      $set: { razorpayPaymentId: input.razorpay_payment_id, paymentStatus: 'authorized' },
      $push: { statusHistory: { action: 'payment_signature_verified', detail: 'Awaiting verified payment webhook.' } },
    });
    const current = await Order.findById(order._id).select('orderNumber status paymentStatus');
    res.json({ orderNumber: current.orderNumber, status: current.status, paymentStatus: current.paymentStatus, message: 'Payment response verified. Final confirmation follows the payment provider webhook.' });
  } catch (error) { next(error); }
};

async function flagCaptureForRefund(order, paymentId, action, detail) {
  let current = await Order.findById(order._id).select('status');
  if (current && current.status === 'pending_payment') {
    await service.releaseReservation(order._id, 'expired');
    current = await Order.findById(order._id).select('status');
  }
  if (!current || !['expired', 'payment_failed', 'cancelled'].includes(current.status)) return;
  await Order.updateOne({ _id: order._id, status: current.status }, {
    $set: { status: 'refund_pending', paymentStatus: 'refund_pending', ...(paymentId ? { razorpayPaymentId: paymentId } : {}) },
    $push: { statusHistory: { action, detail, at: new Date() } },
  });
}

exports.webhook = async (req, res, next) => {
  let claimedEventId = null;
  try {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).send('Webhook not configured');
    if (!Buffer.isBuffer(req.body)) return res.status(400).send('Invalid webhook body');
    const signature = req.get('x-razorpay-signature') || '';
    const eventId = req.get('x-razorpay-event-id') || '';
    if (!eventId || !exports.verifySignature(req.body, signature, process.env.RAZORPAY_WEBHOOK_SECRET)) return res.status(400).send('Invalid webhook signature');
    const event = JSON.parse(req.body.toString('utf8'));
    const eventName = event.event;
    try {
      await WebhookEvent.create({ _id: eventId, event: eventName, status: 'processing' });
      claimedEventId = eventId;
    } catch (error) {
      if (error.code !== 11000) throw error;
      const prior = await WebhookEvent.findById(eventId).lean();
      if (prior && prior.status === 'processed') return res.json({ received: true, duplicate: true });
      if (prior && prior.status === 'processing' && prior.receivedAt < new Date(Date.now() - 2 * 60 * 1000)) {
        const reclaimed = await WebhookEvent.findOneAndUpdate(
          { _id: eventId, status: 'processing', receivedAt: prior.receivedAt },
          { $set: { receivedAt: new Date(), event: eventName } }, { new: true }
        );
        if (reclaimed) { claimedEventId = eventId; }
        else return res.status(503).send('Webhook event is being processed; retry later');
      } else return res.status(503).send('Webhook event is being processed; retry later');
    }
    const entity = event.payload && event.payload.payment && event.payload.payment.entity;
    const refundEntity = event.payload && event.payload.refund && event.payload.refund.entity;
    const gatewayOrderId = entity && entity.order_id || event.payload && event.payload.order && event.payload.order.entity && event.payload.order.entity.id;
    const paymentId = entity && entity.id || event.payload && event.payload.order && event.payload.order.entity && event.payload.order.entity.payment_id || refundEntity && refundEntity.payment_id;
    const order = gatewayOrderId ? await Order.findOne({ razorpayOrderId: gatewayOrderId }) : paymentId ? await Order.findOne({ razorpayPaymentId: paymentId }) : null;

    if (order && ['payment.captured', 'order.paid'].includes(eventName)) {
      const orderEntity = event.payload && event.payload.order && event.payload.order.entity;
      const capturedAmount = entity && entity.amount || orderEntity && (orderEntity.amount_paid || orderEntity.amount);
      const capturedCurrency = entity && entity.currency || orderEntity && orderEntity.currency;
      const amountMatches = Number(capturedAmount) === Math.round(order.total * 100) && capturedCurrency === 'INR';
      if (!amountMatches && ['pending_payment', 'expired', 'payment_failed', 'cancelled'].includes(order.status)) {
        if (order.status === 'pending_payment') await service.releaseReservation(order._id, 'expired');
        await Order.updateOne({ _id: order._id, status: { $in: ['expired', 'payment_failed', 'cancelled'] } }, {
          $set: { status: 'refund_pending', paymentStatus: 'refund_pending', ...(paymentId ? { razorpayPaymentId: paymentId } : {}) },
          $push: { statusHistory: { action: 'payment_amount_review', detail: 'Captured amount or currency does not match order; refund review required.', at: new Date() } },
        });
      } else if (order.status === 'pending_payment' && amountMatches && order.reservationExpiresAt > new Date()) {
        const paid = await Order.updateOne({ _id: order._id, status: 'pending_payment', reservationExpiresAt: { $gt: new Date() } }, {
          $set: { status: 'paid', paymentStatus: 'captured', ...(paymentId ? { razorpayPaymentId: paymentId } : {}) },
          $push: { statusHistory: { action: 'payment_captured', detail: 'Verified Razorpay webhook.', at: new Date() } },
        });
        if (!paid.modifiedCount) await flagCaptureForRefund(order, paymentId, 'late_payment_capture', 'Payment captured after reservation expired; refund review required.');
      } else if (['pending_payment', 'expired', 'payment_failed', 'cancelled'].includes(order.status)) {
        await flagCaptureForRefund(order, paymentId, 'late_payment_capture', 'Captured after reservation ended; refund review required.');
      }
    } else if (order && eventName === 'payment.failed') {
      await service.releaseReservation(order._id, 'payment_failed');
    } else if (order && eventName === 'refund.processed') {
      const fullAmount = refundEntity && Number(refundEntity.amount) === Math.round(order.total * 100) && refundEntity.currency === 'INR';
      await Order.updateOne({ _id: order._id, status: 'refund_pending' }, {
        $set: { status: fullAmount ? 'refunded' : 'refund_review', paymentStatus: fullAmount ? 'refunded' : 'refund_review', razorpayRefundId: refundEntity && refundEntity.id || '' },
        $push: { statusHistory: { action: fullAmount ? 'refund_processed' : 'refund_amount_review', detail: fullAmount ? 'Verified full refund webhook.' : 'Refund amount or currency did not match the full order amount.', at: new Date() } },
      });
    } else if (order && eventName === 'refund.failed') {
      await Order.updateOne({ _id: order._id, status: 'refund_pending' }, { $set: { status: 'refund_failed', paymentStatus: 'refund_failed', razorpayRefundId: refundEntity && refundEntity.id || '' }, $push: { statusHistory: { action: 'refund_failed', detail: 'Payment provider reported refund failure.', at: new Date() } } });
    }
    await WebhookEvent.updateOne({ _id: eventId, status: 'processing' }, { $set: { status: 'processed' } });
    claimedEventId = null;
    res.json({ received: true });
  } catch (error) {
    if (claimedEventId) await WebhookEvent.deleteOne({ _id: claimedEventId, status: 'processing' }).catch(() => {});
    next(error);
  }
};

exports.track = async (req, res, next) => {
  try {
    const input = trackingSchema.parse(req.body);
    const phone = normalizeIndianPhone(input.phone);
    if (!phone) return res.status(404).json({ message: 'Order details could not be verified.' });
    const order = await Order.findOne({ orderNumber: input.orderNumber.toUpperCase(), 'customer.phone': phone })
      .select('orderNumber status paymentStatus items total shippingCharge trackingNumber courierName createdAt updatedAt');
    if (!order) return res.status(404).json({ message: 'Order details could not be verified.' });
    res.json({ orderNumber: order.orderNumber, status: order.status, paymentStatus: order.paymentStatus,
      items: order.items, total: order.total, shippingCharge: order.shippingCharge,
      trackingNumber: order.trackingNumber, courierName: order.courierName,
      createdAt: order.createdAt, updatedAt: order.updatedAt });
  } catch (error) { next(error); }
};

exports.adminList = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = z.enum(['pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'payment_failed', 'cancelled', 'expired', 'refund_pending', 'refund_review', 'refunded', 'refund_failed']).parse(req.query.status);
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(z.string().datetime().parse(req.query.from));
      if (req.query.to) filter.createdAt.$lte = new Date(z.string().datetime().parse(req.query.to));
    }
    if (req.query.q) filter.orderNumber = new RegExp('^' + String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.json(orders);
  } catch (error) { next(error); }
};

exports.adminUpdate = async (req, res, next) => {
  try {
    const input = z.object({
      status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']),
      courierName: z.string().trim().max(100).optional(),
      trackingNumber: z.string().trim().max(100).optional(),
    }).strict().parse(req.body);
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    const allowed = {
      paid: ['processing', 'cancelled'], processing: ['shipped', 'cancelled'], shipped: ['delivered'],
      pending_payment: ['cancelled'],
    };
    if (!(allowed[order.status] || []).includes(input.status)) return res.status(409).json({ message: 'Invalid order status transition.' });
    if (order.status === 'pending_payment' && input.status === 'cancelled') {
      await service.releaseReservation(order._id, 'cancelled');
      return res.json(await Order.findById(order._id));
    }
    if (input.status === 'cancelled') return res.status(409).json({ message: 'Paid orders require the verified refund action before cancellation.' });
    if (input.status === 'shipped' && (!input.courierName || !input.trackingNumber)) return res.status(400).json({ message: 'Courier name and tracking number are required before shipping.' });
    const update = { status: input.status };
    if (input.courierName != null) update.courierName = input.courierName;
    if (input.trackingNumber != null) update.trackingNumber = input.trackingNumber;
    const updated = await Order.findOneAndUpdate({ _id: order._id, status: order.status }, {
      $set: update,
      $push: { statusHistory: { action: input.status, actor: req.user._id, detail: [input.courierName, input.trackingNumber].filter(Boolean).join(' · ') } },
    }, { new: true });
    if (!updated) return res.status(409).json({ message: 'Order status changed. Reload and try again.' });
    res.json(updated);
  } catch (error) { next(error); }
};

exports.adminRefund = async (req, res, next) => {
  try {
    if (!gatewayReady()) return res.status(503).json({ message: 'Razorpay test mode is not configured.' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (!['paid', 'processing', 'refund_failed', 'refund_pending'].includes(order.status) || !order.razorpayPaymentId) {
      return res.status(409).json({ message: 'This order has no eligible captured payment to refund.' });
    }
    if (order.status === 'refund_pending' && order.refundRequestedAt) return res.status(409).json({ message: 'A refund request is pending or needs reconciliation. Check the Razorpay dashboard before retrying.' });
    const refundFilter = { _id: order._id, status: order.status };
    if (order.status === 'refund_pending') refundFilter.refundRequestedAt = null;
    const refundStarted = await Order.findOneAndUpdate(refundFilter, {
      $set: { status: 'refund_pending', paymentStatus: 'refund_pending', refundRequestedAt: new Date() },
      $push: { statusHistory: { action: 'refund_requested', actor: req.user._id, detail: 'Full refund requested in Razorpay test mode.' } },
    }, { new: true });
    if (!refundStarted) return res.status(409).json({ message: 'Refund status changed. Reload before retrying.' });
    const refund = await razorpayRequest(`/payments/${encodeURIComponent(order.razorpayPaymentId)}/refund`, {
      amount: Math.round(order.total * 100), notes: { orderNumber: order.orderNumber },
    });
    await Order.updateOne({ _id: order._id, status: 'refund_pending' }, { $set: { razorpayRefundId: refund.id } });
    const current = await Order.findById(order._id).select('orderNumber status');
    res.json({ orderNumber: current.orderNumber, status: current.status, refundId: refund.id, message: 'Refund request submitted; final status follows the verified webhook.' });
  } catch (error) { next(error); }
};
