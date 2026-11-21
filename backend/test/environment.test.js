const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEnv, validateProductionEnvironment } = require('../src/config/env');

const keys = ['NODE_ENV', 'PAYMENT_MODE', 'JWT_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];

function saveEnv() {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved) {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  normalizeEnv();
}

test('production environment validation rejects weak or mismatched credentials', () => {
  const saved = saveEnv();
  try {
    process.env.NODE_ENV = 'PRODUCTION';
    process.env.PAYMENT_MODE = 'LIVE';
    process.env.JWT_SECRET = 'short';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_example';
    process.env.RAZORPAY_KEY_SECRET = 'key-secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';
    normalizeEnv();
    const errors = validateProductionEnvironment();
    assert.ok(errors.some((error) => error.includes('JWT_SECRET')));
    assert.ok(errors.some((error) => error.includes('rzp_live')));
  } finally {
    restoreEnv(saved);
  }
});

test('production environment validation accepts matching live credentials', () => {
  const saved = saveEnv();
  try {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_MODE = 'live';
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.RAZORPAY_KEY_ID = 'rzp_live_example';
    process.env.RAZORPAY_KEY_SECRET = 'key-secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';
    normalizeEnv();
    assert.deepEqual(validateProductionEnvironment(), []);
  } finally {
    restoreEnv(saved);
  }
});
