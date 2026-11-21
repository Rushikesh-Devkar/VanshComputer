let jwtWarningLogged = false;

function normalizeEnv() {
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  process.env.NODE_ENV = nodeEnv || 'development';

  const paymentMode = String(process.env.PAYMENT_MODE || '').trim().toLowerCase();
  if (process.env.PAYMENT_MODE != null) process.env.PAYMENT_MODE = paymentMode;

  if (process.env.NODE_ENV === 'production') {
    const jwtSecret = String(process.env.JWT_SECRET || '').trim();
    if (jwtSecret.length < 32 && !jwtWarningLogged) {
      jwtWarningLogged = true;
      console.warn('JWT_SECRET is shorter than 32 characters in production.');
    }
  }
}

normalizeEnv();

function validateProductionEnvironment() {
  if (!isProd()) return [];
  const errors = [];
  const jwtSecret = String(process.env.JWT_SECRET || '').trim();
  const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  const paymentMode = String(process.env.PAYMENT_MODE || '').trim().toLowerCase();

  if (jwtSecret.length < 32) errors.push('JWT_SECRET must be at least 32 characters in production.');
  if (!keyId) errors.push('RAZORPAY_KEY_ID is required in production.');
  if (!keySecret) errors.push('RAZORPAY_KEY_SECRET is required in production.');
  if (!webhookSecret) errors.push('RAZORPAY_WEBHOOK_SECRET is required in production.');
  if (!['test', 'live'].includes(paymentMode)) {
    errors.push('PAYMENT_MODE must be test or live in production.');
  } else if (paymentMode === 'live' && !/^rzp_live_/.test(keyId)) {
    errors.push('PAYMENT_MODE=live requires an rzp_live_ RAZORPAY_KEY_ID.');
  } else if (paymentMode === 'test' && !/^rzp_test_/.test(keyId)) {
    errors.push('PAYMENT_MODE=test requires an rzp_test_ RAZORPAY_KEY_ID.');
  }
  return errors;
}

function isProd() {
  return process.env.NODE_ENV === 'production';
}

module.exports = { normalizeEnv, isProd, validateProductionEnvironment };
