const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Product = require('../src/modules/products/product.model');
const ShippingSettings = require('../src/modules/orders/shipping.model');
const Order = require('../src/modules/orders/order.model');
const { itemsSchema, addressSchema, trackingSchema } = require('../src/modules/orders/schemas');
const service = require('../src/modules/orders/order.service');
const controller = require('../src/modules/orders/order.controller');
const { buildTrackingUrl, validateHttpsUrl } = require('../src/modules/orders/tracking');
const orderMails = require('../src/utils/orderMails');

const validAddress = { line1: '12 Market Road', line2: '', city: 'Pimpri', district: 'Pune', state: 'Maharashtra', pinCode: '411018' };
const productId = '64b000000000000000000001';
const baseProduct = { _id: new mongoose.Types.ObjectId(productId), name: 'Laptop', slug: 'laptop-a', sku: 'SKU-A', type: 'new', warrantyMonths: 6, price: 12500, stock: 4, images: [] };

function mockQuoteData(product, settings) {
  Product.find = () => ({ select() { return this; }, session() { return this; }, lean: async () => [product] });
  ShippingSettings.findById = () => ({ session() { return this; }, select() { return this; }, lean: async () => settings });
}

test('courier tracking URLs are HTTPS and never accept javascript URLs', () => {
  assert.equal(buildTrackingUrl('Delhivery', 'AWB123'), 'https://www.delhivery.com/track/package/AWB123');
  assert.equal(buildTrackingUrl('Local delivery (own person)', 'AWB123'), '');
  assert.equal(buildTrackingUrl('Other', 'AWB123', 'https://courier.example/track/{awb}'), 'https://courier.example/track/AWB123');
  assert.equal(validateHttpsUrl('javascript:alert(1)'), false);
  assert.equal(validateHttpsUrl('http://courier.example/track/{awb}'), false);
  assert.equal(validateHttpsUrl('https://courier.example/track/{awb}'), true);
});

test('restockOrder is idempotent and restores refurbished stock to 1', async () => {
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const originalProductUpdate = Product.updateOne;
  let stockUpdate = null;
  let claimCount = 0;
  try {
    Order.findOneAndUpdate = async (filter) => {
      claimCount++;
      if (filter.stockRestored === false && claimCount === 1) {
        return {
          _id: 'order-refurbished-id',
          items: [{ product: productId, quantity: 1, type: 'refurbished' }],
        };
      }
      return null;
    };
    Product.updateOne = async (filter, update) => {
      stockUpdate = { filter, update };
      return { modifiedCount: 1 };
    };
    const session = {};
    const first = await service.restockOrder('order-refurbished-id', session);
    const second = await service.restockOrder('order-refurbished-id', session);
    assert.equal(first.restored, true);
    assert.equal(second.restored, false);
    assert.equal(claimCount, 2);
    assert.equal(stockUpdate.filter._id, productId);
    assert.deepEqual(stockUpdate.update[0].$set.stock.$add, [{ $ifNull: ['$stock', 0] }, 1]);
    assert.equal(stockUpdate.update[1].$set.status.$cond[1], 'active');
  } finally {
    Order.findOneAndUpdate = originalFindOneAndUpdate;
    Product.updateOne = originalProductUpdate;
  }
});

test('checkout item schema rejects client supplied prices and duplicate products', () => {
  assert.throws(() => itemsSchema.parse([{ productId, quantity: 1, price: 1 }]));
  assert.throws(() => itemsSchema.parse([{ productId, quantity: 1 }, { productId, quantity: 1 }]));
});

test('delivery address rejects states other than Maharashtra', () => {
  assert.equal(addressSchema.parse(validAddress).state, 'Maharashtra');
  assert.throws(() => addressSchema.parse({ ...validAddress, state: 'Gujarat' }));
});

test('order model and admin status enums include out for delivery', () => {
  assert.ok(Order.schema.path('status').enumValues.includes('out_for_delivery'));
  assert.ok(controller.adminList);
});

test('tracking schema accepts only an order number', () => {
  assert.equal(trackingSchema.parse({ orderNumber: 'VC20261025-ABCDEF12' }).orderNumber, 'VC20261025-ABCDEF12');
  assert.equal(trackingSchema.parse({}).orderNumber, undefined);
  assert.throws(() => trackingSchema.parse({ orderNumber: 'VC20261025-ABCDEF12', phone: '9999999999' }));
});

test('tracking requires customer login and returns 404 for another customer order', async () => {
  const routes = require('../src/modules/orders/orders.routes');
  const layer = routes.stack.find((item) => item.route && item.route.path === '/track');
  const auth = layer.route.stack[1].handle;
  let status, body, advanced = false;
  await auth({ cookies: {} }, { status(code) { status = code; return this; }, json(value) { body = value; } }, () => { advanced = true; });
  assert.equal(status, 401); assert.equal(advanced, false); assert.equal(body.message, 'Login required');

  const original = Order.findOne;
  let query;
  Order.findOne = (value) => ({ select: async () => { query = value; return null; } });
  try {
    const response = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
    await controller.track({ body: { orderNumber: 'VC20261025-ABCDEF12' }, user: { _id: 'customer-two' } }, response, (error) => { throw error; });
    assert.deepEqual(query, { orderNumber: 'VC20261025-ABCDEF12', customerAccount: 'customer-two' });
    assert.equal(status, 404); assert.equal(body.message, 'Order details could not be verified.');
  } finally { Order.findOne = original; }
});

test('logged-in tracking without an order number selects the latest customer order', async () => {
  const original = Order.findOne;
  let query;
  let sort;
  Order.findOne = (value) => {
    query = value;
    return {
      select() {
        return {
          sort(value) {
            sort = value;
            return Promise.resolve({ orderNumber: 'VC20261121-12345678', status: 'shipped' });
          }
        };
      }
    };
  };
  try {
    const response = {
      status() { return this; },
      json(value) { this.body = value; return this; }
    };
    await controller.track({ body: {}, user: { _id: 'customer-one' } }, response, (error) => { throw error; });
    assert.deepEqual(query, { customerAccount: 'customer-one' });
    assert.deepEqual(sort, { createdAt: -1 });
    assert.equal(response.body.orderNumber, 'VC20261121-12345678');
  } finally { Order.findOne = original; }
});

test('quote uses current database price and free delivery defaults', async () => {
  mockQuoteData(baseProduct, { freeDeliveryEnabled: true, freeDeliveryMinimum: null, maharashtraCharge: null });
  const quote = await service.priceQuote([{ productId, quantity: 2 }], validAddress);
  assert.equal(quote.subtotal, 25000);
  assert.equal(quote.discount, 0);
  assert.equal(quote.shippingCharge, 0);
  assert.equal(quote.total, 25000);
  assert.equal(quote.items[0].unitPrice, baseProduct.price);
});

test('shipping charge applies when free delivery is off', async () => {
  mockQuoteData(baseProduct, { freeDeliveryEnabled: false, maharashtraCharge: 450 });
  const quote = await service.priceQuote([{ productId, quantity: 1 }], validAddress);
    assert.equal(quote.shippingCharge, 550);
  assert.equal(quote.total, 13050);
});

test('free-delivery minimum is evaluated using the current database subtotal', async () => {
  mockQuoteData(baseProduct, { freeDeliveryEnabled: true, freeDeliveryMinimum: 20000, maharashtraCharge: 350 });
  const below = await service.priceQuote([{ productId, quantity: 1 }], validAddress);
  const above = await service.priceQuote([{ productId, quantity: 2 }], validAddress);
    assert.equal(below.shippingCharge, 550);
  assert.equal(above.shippingCharge, 0);
  assert.equal(below.shippingRuleSnapshot.freeDeliveryApplied, false);
  assert.equal(above.shippingRuleSnapshot.freeDeliveryApplied, true);
});

test('free delivery ON with no minimum and no end date applies to every order', async () => {
  mockQuoteData(baseProduct, { freeDeliveryEnabled: true, freeDeliveryMinimum: null, freeDeliveryEndsAt: null });
  const quote = await service.priceQuote([{ productId, quantity: 1 }], validAddress);
  assert.equal(quote.shippingCharge, 0);
  assert.equal(quote.shippingRuleSnapshot.freeDeliveryApplied, true);
});

test('free delivery is applied by default when shipping settings were never saved', async () => {
  mockQuoteData(baseProduct, null);
  const quote = await service.priceQuote([{ productId, quantity: 1 }], validAddress);
  assert.equal(quote.shippingCharge, 0);
});

test('an expired free delivery offer charges the courier rate', async () => {
  mockQuoteData(baseProduct, { freeDeliveryEnabled: true, freeDeliveryMinimum: null, freeDeliveryEndsAt: new Date(Date.now() - 86400000) });
  const quote = await service.priceQuote([{ productId, quantity: 1 }], validAddress);
  assert.equal(quote.shippingCharge, 550);
});

test('quote rejects unavailable stock and refurbished quantity above one', async () => {
  mockQuoteData({ ...baseProduct, stock: 0 }, { freeDeliveryEnabled: true, freeDeliveryMinimum: null });
  await assert.rejects(service.priceQuote([{ productId, quantity: 1 }], validAddress), { status: 409 });
  mockQuoteData({ ...baseProduct, type: 'refurbished', stock: 3 }, { freeDeliveryEnabled: true, freeDeliveryMinimum: null });
  await assert.rejects(service.priceQuote([{ productId, quantity: 2 }], validAddress), { status: 409 });
});

test('reservation rejects a stock conflict from the atomic database update', async () => {
  mockQuoteData(baseProduct, { freeDeliveryEnabled: true, freeDeliveryMinimum: null });
  const originalStartSession = mongoose.startSession;
  const originalUpdateOne = Product.updateOne;
  const originalCreate = Order.create;
  let created = false;
  mongoose.startSession = async () => ({ withTransaction: (callback) => callback(), endSession: async () => {} });
  Product.updateOne = async () => ({ modifiedCount: 0 });
  Order.create = async () => { created = true; return []; };
  try {
    await assert.rejects(service.reserveAndCreate({ customer: { name: 'A', phone: '+919999999999' }, address: validAddress, items: [{ productId, quantity: 1 }], reservationMinutes: 15 }), { status: 409 });
    assert.equal(created, false);
  } finally {
    mongoose.startSession = originalStartSession; Product.updateOne = originalUpdateOne; Order.create = originalCreate;
  }
});

test('a stale client quote is rejected before any stock is reserved', async () => {
  mockQuoteData(baseProduct, { freeDeliveryEnabled: true, freeDeliveryMinimum: null });
  const originalStartSession = mongoose.startSession;
  const originalUpdateOne = Product.updateOne;
  let stockUpdateAttempted = false;
  mongoose.startSession = async () => ({ withTransaction: (callback) => callback(), endSession: async () => {} });
  Product.updateOne = async () => { stockUpdateAttempted = true; return { modifiedCount: 1 }; };
  try {
    await assert.rejects(service.reserveAndCreate({ customer: { name: 'A', phone: '+919999999999' }, address: validAddress, items: [{ productId, quantity: 1 }], expectedTotal: 1, reservationMinutes: 15 }), { status: 409 });
    assert.equal(stockUpdateAttempted, false);
  } finally { mongoose.startSession = originalStartSession; Product.updateOne = originalUpdateOne; }
});

test('Razorpay signature verifier accepts only matching HMAC signatures', () => {
  const message = 'order_test|payment_test';
  const crypto = require('node:crypto');
  const signature = crypto.createHmac('sha256', 'test-secret').update(message).digest('hex');
  assert.equal(controller.verifySignature(message, signature, 'test-secret'), true);
  assert.equal(controller.verifySignature(message, '0'.repeat(64), 'test-secret'), false);
});

test('Live Razorpay configuration passes readiness checks without accepting test keys', () => {
  const saved = {
    mode: process.env.PAYMENT_MODE,
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  };
  try {
    process.env.PAYMENT_MODE = 'live';
    process.env.RAZORPAY_KEY_ID = 'rzp_live_example123';
    process.env.RAZORPAY_KEY_SECRET = 'live-secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';
    assert.equal(controller.gatewayReady(), true);
    process.env.RAZORPAY_KEY_ID = 'rzp_test_example123';
    assert.equal(controller.gatewayReady(), false);
  } finally {
    for (const [key, value] of Object.entries({
      PAYMENT_MODE: saved.mode,
      RAZORPAY_KEY_ID: saved.keyId,
      RAZORPAY_KEY_SECRET: saved.keySecret,
      RAZORPAY_WEBHOOK_SECRET: saved.webhookSecret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('create reuses a live prior checkout but rejects an expired prior checkout', async () => {
  const crypto = require('node:crypto');
  const saved = {
    mode: process.env.PAYMENT_MODE,
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  };
  process.env.PAYMENT_MODE = 'test';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_example123';
  process.env.RAZORPAY_KEY_SECRET = 'test-secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';

  const accessToken = 'A'.repeat(43);
  const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
  const body = {
    customer: { name: 'Test User', phone: '9999999999', email: 'test@example.com', gstin: '' },
    address: validAddress,
    items: [{ productId, quantity: 1 }],
    expectedTotal: 12500,
    checkoutRequestId: '123e4567-e89b-42d3-a456-426614174000',
    accessToken,
    termsAccepted: true,
    policyVersion: '2026-01',
  };
  const req = { body, user: { role: 'customer', email: 'test@example.com', _id: 'customer-one' } };
  const originalFindOne = Order.findOne;

  try {
    let status;
    let payload;
    const res = {
      status(code) { status = code; return this; },
      json(value) { payload = value; return this; },
    };
    const pending = {
      orderNumber: 'VC20261121-12345678',
      status: 'pending_payment',
      reservationExpiresAt: new Date(Date.now() + 600000),
      razorpayOrderId: 'order_pending',
      accessTokenHash,
      total: 12500,
      currency: 'INR',
      customer: { name: 'Test User', email: 'test@example.com', phone: '9999999999' },
      items: [{ name: 'Laptop', quantity: 1, unitPrice: 12500, warrantyMonths: 6 }],
    };
    Order.findOne = () => ({ select: async () => pending });
    await controller.create(req, res, (error) => { throw error; });
    assert.equal(status, 200);
    assert.equal(payload.orderNumber, pending.orderNumber);
    assert.equal(payload.razorpayOrderId, 'order_pending');

    status = undefined;
    payload = undefined;
    const expired = { ...pending, reservationExpiresAt: new Date(Date.now() - 1), razorpayOrderId: 'order_expired' };
    Order.findOne = () => ({ select: async () => expired });
    await controller.create(req, res, (error) => { throw error; });
    assert.equal(status, 409);
    assert.equal(payload.message, 'This checkout has ended. Please start again.');
  } finally {
    Order.findOne = originalFindOne;
    for (const [key, value] of Object.entries({
      PAYMENT_MODE: saved.mode,
      RAZORPAY_KEY_ID: saved.keyId,
      RAZORPAY_KEY_SECRET: saved.keySecret,
      RAZORPAY_WEBHOOK_SECRET: saved.webhookSecret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('verifyPayment marks a matching captured Razorpay payment paid', async () => {
  const crypto = require('node:crypto');
  const saved = {
    mode: process.env.PAYMENT_MODE,
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  };
  const originalFetch = global.fetch;
  const originalFindOne = Order.findOne;
  const originalFindById = Order.findById;
  const originalUpdateOne = Order.updateOne;
  try {
    process.env.PAYMENT_MODE = 'test';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_example123';
    process.env.RAZORPAY_KEY_SECRET = 'test-secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';
    const order = {
      _id: 'order-db-id',
      orderNumber: 'VC20261121-12345678',
      razorpayOrderId: 'order_123',
      total: 12500,
      status: 'pending_payment',
      paymentStatus: 'created',
      reservationExpiresAt: new Date(Date.now() + 600000),
    };
    let state = { ...order };
    const paymentId = 'pay_123';
    const message = `${order.razorpayOrderId}|${paymentId}`;
    const signature = crypto.createHmac('sha256', 'test-secret').update(message).digest('hex');

    global.fetch = async () => ({
      ok: true,
      json: async () => ({ id: paymentId, order_id: order.razorpayOrderId, status: 'captured', amount: 1250000, currency: 'INR' }),
    });
    Order.findOne = async () => order;
    Order.findById = () => ({
      select: async () => ({ ...state }),
    });
    Order.updateOne = async (_filter, update) => {
      if (update.$set?.status === 'paid') state = { ...state, ...update.$set };
      return { modifiedCount: update.$set?.status === 'paid' ? 1 : 0 };
    };

    let statusCode;
    let body;
    const res = {
      status(code) { statusCode = code; return this; },
      json(value) { body = value; return this; },
    };
    await controller.verifyPayment({
      params: { orderNumber: order.orderNumber },
      body: { razorpay_order_id: order.razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature },
    }, res, (error) => { throw error; });

    assert.equal(statusCode, undefined);
    assert.equal(body.status, 'paid');
    assert.equal(body.paymentStatus, 'captured');
    assert.equal(body.message, 'Payment confirmed');
  } finally {
    global.fetch = originalFetch;
    Order.findOne = originalFindOne;
    Order.findById = originalFindById;
    Order.updateOne = originalUpdateOne;
    for (const [key, value] of Object.entries({
      PAYMENT_MODE: saved.mode,
      RAZORPAY_KEY_ID: saved.keyId,
      RAZORPAY_KEY_SECRET: saved.keySecret,
      RAZORPAY_WEBHOOK_SECRET: saved.webhookSecret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('verifyPayment amount mismatch does not mark the order paid', async () => {
  const crypto = require('node:crypto');
  const saved = { mode: process.env.PAYMENT_MODE, keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET };
  const originalFetch = global.fetch;
  const originalFindOne = Order.findOne;
  const originalFindById = Order.findById;
  const originalUpdateOne = Order.updateOne;
  const originalRelease = service.releaseReservation;
  try {
    process.env.PAYMENT_MODE = 'test';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_example123';
    process.env.RAZORPAY_KEY_SECRET = 'test-secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';
    const order = { _id: 'order-db-id', orderNumber: 'VC20261121-12345678', razorpayOrderId: 'order_123', total: 12500, status: 'pending_payment', paymentStatus: 'created', reservationExpiresAt: new Date(Date.now() + 600000) };
    const paymentId = 'pay_123';
    const signature = crypto.createHmac('sha256', 'test-secret').update(`${order.razorpayOrderId}|${paymentId}`).digest('hex');
    let state = { ...order };
    global.fetch = async () => ({ ok: true, json: async () => ({ id: paymentId, order_id: order.razorpayOrderId, status: 'captured', amount: 1, currency: 'INR' }) });
    Order.findOne = async () => order;
    Order.findById = () => ({ select: async () => ({ ...state }) });
    Order.updateOne = async (_filter, update) => { if (update.$set?.status === 'refund_pending') state = { ...state, ...update.$set }; return { modifiedCount: 1 }; };
    service.releaseReservation = async (_id, status) => { state.status = status; };

    let body;
    const res = { status() { return this; }, json(value) { body = value; return this; } };
    await controller.verifyPayment({ params: { orderNumber: order.orderNumber }, body: { razorpay_order_id: order.razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } }, res, (error) => { throw error; });
    assert.notEqual(body.status, 'paid');
    assert.notEqual(body.paymentStatus, 'captured');
  } finally {
    global.fetch = originalFetch;
    Order.findOne = originalFindOne;
    Order.findById = originalFindById;
    Order.updateOne = originalUpdateOne;
    service.releaseReservation = originalRelease;
    for (const [key, value] of Object.entries({ PAYMENT_MODE: saved.mode, RAZORPAY_KEY_ID: saved.keyId, RAZORPAY_KEY_SECRET: saved.keySecret, RAZORPAY_WEBHOOK_SECRET: saved.webhookSecret })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('webhook after verify payment has no double capture effect', async () => {
  const originalFindById = Order.findById;
  const originalUpdateOne = Order.updateOne;
  let state = { status: 'pending_payment', paymentStatus: 'created', reservationExpiresAt: new Date(Date.now() + 600000) };
  let paidUpdates = 0;
  try {
    Order.findById = () => ({ select: async () => ({ ...state }) });
    Order.updateOne = async (_filter, update) => {
      if (update.$set?.status === 'paid') {
        paidUpdates++;
        state = { ...state, ...update.$set };
        return { modifiedCount: 1 };
      }
      return { modifiedCount: 0 };
    };
    const order = { _id: 'order-db-id', total: 12500 };
    assert.equal(await controller.applyCapturedPayment(order, 'pay_123', 1250000, 'INR', 'verify'), true);
    assert.equal(await controller.applyCapturedPayment(order, 'pay_123', 1250000, 'INR', 'webhook'), true);
    assert.equal(paidUpdates, 1);
  } finally {
    Order.findById = originalFindById;
    Order.updateOne = originalUpdateOne;
  }
});

test('delivery OTP rejects wrong attempts and locks after five', async () => {
  const crypto = require('node:crypto');
  const originalFindById = Order.findById;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  let attempts = 0;
  const order = {
    _id: 'order-db-id',
    orderNumber: 'VC20261121-12345678',
    status: 'shipped',
    deliveryOtpAttempts: 0,
    deliveryOtpExpiresAt: new Date(Date.now() + 600000),
    deliveryOtpHash: crypto.createHash('sha256').update('VC20261121-12345678:123456').digest('hex'),
  };
  Order.findById = () => ({ select: async () => order });
  Order.findOneAndUpdate = (filter) => {
    if (filter.deliveryOtpAttempts) {
      attempts++;
      order.deliveryOtpAttempts = attempts;
      return { select: async () => ({ deliveryOtpAttempts: attempts }) };
    }
    return null;
  };
  try {
    const response = { status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await controller.adminUpdate({ params: { id: 'order-db-id' }, body: { status: 'delivered', otp: '654321' }, user: { _id: 'manager-one', role: 'manager' } }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 400);
    assert.equal(attempts, 1);
  } finally {
    Order.findById = originalFindById;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
  }

  order.deliveryOtpAttempts = 5;
  Order.findById = () => ({ select: async () => order });
  try {
    const response = { status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await controller.adminUpdate({ params: { id: 'order-db-id' }, body: { status: 'delivered', otp: '654321' }, user: { _id: 'manager-one', role: 'manager' } }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 423);
  } finally {
    Order.findById = originalFindById;
  }
});

test('delivery OTP owner override and correct OTP mark delivered', async () => {
  const crypto = require('node:crypto');
  const originalFindById = Order.findById;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const order = {
    _id: 'order-db-id',
    orderNumber: 'VC20261121-12345678',
    status: 'shipped',
    deliveryOtpAttempts: 5,
    deliveryOtpExpiresAt: new Date(Date.now() + 600000),
    deliveryOtpHash: crypto.createHash('sha256').update('VC20261121-12345678:123456').digest('hex'),
  };
  try {
    Order.findById = () => ({ select: async () => order });
    Order.findOneAndUpdate = (_filter) => Promise.resolve({ ...order, status: 'delivered', deliveredAt: new Date() });
    let body;
    const overrideResponse = { status(code) { this.statusCode = code; return this; }, json(value) { body = value; return this; } };
    await controller.adminUpdate({ params: { id: 'order-db-id' }, body: { status: 'delivered', override: true, reason: 'Customer confirmed by phone' }, user: { _id: 'owner-one', role: 'owner' } }, overrideResponse, (error) => { throw error; });
    assert.equal(body.status, 'delivered');
  } finally {
    Order.findById = originalFindById;
  }

  order.deliveryOtpAttempts = 0;
  try {
    Order.findById = () => ({ select: async () => order });
    Order.findOneAndUpdate = (_filter) => Promise.resolve({ ...order, status: 'delivered', deliveredAt: new Date() });
    let body;
    const correctResponse = { status(code) { this.statusCode = code; return this; }, json(value) { body = value; return this; } };
    await controller.adminUpdate({ params: { id: 'order-db-id' }, body: { status: 'delivered', otp: '123456' }, user: { _id: 'manager-one', role: 'manager' } }, correctResponse, (error) => { throw error; });
    assert.equal(body.status, 'delivered');
  } finally {
    Order.findById = originalFindById;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('payment.failed webhook keeps the reservation so the customer can retry in the same popup', async () => {
  const crypto = require('node:crypto');
  const WebhookEvent = require('../src/modules/orders/webhook-event.model');
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
  const raw = Buffer.from(JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 100, currency: 'INR' } } } }));
  const signature = crypto.createHmac('sha256', 'whsec_test').update(raw).digest('hex');
  const saved = { create: WebhookEvent.create, updateOne: WebhookEvent.updateOne, findOne: Order.findOne, orderUpdate: Order.updateOne, release: service.releaseReservation };
  let released = false; let historyPushed = false;
  WebhookEvent.create = async () => ({}); WebhookEvent.updateOne = async () => ({});
  Order.findOne = async () => ({ _id: 'o1', status: 'pending_payment', total: 1, reservationExpiresAt: new Date(Date.now() + 60000) });
  Order.updateOne = async (_f, update) => { if (update.$push && update.$push.statusHistory.action === 'payment_attempt_failed') historyPushed = true; return { modifiedCount: 1 }; };
  service.releaseReservation = async () => { released = true; };
  const headers = { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'evt_1' };
  const req = { body: raw, get: (name) => headers[name.toLowerCase()] };
  let body; const res = { json: (d) => { body = d; return res; }, status() { return res; }, send() { return res; } };
  try {
    await controller.webhook(req, res, (e) => { throw e; });
    assert.equal(released, false);
    assert.equal(historyPushed, true);
    assert.deepEqual(body, { received: true });
  } finally {
    WebhookEvent.create = saved.create; WebhookEvent.updateOne = saved.updateOne; Order.findOne = saved.findOne; Order.updateOne = saved.orderUpdate; service.releaseReservation = saved.release;
  }
});

test('cancel pending: cancelMine cancels pending_payment order, releases reservation, and adds statusHistory', async () => {
  const originalFindOne = Order.findOne;
  const originalFindById = Order.findById;
  const originalUpdateOne = Order.updateOne;
  const originalRelease = service.releaseReservation;
  let releasedOrderId = null;
  let statusUpdate = null;
  const order = {
    _id: 'order-pending-id',
    orderNumber: 'VC20261121-PENDING1',
    customerAccount: 'customer-1',
    status: 'pending_payment',
    paymentStatus: 'created',
  };
  Order.findOne = async (filter) => {
    if (filter.orderNumber === 'VC20261121-PENDING1' && filter.customerAccount === 'customer-1') {
      return { ...order };
    }
    return null;
  };
  service.releaseReservation = async (orderId, status) => {
    releasedOrderId = orderId;
    return { ...order, status: 'cancelled' };
  };
  Order.updateOne = async (filter, update) => {
    statusUpdate = update;
    return { modifiedCount: 1 };
  };
  Order.findById = (id) => ({
    select: async () => ({ ...order, status: 'cancelled' }),
    lean: async () => ({ ...order, status: 'cancelled' }),
    then(resolve) { resolve({ ...order, status: 'cancelled' }); },
  });
  let statusCode = 200;
  let responseBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { responseBody = value; return this; },
  };
  try {
    await controller.cancelMine({
      params: { orderNumber: 'VC20261121-PENDING1' },
      body: { reason: 'Changed my mind' },
      user: { _id: 'customer-1', role: 'customer' },
    }, res, (error) => { throw error; });

    assert.equal(releasedOrderId, 'order-pending-id');
    assert.equal(statusCode, 200);
    assert.equal(responseBody.status, 'cancelled');
    assert.equal(responseBody.orderNumber, 'VC20261121-PENDING1');
    assert.equal(statusUpdate.$push.statusHistory.action, 'cancelled_by_customer');
    assert.equal(statusUpdate.$push.statusHistory.detail, 'Changed my mind');
  } finally {
    Order.findOne = originalFindOne;
    Order.findById = originalFindById;
    Order.updateOne = originalUpdateOne;
    service.releaseReservation = originalRelease;
  }
});

test('cancel paid: moves paid order to refund_pending, starts full refund, and emails customer', async () => {
  const originalFindOne = Order.findOne;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const originalUpdateOne = Order.updateOne;
  const originalRestock = service.restockOrder;
  const originalSendCancelled = orderMails.sendOrderCancelled;
  const originalFetch = global.fetch;
  const saved = {
    mode: process.env.PAYMENT_MODE,
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
  };
  process.env.PAYMENT_MODE = 'test';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_example123';
  process.env.RAZORPAY_KEY_SECRET = 'test-secret';

  const order = {
    _id: 'order-paid-id',
    orderNumber: 'VC20261121-PAID1234',
    customerAccount: 'customer-1',
    status: 'paid',
    paymentStatus: 'captured',
    razorpayPaymentId: 'pay_test123',
    total: 12500,
    items: [{ product: productId, quantity: 1 }],
  };
  let emailSentTo = null;
  let refundPayload = null;

  Order.findOne = async (filter) => {
    if (filter.orderNumber === 'VC20261121-PAID1234' && filter.customerAccount === 'customer-1') {
      return { ...order };
    }
    return null;
  };
  Order.findOneAndUpdate = async (filter, update) => {
    if (filter._id === 'order-paid-id' && filter.status.$in?.includes('paid')) {
      return {
        ...order,
        status: update.$set.status,
        paymentStatus: update.$set.paymentStatus,
        refundExpectedAmount: update.$set.refundExpectedAmount,
        statusHistory: [{ action: update.$push.statusHistory.action, detail: update.$push.statusHistory.detail }],
      };
    }
    return null;
  };
  Order.updateOne = async () => ({ modifiedCount: 1 });
  global.fetch = async (url, options) => {
    refundPayload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ id: 'rfnd_test999', entity: 'refund', amount: refundPayload.amount, status: 'processed' }),
    };
  };
  service.restockOrder = async () => {};
  orderMails.sendOrderCancelled = (targetOrder) => {
    emailSentTo = targetOrder.orderNumber;
  };

  let statusCode = 200;
  let responseBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { responseBody = value; return this; },
  };
  try {
    await controller.cancelMine({
      params: { orderNumber: 'VC20261121-PAID1234' },
      body: { reason: 'Found better price' },
      user: { _id: 'customer-1', role: 'customer' },
    }, res, (error) => { throw error; });

    assert.equal(statusCode, 200);
    assert.equal(responseBody.status, 'refund_pending');
    assert.equal(responseBody.refundId, 'rfnd_test999');
    assert.equal(refundPayload.amount, 1250000);
    assert.equal(emailSentTo, 'VC20261121-PAID1234');
  } finally {
    Order.findOne = originalFindOne;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
    Order.updateOne = originalUpdateOne;
    service.restockOrder = originalRestock;
    orderMails.sendOrderCancelled = originalSendCancelled;
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('cancel shipped (409): cancelMine returns 409 for already shipped order', async () => {
  const originalFindOne = Order.findOne;
  const order = {
    _id: 'order-shipped-id',
    orderNumber: 'VC20261121-SHIP1234',
    customerAccount: 'customer-1',
    status: 'shipped',
  };
  Order.findOne = async () => ({ ...order });
  let statusCode = null;
  let responseBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { responseBody = value; return this; },
  };
  try {
    await controller.cancelMine({
      params: { orderNumber: 'VC20261121-SHIP1234' },
      body: { reason: 'Need to cancel' },
      user: { _id: 'customer-1', role: 'customer' },
    }, res, (error) => { throw error; });

    assert.equal(statusCode, 409);
    assert.equal(responseBody.message, 'Order cannot be cancelled in its current status.');
  } finally {
    Order.findOne = originalFindOne;
  }
});

test('cancel another users order (404): cancelMine returns 404 for order owned by another user', async () => {
  const originalFindOne = Order.findOne;
  let queryUsed = null;
  Order.findOne = async (filter) => {
    queryUsed = filter;
    return null;
  };
  let statusCode = null;
  let responseBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { responseBody = value; return this; },
  };
  try {
    await controller.cancelMine({
      params: { orderNumber: 'VC20261121-OTHER123' },
      body: { reason: 'Testing cross-tenant cancel' },
      user: { _id: 'customer-hacker', role: 'customer' },
    }, res, (error) => { throw error; });

    assert.equal(statusCode, 404);
    assert.deepEqual(queryUsed, { orderNumber: 'VC20261121-OTHER123', customerAccount: 'customer-hacker' });
    assert.equal(responseBody.message, 'Order details could not be verified.');
  } finally {
    Order.findOne = originalFindOne;
  }
});

test('double click race: cancelMine allows only one cancellation and returns 409 for the other', async () => {
  const originalFindOne = Order.findOne;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const originalUpdateOne = Order.updateOne;
  const originalRestock = service.restockOrder;
  const originalSendCancelled = orderMails.sendOrderCancelled;
  const originalFetch = global.fetch;
  const saved = {
    mode: process.env.PAYMENT_MODE,
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
  };
  process.env.PAYMENT_MODE = 'test';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_example123';
  process.env.RAZORPAY_KEY_SECRET = 'test-secret';

  const order = {
    _id: 'order-race-id',
    orderNumber: 'VC20261121-RACE1234',
    customerAccount: 'customer-1',
    status: 'paid',
    paymentStatus: 'captured',
    razorpayPaymentId: 'pay_race123',
    total: 12500,
    items: [{ product: productId, quantity: 1 }],
  };
  let currentStatus = 'paid';
  let refundCount = 0;

  Order.findOne = async () => ({ ...order, status: currentStatus });
  Order.findOneAndUpdate = async (filter, update) => {
    if (filter.status.$in?.includes(currentStatus)) {
      currentStatus = update.$set.status;
      return {
        ...order,
        status: currentStatus,
        paymentStatus: update.$set.paymentStatus,
        statusHistory: [],
      };
    }
    return null;
  };
  Order.updateOne = async () => ({ modifiedCount: 1 });
  global.fetch = async () => {
    refundCount++;
    return {
      ok: true,
      json: async () => ({ id: 'rfnd_race', status: 'processed', amount: 1250000 }),
    };
  };
  service.restockOrder = async () => {};
  orderMails.sendOrderCancelled = () => {};

  const makeReq = () => {
    let statusCode = 200;
    let body = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(value) { body = value; return this; },
    };
    return controller.cancelMine({
      params: { orderNumber: 'VC20261121-RACE1234' },
      body: { reason: 'Double click cancel' },
      user: { _id: 'customer-1', role: 'customer' },
    }, res, (err) => { throw err; }).then(() => ({ statusCode, body }));
  };

  try {
    const [r1, r2] = await Promise.all([makeReq(), makeReq()]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    assert.deepEqual(codes, [200, 409]);
    assert.equal(refundCount, 1);
  } finally {
    Order.findOne = originalFindOne;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
    Order.updateOne = originalUpdateOne;
    service.restockOrder = originalRestock;
    orderMails.sendOrderCancelled = originalSendCancelled;
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
