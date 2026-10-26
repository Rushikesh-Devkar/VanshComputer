const nodemailer = require('nodemailer');
let missingMailWarningLogged = false;

const env = (name) => String(process.env[name] || '').trim();
const smtpSecure = () => env('SMTP_SECURE').toLowerCase() === 'true';

function isMailConfigured() {
  return !!(env('SMTP_HOST') && Number(env('SMTP_PORT')) > 0 && env('SMTP_USER')
    && env('SMTP_PASS') && ['true', 'false'].includes(env('SMTP_SECURE').toLowerCase())
    && env('MAIL_FROM') && env('APP_BASE_URL'));
}

function warnMailNotConfigured() {
  if (missingMailWarningLogged) return;
  missingMailWarningLogged = true;
  console.warn('mail not configured, reset email not sent');
}

function createTransport() {
  return nodemailer.createTransport({
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PORT')),
    secure: smtpSecure(),
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

async function sendMail({ to, subject, text, html }) {
  if (!isMailConfigured()) return false;
  try {
    await createTransport().sendMail({ from: env('MAIL_FROM'), to, subject, text, html });
    return true;
  } catch (_) {
    console.warn('Email delivery failed.');
    return false;
  }
}

module.exports = { isMailConfigured, sendMail, warnMailNotConfigured };
