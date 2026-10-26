const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../src/modules/auth/user.model');
const mailer = require('../src/utils/mailer');
const customer = require('../src/modules/auth/customer.controller');
const auth = require('../src/middleware/auth');
const customerRoutes = require('../src/modules/auth/customer.routes');

const originalEnv = {};
for (const key of ['NODE_ENV', 'APP_BASE_URL', 'JWT_SECRET']) originalEnv[key] = process.env[key];
process.env.NODE_ENV = 'development';
process.env.APP_BASE_URL = 'https://shop.example.test/';
process.env.JWT_SECRET = 'unit-test-secret-that-is-long-enough';

const flushBackground = () => new Promise((resolve) => setTimeout(resolve, 25));
function response() {
  return {
    code: 200,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('forgot-password persists only a hashed token and emails a base-URL link', async () => {
  const saved = [];
  const user = { email: 'buyer@example.test', name: 'Buyer <Customer>', async save() { saved.push({ ...this }); } };
  const originalFindOne = User.findOne;
  const originalRandomBytes = crypto.randomBytes;
  const originalIsConfigured = mailer.isMailConfigured;
  const originalSendMail = mailer.sendMail;
  const messages = [];
  const raw = Buffer.alloc(32, 0xab);
  User.findOne = () => ({ select: async () => user });
  crypto.randomBytes = (size) => size === 32 ? raw : originalRandomBytes(size);
  mailer.isMailConfigured = () => true;
  mailer.sendMail = async (mail) => { messages.push(mail); return true; };
  try {
    const res = response();
    await customer.forgotPassword({ body: { email: ' Buyer@Example.Test ' } }, res, (error) => { throw error; });
    assert.equal(res.code, 200);
    assert.equal(res.body.message, 'If an account exists for that email, we have sent a reset link. Check your inbox and spam folder.');
    await flushBackground();
    const rawToken = raw.toString('hex');
    assert.equal(saved.length, 1);
    assert.equal(user.resetTokenHash, crypto.createHash('sha256').update(rawToken).digest('hex'));
    assert.equal(user.resetTokenHash.includes(rawToken), false);
    assert.ok(user.resetTokenExpires > new Date());
    assert.ok(user.resetTokenExpires < new Date(Date.now() + 30 * 60 * 1000 + 1000));
    assert.equal(messages.length, 1);
    assert.match(messages[0].text, new RegExp(`https://shop\\.example\\.test/reset-password\\.html\\?token=${rawToken}`));
    assert.match(messages[0].html, /Buyer &lt;Customer&gt;/);
  } finally {
    User.findOne = originalFindOne;
    crypto.randomBytes = originalRandomBytes;
    mailer.isMailConfigured = originalIsConfigured;
    mailer.sendMail = originalSendMail;
  }
});

test('forgot-password is generic for unknown accounts and applies the per-email limit', async () => {
  const originalFindOne = User.findOne;
  let lookups = 0;
  User.findOne = () => ({ select: async () => { lookups++; return null; } });
  try {
    for (let index = 0; index < 4; index++) {
      const res = response();
      await customer.forgotPassword({ body: { email: 'missing-four@example.test' } }, res, (error) => { throw error; });
      assert.equal(res.code, 200);
      assert.equal(res.body.message, 'If an account exists for that email, we have sent a reset link. Check your inbox and spam folder.');
    }
    await flushBackground();
    assert.equal(lookups, 3);
  } finally { User.findOne = originalFindOne; }
});

test('production without SMTP does not log a reset link', async () => {
  const originalEnvValue = process.env.NODE_ENV;
  const originalFindOne = User.findOne;
  const originalIsConfigured = mailer.isMailConfigured;
  const originalWarn = mailer.warnMailNotConfigured;
  const originalInfo = console.info;
  const warnings = [];
  const infos = [];
  const user = { email: 'prod@example.test', async save() {} };
  process.env.NODE_ENV = 'production';
  User.findOne = () => ({ select: async () => user });
  mailer.isMailConfigured = () => false;
  mailer.warnMailNotConfigured = () => warnings.push('mail not configured, reset email not sent');
  console.info = (...args) => infos.push(args.join(' '));
  try {
    const res = response();
    await customer.forgotPassword({ body: { email: 'prod@example.test' } }, res, (error) => { throw error; });
    await flushBackground();
    assert.equal(res.code, 200);
    assert.deepEqual(warnings, ['mail not configured, reset email not sent']);
    assert.deepEqual(infos, []);
  } finally {
    process.env.NODE_ENV = originalEnvValue;
    User.findOne = originalFindOne;
    mailer.isMailConfigured = originalIsConfigured;
    mailer.warnMailNotConfigured = originalWarn;
    console.info = originalInfo;
  }
});

test('reset rejects weak, invalid, and expired tokens with generic errors', async () => {
  const originalFindOne = User.findOne;
  const queries = [];
  User.findOne = (query) => ({ select: async () => { queries.push(query); return null; } });
  try {
    const weak = response();
    let weakError;
    await customer.resetPassword({ body: { token: 'a'.repeat(64), password: 'short' } }, weak, (error) => { weakError = error; });
    assert.ok(weakError);
    assert.equal(weak.code, 200);
    const invalid = response();
    await customer.resetPassword({ body: { token: 'b'.repeat(64), password: 'long-password-123' } }, invalid, (error) => { throw error; });
    const expired = response();
    await customer.resetPassword({ body: { token: 'c'.repeat(64), password: 'long-password-123' } }, expired, (error) => { throw error; });
    assert.equal(invalid.code, 400);
    assert.equal(invalid.body.message, expired.body.message);
    assert.match(invalid.body.message, /invalid or expired/i);
    assert.ok(queries.every((query) => query.resetTokenExpires.$gt instanceof Date));
  } finally { User.findOne = originalFindOne; }
});

test('successful reset clears the token, hashes password, and sets passwordChangedAt', async () => {
  const raw = 'd'.repeat(64);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const originalFindOne = User.findOne;
  const originalIsConfigured = mailer.isMailConfigured;
  const originalSendMail = mailer.sendMail;
  const messages = [];
  const user = {
    resetTokenHash: hash,
    resetTokenExpires: new Date(Date.now() + 60000),
    passwordHash: 'old-hash',
    async save() {},
  };
  User.findOne = (query) => {
    assert.equal(query.resetTokenHash, hash);
    assert.ok(query.resetTokenExpires.$gt instanceof Date);
    return { select: async () => user.resetTokenHash === hash ? user : null };
  };
  mailer.isMailConfigured = () => true;
  mailer.sendMail = async (mail) => { messages.push(mail); return true; };
  try {
    const res = response();
    await customer.resetPassword({ body: { token: raw, password: 'new-strong-password' } }, res, (error) => { throw error; });
    await flushBackground();
    assert.equal(res.code, 200);
    assert.equal(user.resetTokenHash, undefined);
    assert.equal(user.resetTokenExpires, undefined);
    assert.ok(user.passwordChangedAt instanceof Date);
    assert.notEqual(user.passwordHash, 'old-hash');
    assert.equal(await bcrypt.compare('new-strong-password', user.passwordHash), true);
    assert.equal(messages.length, 1);
    assert.match(messages[0].subject, /password was changed/i);
    const reused = response();
    await customer.resetPassword({ body: { token: raw, password: 'another-strong-password' } }, reused, (error) => { throw error; });
    assert.equal(reused.code, 400);
  } finally {
    User.findOne = originalFindOne;
    mailer.isMailConfigured = originalIsConfigured;
    mailer.sendMail = originalSendMail;
  }
});

test('customer middleware rejects pre-reset sessions without affecting staff sessions', async () => {
  const originalFindById = User.findById;
  const passwordChangedAt = new Date(Date.now());
  User.findById = async (id) => id === 'staff-id'
    ? { active: true, role: 'owner', passwordChangedAt }
    : { active: true, role: 'customer', passwordChangedAt };
  const oldToken = jwt.sign({ sub: 'customer-id', role: 'customer', iat: Math.floor((passwordChangedAt.getTime() - 5000) / 1000) }, process.env.JWT_SECRET);
  const staffToken = jwt.sign({ sub: 'staff-id', role: 'owner', iat: Math.floor((passwordChangedAt.getTime() - 5000) / 1000) }, process.env.JWT_SECRET);
  try {
    let customerStatus;
    await auth.requireAuth('customer')({ cookies: { ctoken: oldToken } }, { status(code) { customerStatus = code; return this; }, json() { return this; } }, () => {});
    assert.equal(customerStatus, 401);
    let staffAdvanced = false;
    await auth.requireAuth('staff')({ cookies: { token: staffToken } }, { status(code) { return this; }, json() { return this; } }, () => { staffAdvanced = true; });
    assert.equal(staffAdvanced, true);
  } finally { User.findById = originalFindById; }
});

test('forgot-password IP limiter returns 429 after five requests', async () => {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  app.use('/api/customer', customerRoutes);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const originalFindOne = User.findOne;
  User.findOne = () => ({ select: async () => null });
  const address = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  try {
    const statuses = [];
    for (let index = 0; index < 6; index++) {
      const result = await fetch(`http://127.0.0.1:${server.address().port}/api/customer/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': address },
        body: JSON.stringify({ email: `rate-${address}@example.test` }),
      });
      statuses.push(result.status);
      await result.arrayBuffer();
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  } finally {
    User.findOne = originalFindOne;
    await new Promise((resolve) => server.close(resolve));
  }
});

test.after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
