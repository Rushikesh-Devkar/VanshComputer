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

module.exports = { normalizeEnv, isProd: () => process.env.NODE_ENV === 'production' };
