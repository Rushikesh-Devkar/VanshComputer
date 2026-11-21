let jwtWarningLogged = false;
let clientOriginWarningLogged = false;
let appUrlWarningLogged = false;

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

function validPublicUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
  } catch (_) {
    return false;
  }
}

function baseUrl() {
  const configured = String(process.env.APP_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return 'http://localhost:4000';
}

function validateEnvironment({ exitProcess = false } = {}) {
  normalizeEnv();
  const errors = [];
  const appBaseUrl = String(process.env.APP_BASE_URL || '').trim();

  if (isProd()) {
    if (!appBaseUrl) {
      errors.push('APP_BASE_URL is required in production.');
    } else if (!validPublicUrl(appBaseUrl)) {
      errors.push('APP_BASE_URL must be an HTTPS URL and must not use localhost or 127.0.0.1.');
    }

    if (errors.length) {
      for (const error of errors) console.error(`Configuration error: ${error}`);
      if (exitProcess) process.exit(1);
    }
  } else if (!appBaseUrl && !appUrlWarningLogged) {
    appUrlWarningLogged = true;
    console.warn('APP_BASE_URL is not configured; development links will use http://localhost:4000.');
  }

  const origins = String(process.env.CLIENT_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (isProd() && origins.length) {
    for (const origin of origins) {
      if (!validPublicUrl(origin) && !clientOriginWarningLogged) {
        clientOriginWarningLogged = true;
        console.warn(`CLIENT_ORIGIN contains an invalid production URL: ${origin}. Use HTTPS origins without localhost/127.0.0.1.`);
      }
    }
  } else if (!origins.length && isProd() && !clientOriginWarningLogged) {
    clientOriginWarningLogged = true;
    console.warn('CLIENT_ORIGIN is not configured; configure the public frontend origin in production.');
  }

  return { valid: errors.length === 0, errors };
}

function isProd() {
  return process.env.NODE_ENV === 'production';
}

module.exports = { normalizeEnv, isProd, baseUrl, validPublicUrl, validateEnvironment };
