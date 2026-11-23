const crypto = require('crypto');
const { z } = require('zod');
const Order = require('./order.model');
const ReturnRequest = require('./return.model');
const WebhookEvent = require('./webhook-event.model');
const ShippingSettings = require('./shipping.model');
const { itemsSchema, addressSchema, quoteAddressSchema, customerSchema, trackingSchema, policyConsentSchema } = require('./schemas');
const service = require('./order.service');
const { normalizeIndianPhone } = require('../../utils/phone');
const { escapeHtml, appAdminUrl, notifyOwner } = require('../../utils/ownerAlerts');
const orderMails = require('../../utils/orderMails');
const { sendSms } = require('../../utils/sms');
const { buildTrackingUrl, validateHttpsUrl } = require('./tracking');

const reservationMinutes = () => Math.min(60, Math.max(5, Number(process.env.PAYMENT_RESERVATION_MINUTES) || 15));
const deliveryOtpHash = (orderNumber, otp) =>
  crypto.createHash('sha256').update(`${orderNumber}:${otp}`).digest('hex');

function deliveryOtpKey() {
  return crypto.createHash('sha256').update(String(process.env.JWT_SECRET || '')).digest();
}

function encryptDeliveryOtp(otp) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deliveryOtpKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(otp), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptDeliveryOtp(payload) {
  try {
    const [ivPart, tagPart, encryptedPart] = String(payload || '').split('.');
    if (!ivPart || !tagPart || !encryptedPart) return '';
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      deliveryOtpKey(),
      Buffer.from(ivPart, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (_) {
    return '';
  }
}

exports.decryptDeliveryOtp = decryptDeliveryOtp;
// Environment normalization is performed by src/config/env.js when the app loads.
for (const name of ['PAYMENT_MODE', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
  if (typeof process.env[name] === 'string') process.env[name] = process.env[name].trim();
}

const looksLikePlaceholder = (value) => /replace|placeholder|your_/i.test(value);

// Har check alag-alag (sirf true/false aur mode ka naam; secret ki value kabhi print nahi hoti).
const gatewayDiagnostics = () => {
  const mode = process.env.PAYMENT_MODE || '';
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  return {
    mode: mode || '(not set)',
    modeIsTestOrLive: mode === 'test' || mode === 'live',
    keyPrefixMatchesMode: (mode === 'test' && /^rzp_test_[A-Za-z0-9]+$/.test(keyId))
      || (mode === 'live' && /^rzp_live_[A-Za-z0-9]+$/.test(keyId)),
    hasKeySecret: !!keySecret,
    hasWebhookSecret: !!webhookSecret,
    noPlaceholders: ![keyId, keySecret, webhookSecret].some(looksLikePlaceholder),
  };
};

// PAYMENT_MODE=test -> sirf rzp_test_ key | PAYMENT_MODE=live -> sirf rzp_live_ key
const gatewayReady = () => {
  const d = gatewayDiagnostics();
  return d.modeIsTestOrLive && d.keyPrefixMatchesMode && d.hasKeySecret && d.hasWebhookSecret && d.noPlaceholders;
};

const paymentSetupMessage = (action) => {
  const mode = process.env.PAYMENT_MODE === 'live' ? 'Live' : 'Test';
  return `${action} payment is temporarily unavailable while the store completes Razorpay ${mode} Mode and webhook setup. No order or payment has been created.`;
};

exports.gatewayReady = gatewayReady;

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

async function razorpayGet(path) {
  let response;
  try {
    response = await fetch('https://api.razorpay.com/v1' + path, {
      method: 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64'),
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (_) {
    const error = new Error('Payment provider response is uncertain. Keep the order number and contact support before retrying.');
    error.status = 502;
    error.uncertain = true;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Payment provider could not verify the payment. Please try again later.');
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

const priorCheckoutEnded = (prior) =>
  prior.status !== 'pending_payment' ||
  !prior.reservationExpiresAt ||
  new Date(prior.reservationExpiresAt).getTime() <= Date.now();

exports.create = async (req, res, next) => {
  let order, accessToken, checkoutRequestId;
  try {
    if (!gatewayReady()) {
      // Sirf server log mein dikhega (Render > Logs): kaunsa check fail hua. Secret ki value print nahi hoti.
      console.warn('PAYMENT_NOT_READY', gatewayDiagnostics());
      return res.status(503).json({ message: paymentSetupMessage('Online') });
    }
    const input = z.object({ customer: customerSchema, address: addressSchema, items: itemsSchema, expectedTotal: z.number().finite().nonnegative(), checkoutRequestId: z.string().uuid(), accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), ...policyConsentSchema.shape }).strict().parse(req.body);
    if (!req.user || req.user.role !== 'customer') return res.status(403).json({ message: 'Sign in to your customer account before placing an order.' });
    if (input.customer.email.toLowerCase() !== req.user.email) return res.status(400).json({ message: 'Use the email address linked to your account.' });
    accessToken = input.accessToken;
    checkoutRequestId = input.checkoutRequestId;
    const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    const prior = await Order.findOne({ checkoutRequestId }).select('+checkoutRequestId +accessTokenHash');
    if (prior) {
      if (prior.accessTokenHash !== accessTokenHash) return res.status(409).json({ message: 'Checkout request could not be verified.' });
      if (priorCheckoutEnded(prior)) return res.status(409).json({ message: 'This checkout has ended. Please start again.' });
      return res.status(prior.razorpayOrderId ? 200 : 202).json(paymentOrderPayload(prior, accessToken, !prior.razorpayOrderId));
    }
    const phone = normalizeIndianPhone(input.customer.phone);
    if (!phone) return res.status(400).json({ message: 'Enter a valid Indian mobile number.' });
    const address = { ...input.address, state: 'Maharashtra' };
    const reserved = await service.reserveAndCreate({
      customer: { ...input.customer, phone }, customerAccountId: req.user._id, address,
      items: input.items, expectedTotal: input.expectedTotal, reservationMinutes: reservationMinutes(), accessTokenHash, checkoutRequestId,
      termsAccepted: input.termsAccepted, policyVersion: input.policyVersion,
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
    order.statusHistory.push({
      action: 'payment_order_created',
      detail: `Razorpay ${process.env.PAYMENT_MODE === 'live' ? 'live' : 'test'} order created.`,
    });
    try { await order.save(); }
    catch (error) { error.uncertain = true; throw error; }
    res.status(201).json(paymentOrderPayload(order, accessToken));
  } catch (error) {
    if (error.code === 11000 && checkoutRequestId) {
      const prior = await Order.findOne({ checkoutRequestId }).select('+checkoutRequestId +accessTokenHash');
      const hash = accessToken && crypto.createHash('sha256').update(accessToken).digest('hex');
      if (prior && prior.accessTokenHash === hash) {
        if (priorCheckoutEnded(prior)) return res.status(409).json({ message: 'This checkout has ended. Please start again.' });
        return res.status(prior.razorpayOrderId ? 200 : 202).json(paymentOrderPayload(prior, accessToken, !prior.razorpayOrderId));
      }
    }
    if (order && !error.uncertain) await service.releaseReservation(order._id, 'payment_failed').catch(() => console.error('Reservation rollback failed.'));
    next(error);
  }
};

exports.accountOrders = async (req, res, next) => {
  try {
    const filter = { customerAccount: req.user._id };
    if (req.query.all !== '1') {
      filter.status = { $nin: ['expired', 'payment_failed'] };
      filter.$or = [{ status: { $ne: 'pending_payment' } }, { reservationExpiresAt: { $gt: new Date() } }];
    }
    const orders = await Order.find(filter)
      .select('orderNumber status paymentStatus total currency createdAt updatedAt courierName trackingNumber trackingUrl deliveredAt items.name items.imageUrl items.quantity')
      .sort({ createdAt: -1 }).limit(50).lean();
    res.json({ items: orders });
  } catch (error) { next(error); }
};

exports.mineDetail = async (req, res, next) => {
  try {
    const order = await Order.findOne({ orderNumber: String(req.params.orderNumber).trim().toUpperCase(), customerAccount: req.user._id })
      .select('+deliveryOtpEncrypted orderNumber items address subtotal discount shippingCharge total currency status paymentStatus razorpayPaymentId courierName trackingNumber trackingUrl deliveredAt createdAt statusHistory deliveryOtpExpiresAt')
      .lean();
    if (!order) return res.status(404).json({ message: 'Order details could not be verified.' });
    const items = (order.items || []).map(({ name, imageUrl, quantity, unitPrice, originalPrice, lineTotal, warrantyMonths, type }) =>
      ({ name, imageUrl, quantity, unitPrice, originalPrice, lineTotal, warrantyMonths, type }));
    let deliveryOtp = '';
    if (['shipped', 'out_for_delivery'].includes(order.status) && order.deliveryOtpEncrypted && order.deliveryOtpExpiresAt && new Date(order.deliveryOtpExpiresAt) > new Date()) {
      deliveryOtp = decryptDeliveryOtp(order.deliveryOtpEncrypted);
    }
    res.json({ orderNumber: order.orderNumber, items, address: order.address, subtotal: order.subtotal, discount: order.discount,
      shippingCharge: order.shippingCharge, total: order.total, currency: order.currency, status: order.status, paymentStatus: order.paymentStatus,
      ...(order.paymentStatus === 'captured' ? { paymentId: order.razorpayPaymentId } : {}), courierName: order.courierName, trackingNumber: order.trackingNumber, trackingUrl: order.trackingUrl || '',
      deliveredAt: order.deliveredAt, createdAt: order.createdAt,
      ...(deliveryOtp ? { deliveryOtp } : {}),
      statusHistory: (order.statusHistory || []).map(({ action, at }) => ({ action, at })) });
  } catch (error) { next(error); }
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
    if (!gatewayReady()) return res.status(503).json({ message: paymentSetupMessage('Online') });
    const input = verifyPaymentSchema.parse(req.body);
    const order = await Order.findOne({ orderNumber: req.params.orderNumber, razorpayOrderId: input.razorpay_order_id });
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (!exports.verifySignature(`${order.razorpayOrderId}|${input.razorpay_payment_id}`, input.razorpay_signature, process.env.RAZORPAY_KEY_SECRET)) {
      return res.status(400).json({ message: 'Payment signature could not be verified.' });
    }

    let markedPaid = false;
    try {
      const payment = await razorpayGet(`/payments/${encodeURIComponent(input.razorpay_payment_id)}`);
      const belongsToOrder = payment.order_id === order.razorpayOrderId;
      if (belongsToOrder && payment.status === 'captured') {
        markedPaid = await applyCapturedPayment(
          order,
          input.razorpay_payment_id,
          payment.amount,
          payment.currency,
          'verify'
        );
      } else if (belongsToOrder && payment.status === 'authorized') {
        console.warn('RAZORPAY_AUTO_CAPTURE_OFF', { orderNumber: order.orderNumber, paymentId: input.razorpay_payment_id });
        await Order.updateOne({ _id: order._id, status: 'pending_payment', reservationExpiresAt: { $gt: new Date() } }, {
          $set: { razorpayPaymentId: input.razorpay_payment_id, paymentStatus: 'authorized' },
          $push: { statusHistory: { action: 'payment_signature_verified', detail: 'Razorpay payment is authorized; auto-capture may be disabled.', at: new Date() } },
        });
      } else if (!belongsToOrder) {
        await Order.updateOne({ _id: order._id, status: 'pending_payment', reservationExpiresAt: { $gt: new Date() } }, {
          $set: { razorpayPaymentId: input.razorpay_payment_id, paymentStatus: 'authorized' },
          $push: { statusHistory: { action: 'payment_signature_verified', detail: 'Awaiting verification of payment provider status.', at: new Date() } },
        });
      }
    } catch (error) {
      console.warn('RAZORPAY_PAYMENT_LOOKUP_FAILED', { orderNumber: order.orderNumber, paymentId: input.razorpay_payment_id });
      await Order.updateOne({ _id: order._id, status: 'pending_payment', reservationExpiresAt: { $gt: new Date() } }, {
        $set: { razorpayPaymentId: input.razorpay_payment_id, paymentStatus: 'authorized' },
        $push: { statusHistory: { action: 'payment_signature_verified', detail: 'Awaiting verified payment webhook.' } },
      });
    }
    const current = await Order.findById(order._id).select('orderNumber status paymentStatus');
    markedPaid = markedPaid && current.status === 'paid';
    res.json({
      orderNumber: current.orderNumber,
      status: current.status,
      paymentStatus: current.paymentStatus,
      message: markedPaid ? 'Payment confirmed' : 'Payment response verified. Final confirmation follows the payment provider webhook.',
    });
  } catch (error) { next(error); }
};

async function flagCaptureForRefund(order, paymentId, action, detail) {
  let current = await Order.findById(order._id).select('status');
  if (current && current.status === 'pending_payment') {
    await service.releaseReservation(order._id, 'expired');
    current = await Order.findById(order._id).select('status');
  }
  if (!current || !['expired', 'payment_failed', 'cancelled'].includes(current.status)) return;
  const updated = await Order.updateOne({ _id: order._id, status: current.status }, {
    $set: { status: 'refund_pending', paymentStatus: 'refund_pending', ...(paymentId ? { razorpayPaymentId: paymentId } : {}) },
    $push: { statusHistory: { action, detail, at: new Date() } },
  });
  if (updated.modifiedCount) {
    notifyOwner({
      subject: `Late or review payment for ${order.orderNumber || ''}`,
      text: `Order ${order.orderNumber || ''} needs refund review. ${detail}\nAdmin: ${appAdminUrl()}`,
      html: `<p>Order <strong>${escapeHtml(order.orderNumber || '')}</strong> needs refund review.</p><p>${escapeHtml(detail)}</p><p><a href="${escapeHtml(appAdminUrl())}">Open admin</a></p>`,
    });
  }
}

function notifyPaidOrder(order) {
  const items = (order.items || []).map((item) =>
    `${item.name || 'Item'} × ${Number(item.quantity || 0)}`
  );
  const address = order.address || {};
  const fullAddress = [
    address.line1,
    address.line2,
    address.city,
    address.district,
    address.state,
    address.pinCode,
  ].filter(Boolean).join(', ');
  const orderNumber = order.orderNumber || '';
  const customerName = order.customer?.name || '';
  const customerPhone = order.customer?.phone || '';
  const total = `₹${Number(order.total || 0).toLocaleString('en-IN')}`;
  const adminUrl = appAdminUrl();
  const textLines = [
    `New paid order: ${orderNumber}`,
    `Items: ${items.join(', ') || 'None'}`,
    `Total: ${total}`,
    `Customer: ${customerName}`,
    `Phone: ${customerPhone}`,
    `Address: ${fullAddress || 'Not provided'}`,
    `Admin: ${adminUrl}`,
  ];
  const htmlLines = [
    `<p><strong>New paid order:</strong> ${escapeHtml(orderNumber)}</p>`,
    `<p><strong>Items:</strong><br>${items.map((item) => escapeHtml(item)).join('<br>')}</p>`,
    `<p><strong>Total:</strong> ${escapeHtml(total)}</p>`,
    `<p><strong>Customer:</strong> ${escapeHtml(customerName)}</p>`,
    `<p><strong>Phone:</strong> ${escapeHtml(customerPhone)}</p>`,
    `<p><strong>Address:</strong> ${escapeHtml(fullAddress || 'Not provided')}</p>`,
    `<p><a href="${escapeHtml(adminUrl)}">Open admin</a></p>`,
  ];
  notifyOwner({
    subject: `New paid order ${orderNumber}`,
    text: textLines.join('\n'),
    html: htmlLines.join(''),
  });
}

function notifyRefundReview(order, paymentId, detail) {
  const orderNumber = order.orderNumber || '';
  const adminUrl = appAdminUrl();
  notifyOwner({
    subject: `Refund review: ${orderNumber}`,
    text: `Order ${orderNumber} requires refund review. ${detail}${paymentId ? ` Payment: ${paymentId}` : ''}\nAdmin: ${adminUrl}`,
    html: `<p>Order <strong>${escapeHtml(orderNumber)}</strong> requires refund review.</p><p>${escapeHtml(detail)}</p>${paymentId ? `<p>Payment: ${escapeHtml(paymentId)}</p>` : ''}<p><a href="${escapeHtml(adminUrl)}">Open admin</a></p>`,
  });
}

async function applyCapturedPayment(order, paymentId, amountPaise, currency, source) {
  const current = await Order.findById(order._id).select('status paymentStatus reservationExpiresAt razorpayPaymentId');
  if (current && current.status === 'paid' && current.paymentStatus === 'captured') return true;

  const amountMatches =
    Number(amountPaise) === Math.round(order.total * 100) &&
    currency === 'INR';

  if (!amountMatches) {
    if (current && current.status === 'pending_payment') {
      await service.releaseReservation(order._id, 'expired');
      const mismatch = await Order.updateOne({ _id: order._id, status: 'expired' }, {
        $set: { status: 'refund_pending', paymentStatus: 'refund_pending', ...(paymentId ? { razorpayPaymentId: paymentId } : {}) },
        $push: { statusHistory: { action: 'payment_amount_review', detail: 'Captured amount or currency does not match order; refund review required.', at: new Date() } },
      });
      if (mismatch.modifiedCount) notifyRefundReview(order, paymentId, 'Captured amount or currency does not match the order.');
    } else if (current && ['expired', 'payment_failed', 'cancelled'].includes(current.status)) {
      const mismatch = await Order.updateOne({ _id: order._id, status: current.status }, {
        $set: { status: 'refund_pending', paymentStatus: 'refund_pending', ...(paymentId ? { razorpayPaymentId: paymentId } : {}) },
        $push: { statusHistory: { action: 'payment_amount_review', detail: 'Captured amount or currency does not match order; refund review required.', at: new Date() } },
      });
      if (mismatch.modifiedCount) notifyRefundReview(order, paymentId, 'Captured amount or currency does not match the order.');
    }
    return false;
  }

  if (current && current.status === 'pending_payment' && current.reservationExpiresAt > new Date()) {
    const paid = await Order.updateOne({ _id: order._id, status: 'pending_payment', reservationExpiresAt: { $gt: new Date() } }, {
      $set: { status: 'paid', paymentStatus: 'captured', ...(paymentId ? { razorpayPaymentId: paymentId } : {}) },
      $push: { statusHistory: { action: 'payment_captured', detail: `Verified Razorpay ${source === 'verify' ? 'payment verification' : 'webhook'}.`, at: new Date() } },
    });
    if (paid.modifiedCount) {
      notifyPaidOrder(order);
      orderMails.sendOrderConfirmed(order);
      return true;
    }
  }

  if (current && ['pending_payment', 'expired', 'payment_failed', 'cancelled'].includes(current.status)) {
    await flagCaptureForRefund(order, paymentId, 'late_payment_capture',
      `Captured after reservation ended via ${source}; refund review required.`);
  }
  return false;
}

exports.applyCapturedPayment = applyCapturedPayment;

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
      await applyCapturedPayment(order, paymentId, capturedAmount, capturedCurrency, 'webhook');
    } else if (order && eventName === 'payment.failed') {
      // Customer isi popup mein dobara try kar sakta hai. Isliye stock abhi release nahi karte.
      await Order.updateOne({ _id: order._id, status: 'pending_payment' }, {
        $push: { statusHistory: { action: 'payment_attempt_failed', detail: 'A payment attempt failed; customer may retry until the reservation ends.', at: new Date() } },
      });
    } else if (order && eventName === 'refund.processed') {
      const expectedRefund = order.refundExpectedAmount == null ? order.total : order.refundExpectedAmount;
      const refundMatches = refundEntity && Number(refundEntity.amount) === Math.round(expectedRefund * 100) && refundEntity.currency === 'INR';
      const fullAmount = refundMatches && expectedRefund === order.total;
      const refundUpdate = await Order.updateOne({ _id: order._id, status: 'refund_pending' }, {
        $set: { status: refundMatches ? (fullAmount ? 'refunded' : 'partially_refunded') : 'refund_review', paymentStatus: refundMatches ? (fullAmount ? 'refunded' : 'partially_refunded') : 'refund_review', razorpayRefundId: refundEntity && refundEntity.id || '' },
        $push: { statusHistory: { action: refundMatches ? 'refund_processed' : 'refund_amount_review', detail: refundMatches ? 'Verified refund webhook amount.' : 'Refund amount or currency did not match the requested amount.', at: new Date() } },
      });
      if (refundUpdate.modifiedCount && !refundMatches) notifyRefundReview(order, paymentId, 'Refund amount or currency did not match the requested amount.');
      if (refundUpdate.modifiedCount && refundMatches) {
        orderMails.sendRefundProcessed(order, refundEntity.amount / 100);
        const returnRequest = await ReturnRequest.findOne({ order: order._id, status: 'refund_pending' }).select('_id').lean();
        if (returnRequest) {
          await ReturnRequest.updateOne({ _id: returnRequest._id, status: 'refund_pending' }, { $set: { status: 'refunded' }, $push: { statusHistory: { action: 'refunded', detail: 'Refund webhook verified.' } } });
        } else if (fullAmount) {
          await service.restockOrder(order._id);
        }
      }
    } else if (order && eventName === 'refund.failed') {
      const refundFailed = await Order.updateOne({ _id: order._id, status: 'refund_pending' }, { $set: { status: 'refund_failed', paymentStatus: 'refund_failed', razorpayRefundId: refundEntity && refundEntity.id || '' }, $push: { statusHistory: { action: 'refund_failed', detail: 'Payment provider reported refund failure.', at: new Date() } } });
      if (refundFailed.modifiedCount) {
        notifyOwner({
          subject: `Refund failed: ${order.orderNumber || ''}`,
          text: `Order ${order.orderNumber || ''} has a failed refund.${paymentId ? ` Payment: ${paymentId}` : ''}\nAdmin: ${appAdminUrl()}`,
          html: `<p>Order <strong>${escapeHtml(order.orderNumber || '')}</strong> has a failed refund.</p>${paymentId ? `<p>Payment: ${escapeHtml(paymentId)}</p>` : ''}<p><a href="${escapeHtml(appAdminUrl())}">Open admin</a></p>`,
        });
      }
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
    const filter = { customerAccount: req.user._id };
    if (input.orderNumber) filter.orderNumber = input.orderNumber.toUpperCase();
    let query = Order.findOne(filter).select('orderNumber status paymentStatus items total shippingCharge address statusHistory trackingNumber trackingUrl courierName deliveredAt createdAt updatedAt');
    if (!input.orderNumber) query = query.sort({ createdAt: -1 });
    const order = await query;
    if (!order) return res.status(404).json({ message: 'Order details could not be verified.' });
    res.json({ orderNumber: order.orderNumber, status: order.status, paymentStatus: order.paymentStatus,
      items: order.items, total: order.total, shippingCharge: order.shippingCharge,
      trackingNumber: order.trackingNumber, trackingUrl: order.trackingUrl || '', courierName: order.courierName,
      deliveredAt: order.deliveredAt, createdAt: order.createdAt, updatedAt: order.updatedAt, address: order.address,
      statusHistory: (order.statusHistory || []).map(({ action, at }) => ({ action, at })) });
  } catch (error) { next(error); }
};

exports.adminList = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = z.enum(['pending_payment', 'paid', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'payment_failed', 'cancelled', 'expired', 'refund_pending', 'refund_review', 'refunded', 'partially_refunded', 'refund_failed']).parse(req.query.status);
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
      status: z.enum(['processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled']),
      courierName: z.string().trim().max(100).optional(),
      trackingNumber: z.string().trim().max(100).optional(),
      trackingUrlTemplate: z.string().trim().max(300).optional()
        .refine((value) => !value || (validateHttpsUrl(value) && value.includes('{awb}')), 'Tracking URL template must be HTTPS and contain {awb}'),
      otp: z.string().regex(/^\d{6}$/).optional(),
      override: z.boolean().optional(),
      reason: z.string().trim().min(1).max(500).optional(),
    }).strict().parse(req.body);
    const order = await Order.findById(req.params.id).select('+deliveryOtpHash +deliveryOtpEncrypted');
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    const allowed = {
      paid: ['processing', 'cancelled'], processing: ['shipped', 'cancelled'], shipped: ['out_for_delivery', 'delivered'], out_for_delivery: ['delivered'],
      pending_payment: ['cancelled'],
    };
    if (!(allowed[order.status] || []).includes(input.status)) return res.status(409).json({ message: 'Invalid order status transition.' });
    if (order.status === 'pending_payment' && input.status === 'cancelled') {
      await service.releaseReservation(order._id, 'cancelled');
      return res.json(await Order.findById(order._id));
    }
    if (input.status === 'cancelled') return res.status(409).json({ message: 'Paid orders require the verified refund action before cancellation.' });
    if (input.status === 'shipped' && (!input.courierName || !input.trackingNumber)) return res.status(400).json({ message: 'Courier name and tracking number are required before shipping.' });

    if (input.status === 'delivered') {
      if (input.override) {
        if (req.user.role !== 'owner') return res.status(403).json({ message: 'Only an owner can override delivery OTP verification.' });
        if (!input.reason) return res.status(400).json({ message: 'An owner override reason is required.' });
      } else {
        if (!input.otp) return res.status(400).json({ message: 'Delivery OTP is required.' });
        if (Number(order.deliveryOtpAttempts || 0) >= 5) {
          return res.status(423).json({ message: 'Delivery OTP is locked after 5 wrong attempts. Owner override is required.' });
        }
        if (!order.deliveryOtpHash || !order.deliveryOtpExpiresAt || new Date(order.deliveryOtpExpiresAt) <= new Date()) {
          return res.status(400).json({ message: 'Delivery OTP is missing or expired.' });
        }
        const suppliedHash = deliveryOtpHash(order.orderNumber, input.otp);
        const expected = Buffer.from(order.deliveryOtpHash, 'hex');
        const supplied = Buffer.from(suppliedHash, 'hex');
        const matches = expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
        if (!matches) {
          const attempt = await Order.findOneAndUpdate(
            { _id: order._id, status: { $in: ['shipped', 'out_for_delivery'] }, deliveryOtpAttempts: { $lt: 5 } },
            { $inc: { deliveryOtpAttempts: 1 } },
            { new: true }
          ).select('deliveryOtpAttempts');
          if (!attempt) return res.status(409).json({ message: 'Order status changed. Reload and try again.' });
          if (attempt.deliveryOtpAttempts >= 5) {
            return res.status(423).json({ message: 'Delivery OTP is locked after 5 wrong attempts. Owner override is required.' });
          }
          return res.status(400).json({ message: `Incorrect delivery OTP. ${5 - attempt.deliveryOtpAttempts} attempt(s) remaining.` });
        }
      }
    }

    let generatedOtp = '';
    if (input.status === 'shipped') {
      generatedOtp = String(crypto.randomInt(100000, 1000000));
    }
    const update = { status: input.status };
    if (input.status === 'delivered') update.deliveredAt = order.deliveredAt || new Date();
    if (input.courierName != null) update.courierName = input.courierName;
    if (input.trackingNumber != null) update.trackingNumber = input.trackingNumber;
    if (input.status === 'shipped' || (input.courierName != null && input.trackingNumber != null)) {
      const courierName = input.courierName != null ? input.courierName : order.courierName;
      const trackingNumber = input.trackingNumber != null ? input.trackingNumber : order.trackingNumber;
      update.trackingUrl = buildTrackingUrl(courierName, trackingNumber, input.trackingUrlTemplate);
    }
    if (input.status === 'shipped') {
      update.deliveryOtpHash = deliveryOtpHash(order.orderNumber, generatedOtp);
      update.deliveryOtpEncrypted = encryptDeliveryOtp(generatedOtp);
      update.deliveryOtpExpiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      update.deliveryOtpAttempts = 0;
      update.deliveryOtpVerifiedAt = null;
    }
    if (input.status === 'delivered') {
      if (input.override) {
        update.deliveryOtpVerifiedAt = new Date();
      } else {
        update.deliveryOtpVerifiedAt = new Date();
        update.deliveryOtpAttempts = 0;
      }
      update.deliveryOtpHash = '';
      update.deliveryOtpEncrypted = '';
      update.deliveryOtpExpiresAt = null;
    }
    const detail = input.status === 'delivered' && input.override
      ? `Owner delivery override: ${input.reason}`
      : [input.courierName, input.trackingNumber].filter(Boolean).join(' · ');
    const updated = await Order.findOneAndUpdate({ _id: order._id, status: order.status }, {
      $set: update,
      $push: { statusHistory: { action: input.status, actor: req.user._id, detail } },
    }, { new: true });
    if (!updated) return res.status(409).json({ message: 'Order status changed. Reload and try again.' });
    if (input.status === 'shipped') {
      orderMails.sendShipped(updated);
      orderMails.sendDeliveryOtp(updated, generatedOtp);
      sendSms(updated.customer?.phone, `Vansh Computer delivery OTP for order ${updated.orderNumber}: ${generatedOtp}. Share this OTP only with the delivery person when you receive your parcel.`);
    }
    if (input.status === 'delivered') {
      const settings = await ShippingSettings.findById('maharashtra').select('returnsEnabled returnWindowDays').lean().catch(() => null);
      orderMails.sendDelivered(updated, settings || {});
    }
    res.json(updated);
  } catch (error) { next(error); }
};

async function startFullRefund(order, actor) {
  if (!gatewayReady()) {
    const error = new Error('Razorpay is not configured.');
    error.status = 503;
    throw error;
  }
  if (!order.razorpayPaymentId) {
    const error = new Error('This order has no eligible captured payment to refund.');
    error.status = 409;
    throw error;
  }
  const refund = await razorpayRequest(`/payments/${encodeURIComponent(order.razorpayPaymentId)}/refund`, {
    amount: Math.round(order.total * 100), notes: { orderNumber: order.orderNumber },
  });
  await Order.updateOne({ _id: order._id, status: 'refund_pending' }, { $set: { razorpayRefundId: refund.id } });
  return refund;
}
exports.startFullRefund = startFullRefund;

exports.adminRefund = async (req, res, next) => {
  try {
    if (!gatewayReady()) return res.status(503).json({ message: 'Razorpay is not configured.' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (!['paid', 'processing', 'refund_failed', 'refund_pending'].includes(order.status) || !order.razorpayPaymentId) {
      return res.status(409).json({ message: 'This order has no eligible captured payment to refund.' });
    }
    if (order.status === 'refund_pending' && order.refundRequestedAt) return res.status(409).json({ message: 'A refund request is pending or needs reconciliation. Check the Razorpay dashboard before retrying.' });
    const refundFilter = { _id: order._id, status: order.status };
    if (order.status === 'refund_pending') refundFilter.refundRequestedAt = null;
    const refundStarted = await Order.findOneAndUpdate(refundFilter, {
      $set: { status: 'refund_pending', paymentStatus: 'refund_pending', refundRequestedAt: new Date(), refundExpectedAmount: order.total },
      $push: { statusHistory: { action: 'refund_requested', actor: req.user._id, detail: 'Full refund requested.' } },
    }, { new: true });
    if (!refundStarted) return res.status(409).json({ message: 'Refund status changed. Reload before retrying.' });
    const refund = await startFullRefund(refundStarted, req.user._id);
    const current = await Order.findById(order._id).select('orderNumber status');
    res.json({ orderNumber: current.orderNumber, status: current.status, refundId: refund.id, message: 'Refund request submitted; final status follows the verified webhook.' });
  } catch (error) { next(error); }
};

const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional().default(''),
}).strict();

exports.cancelMine = async (req, res, next) => {
  try {
    const input = cancelSchema.parse(req.body || {});
    const orderNumber = String(req.params.orderNumber).trim().toUpperCase();
    const order = await Order.findOne({ orderNumber, customerAccount: req.user._id });
    if (!order) return res.status(404).json({ message: 'Order details could not be verified.' });

    if (order.status === 'pending_payment') {
      const updated = await service.releaseReservation(order._id, 'cancelled');
      if (!updated) return res.status(409).json({ message: 'Order cannot be cancelled in its current status.' });
      await Order.updateOne({ _id: order._id }, {
        $push: {
          statusHistory: {
            action: 'cancelled_by_customer',
            actor: req.user._id,
            detail: input.reason || 'Customer cancelled pending order.',
            at: new Date(),
          },
        },
      });
      const current = await Order.findById(order._id);
      orderMails.sendOrderCancelled(current);
      return res.json({
        orderNumber: current.orderNumber,
        status: current.status,
        message: 'Order cancelled.',
      });
    }

    if (['paid', 'processing'].includes(order.status)) {
      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          customerAccount: req.user._id,
          status: { $in: ['paid', 'processing'] },
        },
        {
          $set: {
            status: 'refund_pending',
            paymentStatus: 'refund_pending',
            refundRequestedAt: new Date(),
            refundExpectedAmount: order.total,
          },
          $push: {
            statusHistory: {
              action: 'cancelled_by_customer',
              actor: req.user._id,
              detail: input.reason || 'Customer cancelled order.',
              at: new Date(),
            },
          },
        },
        { new: true }
      );
      if (!updatedOrder) {
        return res.status(409).json({ message: 'Order cannot be cancelled in its current status.' });
      }

      const refund = await startFullRefund(updatedOrder, req.user._id);
      orderMails.sendOrderCancelled(updatedOrder);

      return res.json({
        orderNumber: updatedOrder.orderNumber,
        status: updatedOrder.status,
        refundId: refund?.id,
        message: 'Order cancelled and refund requested.',
      });
    }

    return res.status(409).json({ message: 'Order cannot be cancelled in its current status.' });
  } catch (error) { next(error); }
};