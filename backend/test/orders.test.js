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
  assert.equal(quote.shippingCharge, 450);
  assert.equal(quote.total, 12950);
});

test('free-delivery minimum is evaluated using the current database subtotal', async () => {
  mockQuoteData(baseProduct, { freeDeliveryEnabled: true, freeDeliveryMinimum: 20000, maharashtraCharge: 350 });
  const below = await service.priceQuote([{ productId, quantity: 1 }], validAddress);
  const above = await service.priceQuote([{ productId, quantity: 2 }], validAddress);
  assert.equal(below.shippingCharge, 350);
  assert.equal(above.shippingCharge, 0);
  assert.equal(below.shippingRuleSnapshot.freeDeliveryApplied, false);
  assert.equal(above.shippingRuleSnapshot.freeDeliveryApplied, true);
});

test('shipping is not guessed when a non-free shipping price is not configured', async () => {
  mockQuoteData(baseProduct, { freeDeliveryEnabled: false, maharashtraCharge: null });
  await assert.rejects(service.priceQuote([{ productId, quantity: 1 }], validAddress), { status: 503 });
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
