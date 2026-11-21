const test = require('node:test');
const assert = require('node:assert/strict');
const mailer = require('../src/utils/mailer');
const { escapeHtml, notifyOwner } = require('../src/utils/ownerAlerts');
const Order = require('../src/modules/orders/order.model');
const orderController = require('../src/modules/orders/order.controller');

test('owner alerts mock mailer and escape dynamic HTML values', async () => {
  const originalSendMail = mailer.sendMail;
  const originalRecipient = process.env.OWNER_ALERT_EMAIL;
  const originalBaseUrl = process.env.APP_BASE_URL;
  let delivered;
  process.env.OWNER_ALERT_EMAIL = 'owner@example.com';
  process.env.APP_BASE_URL = 'https://shop.example';
  mailer.sendMail = async (value) => { delivered = value; return true; };
  try {
    notifyOwner({
      subject: 'Test alert',
      text: 'Plain text',
      html: `<p>${escapeHtml('<script>alert("x")</script>')}</p>`,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(delivered.to, 'owner@example.com');
    assert.equal(delivered.html.includes('&lt;script&gt;'), true);
    assert.equal(delivered.html.includes('<script>'), false);
  } finally {
    mailer.sendMail = originalSendMail;
    if (originalRecipient === undefined) delete process.env.OWNER_ALERT_EMAIL;
    else process.env.OWNER_ALERT_EMAIL = originalRecipient;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  }
});

test('paid transition sends one owner alert only for the atomic modification', async () => {
  const originalSendMail = mailer.sendMail;
  const originalFindById = Order.findById;
  const originalUpdateOne = Order.updateOne;
  const originalRecipient = process.env.OWNER_ALERT_EMAIL;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const deliveries = [];
  process.env.OWNER_ALERT_EMAIL = 'owner@example.com';
  process.env.APP_BASE_URL = 'https://shop.example';
  mailer.sendMail = async (value) => { deliveries.push(value); return true; };
  let paid = false;
  try {
    Order.findById = () => ({
      select: async () => paid
        ? { status: 'paid', paymentStatus: 'captured', reservationExpiresAt: new Date(Date.now() + 60000) }
        : { status: 'pending_payment', paymentStatus: 'created', reservationExpiresAt: new Date(Date.now() + 60000) },
    });
    Order.updateOne = async () => {
      if (paid) return { modifiedCount: 0 };
      paid = true;
      return { modifiedCount: 1 };
    };
    const order = {
      _id: 'order-db-id',
      orderNumber: 'VC20261121-ABCDEF12',
      total: 12500,
      items: [{ name: 'Laptop <X>', quantity: 2 }],
      customer: { name: 'Test <Owner>', phone: '+919999999999' },
      address: { line1: '12 Market Road', city: 'Pune', district: 'Pune', state: 'Maharashtra', pinCode: '411018' },
    };
    assert.equal(await orderController.applyCapturedPayment(order, 'pay_123', 1250000, 'INR', 'verify'), true);
    assert.equal(await orderController.applyCapturedPayment(order, 'pay_123', 1250000, 'INR', 'verify'), true);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].subject.includes(order.orderNumber), true);
    assert.equal(deliveries[0].html.includes('&lt;X&gt;'), true);
  } finally {
    mailer.sendMail = originalSendMail;
    Order.findById = originalFindById;
    Order.updateOne = originalUpdateOne;
    if (originalRecipient === undefined) delete process.env.OWNER_ALERT_EMAIL;
    else process.env.OWNER_ALERT_EMAIL = originalRecipient;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  }
});
