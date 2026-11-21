const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEnv,
  isProd,
  baseUrl,
  validPublicUrl,
  validateEnvironment,
} = require('../src/config/env');

const savedKeys = ['NODE_ENV', 'PAYMENT_MODE', 'APP_BASE_URL', 'CLIENT_ORIGIN', 'JWT_SECRET'];

function saveEnv() {
  return Object.fromEntries(savedKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved) {
  for (const key of savedKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  normalizeEnv();
}

test('APP_BASE_URL requires a public HTTPS origin in production', () => {
  const saved = saveEnv();
  try {
    process.env.NODE_ENV = 'PRODUCTION';
    process.env.APP_BASE_URL = '';
    normalizeEnv();
    assert.equal(isProd(), true);
    assert.equal(validateEnvironment().valid, false);

    process.env.APP_BASE_URL = 'http://localhost:4000';
    assert.equal(validPublicUrl(process.env.APP_BASE_URL), false);
    assert.equal(validateEnvironment().valid, false);

    process.env.APP_BASE_URL = 'https://shop.example.com/';
    assert.equal(validPublicUrl(process.env.APP_BASE_URL), true);
    assert.equal(validateEnvironment().valid, true);
  } finally {
    restoreEnv(saved);
  }
});

test('baseUrl uses configured base and development fallback', () => {
  const saved = saveEnv();
  try {
    process.env.NODE_ENV = 'development';
    process.env.APP_BASE_URL = 'https://shop.example.test/';
    normalizeEnv();
    assert.equal(baseUrl(), 'https://shop.example.test');

    delete process.env.APP_BASE_URL;
    normalizeEnv();
    assert.equal(baseUrl(), 'http://localhost:4000');
  } finally {
    restoreEnv(saved);
  }
});
