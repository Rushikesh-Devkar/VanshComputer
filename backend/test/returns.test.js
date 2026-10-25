const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/modules/orders/return.service');
const controller = require('../src/modules/orders/return.controller');
const Order = require('../src/modules/orders/order.model');

const order = {
  status: 'delivered',
  deliveredAt: new Date('2026-10-20T00:00:00Z'),
  items: [{ sku: 'A', quantity: 2, unitPrice: 1000 }, { sku: 'B', quantity: 1, unitPrice: 500 }],
};

test('return eligibility requires deliveredAt and respects configured window', () => {
  assert.equal(service.isEligible(order, { returnsEnabled: true, returnWindowDays: 7 }, new Date('2026-10-25')), true);
  assert.equal(service.isEligible(order, { returnsEnabled: true, returnWindowDays: 4 }, new Date('2026-10-25')), false);
  assert.equal(service.isEligible({ ...order, deliveredAt: null }, { returnsEnabled: true, returnWindowDays: 7 }), false);
});

test('refund amount is computed from server-side order lines and deductions', () => {
  const pricedOrder = { ...order, total: 2500, shippingCharge: 100 };
  assert.equal(service.calculateRefundAmount(pricedOrder, { returnShippingMode: 'customer_ships', refundOriginalDelivery: false }), 2400);
  assert.equal(service.calculateRefundAmount(pricedOrder, { returnShippingMode: 'deduct_from_refund', returnShippingCharge: 150, refundOriginalDelivery: false }), 2250);
  assert.equal(service.calculateRefundAmount(pricedOrder, { returnShippingMode: 'customer_ships', refundOriginalDelivery: true }), 2500);
});

test('return proof validation accepts image signatures, not just MIME labels', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const fake = Buffer.from('not an image');
  assert.equal(controller.validImage(jpeg), true);
  assert.equal(controller.validImage(fake), false);
});

test('return requests expose only manager/owner actions through route middleware', () => {
  const router = require('../src/modules/orders/return.routes');
  const protectedPaths = router.stack.filter((layer) => layer.route && layer.route.path.startsWith('/admin/'));
  assert.ok(protectedPaths.length >= 3);
  assert.ok(protectedPaths.every((layer) => layer.route.stack.length === 3));
});

test('customer return routes require login and another account receives 404', async () => {
  const router = require('../src/modules/orders/return.routes');
  const createRoute = router.stack.find((layer) => layer.route && layer.route.path === '/:orderNumber/returns');
  assert.ok(createRoute.route.stack.length >= 6);
  const auth = createRoute.route.stack[1].handle;
  let status, advanced = false;
  await auth({ cookies: {} }, { status(code) { status = code; return this; }, json() { return this; } }, () => { advanced = true; });
  assert.equal(status, 401); assert.equal(advanced, false);

  const original = Order.findOne;
  let query;
  Order.findOne = async (value) => { query = value; return null; };
  try {
    const response = { status(code) { status = code; return this; }, json(value) { return value; } };
    await controller.create({ params: { orderNumber: 'VC20261025-ABCDEF12' }, user: { _id: 'customer-two' }, body: {}, files: [] }, response, (error) => { throw error; });
    assert.deepEqual(query, { orderNumber: 'VC20261025-ABCDEF12', customerAccount: 'customer-two' });
    assert.equal(status, 404);
  } finally { Order.findOne = original; }
});
