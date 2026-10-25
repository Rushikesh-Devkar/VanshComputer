const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Product = require('../src/modules/products/product.model');
const ShippingSettings = require('../src/modules/orders/shipping.model');
const Order = require('../src/modules/orders/order.model');
const { itemsSchema, addressSchema } = require('../src/modules/orders/schemas');
const service = require('../src/modules/orders/order.service');
const controller = require('../src/modules/orders/order.controller');

const validAddress = { line1: '12 Market Road', line2: '', city: 'Pimpri', district: 'Pune', state: 'Maharashtra', pinCode: '411018' };
const productId = '64b000000000000000000001';
const baseProduct = { _id: new mongoose.Types.ObjectId(productId), name: 'Laptop', slug: 'laptop-a', sku: 'SKU-A', type: 'new', warrantyMonths: 6, price: 12500, stock: 4, images: [] };

function mockQuoteData(product, settings) {
  Product.find = () => ({ select() { return this; }, session() { return this; }, lean: async () => [product] });
  ShippingSettings.findById = () => ({ session() { return this; }, lean: async () => settings });
}

test('checkout item schema rejects client supplied prices and duplicate products', () => {
  assert.throws(() => itemsSchema.parse([{ productId, quantity: 1, price: 1 }]));
  assert.throws(() => itemsSchema.parse([{ productId, quantity: 1 }, { productId, quantity: 1 }]));
});

test('delivery address rejects states other than Maharashtra', () => {
  assert.equal(addressSchema.parse(validAddress).state, 'Maharashtra');
  assert.throws(() => addressSchema.parse({ ...validAddress, state: 'Gujarat' }));
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