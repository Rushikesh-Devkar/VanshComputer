const test = require('node:test');
const assert = require('node:assert/strict');
const mailer = require('../src/utils/mailer');
const orderMails = require('../src/utils/orderMails');

async function flushMail() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('customer order mail uses email, escaped HTML, and order detail link', async () => {
  const originalSendMail = mailer.sendMail;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const deliveries = [];
  process.env.APP_BASE_URL = 'https://shop.example';
  mailer.sendMail = async (value) => { deliveries.push(value); return true; };
  try {
    orderMails.sendOrderConfirmed({
      orderNumber: 'VC<1>',
      customer: { email: 'customer@example.com' },
      items: [{ name: 'Laptop <X>', quantity: 2 }],
      subtotal: 10000,
      discount: 500,
      shippingCharge: 550,
      total: 10050,
      address: { line1: '12 <Market>', city: 'Pune', district: 'Pune', state: 'Maharashtra', pinCode: '411018' },
    });
    await flushMail();
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].to, 'customer@example.com');
    assert.equal(deliveries[0].subject.includes('VC<1>'), true);
    assert.equal(deliveries[0].html.includes('Laptop &lt;X&gt;'), true);
    assert.equal(deliveries[0].html.includes('12 &lt;Market&gt;'), true);
    assert.equal(deliveries[0].html.includes('https://shop.example/order-detail.html?order=VC%3C1%3E'), true);
  } finally {
    mailer.sendMail = originalSendMail;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  }
});

test('customer shipped and delivered mails include required details', async () => {
  const originalSendMail = mailer.sendMail;
  const deliveries = [];
  mailer.sendMail = async (value) => { deliveries.push(value); return true; };
  try {
    const order = { orderNumber: 'VC20261121-ABCDEF12', customer: { email: 'customer@example.com' }, courierName: 'Delhivery', trackingNumber: 'TRACK<123>' };
    orderMails.sendShipped(order);
    orderMails.sendDelivered(order, { returnsEnabled: true, returnWindowDays: 7 });
    await flushMail();
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[0].text.includes('TRACK<123>'), true);
    assert.equal(deliveries[1].text.includes('7 days'), true);
  } finally {
    mailer.sendMail = originalSendMail;
  }
});

test('customer mails skip orders and returns without email', async () => {
  const originalSendMail = mailer.sendMail;
  let calls = 0;
  mailer.sendMail = async () => { calls++; return true; };
  try {
    orderMails.sendOrderConfirmed({ orderNumber: 'VC1', customer: {} });
    orderMails.sendRefundProcessed({ orderNumber: 'VC1', customer: {} }, 100);
    orderMails.sendReturnStatus({ requestNumber: 'RR1' }, { customer: {} }, 'approved');
    orderMails.sendOrderCancelled({ orderNumber: 'VC1', customer: {} });
    await flushMail();
    assert.equal(calls, 0);
  } finally {
    mailer.sendMail = originalSendMail;
  }
});

test('customer cancelled mail sends cancellation notice and refund text when applicable', async () => {
  const originalSendMail = mailer.sendMail;
  const deliveries = [];
  mailer.sendMail = async (value) => { deliveries.push(value); return true; };
  try {
    const order = {
      orderNumber: 'VC20261121-CANCELLED',
      customer: { email: 'customer@example.com' },
      status: 'refund_pending',
      paymentStatus: 'refund_pending',
    };
    orderMails.sendOrderCancelled(order);
    await flushMail();
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].to, 'customer@example.com');
    assert.equal(deliveries[0].subject.includes('VC20261121-CANCELLED'), true);
    assert.equal(deliveries[0].text.includes('refund'), true);
  } finally {
    mailer.sendMail = originalSendMail;
  }
});
