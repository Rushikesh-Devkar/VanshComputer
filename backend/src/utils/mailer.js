const nodemailer = require('nodemailer');
let missingMailWarningLogged = false;

const env = (name) => String(process.env[name] || '').trim();
const smtpSecure = () => env('SMTP_SECURE').toLowerCase() === 'true';

function hasSmtpConfig() {
  return !!(env('SMTP_HOST') && Number(env('SMTP_PORT')) > 0 && env('SMTP_USER')
    && env('SMTP_PASS') && ['true', 'false'].includes(env('SMTP_SECURE').toLowerCase())
    && env('MAIL_FROM') && env('APP_BASE_URL'));
}

function hasBrevoConfig() {
  return !!(env('BREVO_API_KEY') && env('MAIL_FROM'));
}

function isMailConfigured() {
  return hasBrevoConfig() || hasSmtpConfig();
}

function warnMailNotConfigured() {
  if (missingMailWarningLogged) return;
  missingMailWarningLogged = true;
  console.warn('mail not configured, reset email not sent');
}

function parseMailFrom(value) {
  const raw = value || '';
  const match = raw.match(/^(.+)\s*<([^<>]+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: '', email: raw.trim() };
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

async function sendBrevoMail({ to, subject, text, html }) {
  const apiKey = env('BREVO_API_KEY');
  if (!apiKey) return false;
  const sender = parseMailFrom(env('MAIL_FROM'));
  const payload = {
    sender: { name: sender.name, email: sender.email },
    to: [{ email: String(to).trim() }],
    subject,
    htmlContent: html,
    textContent: text,
  };

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const status = response.status || 'unknown';
      console.warn(`Email delivery failed (HTTP ${status}).`);
      return false;
    }
    return true;
  } catch (error) {
    const status = error?.status || error?.cause?.code || 'unknown';
    if (status !== 'unknown' && String(status).match(/^\d+$/)) {
      console.warn(`Email delivery failed (HTTP ${status}).`);
    } else {
      console.warn('Email delivery failed.');
    }
    return false;
  }
}

async function sendMail({ to, subject, text, html }) {
  if (!isMailConfigured()) return false;
  if (env('BREVO_API_KEY')) return sendBrevoMail({ to, subject, text, html });
  try {
    await createTransport().sendMail({ from: env('MAIL_FROM'), to, subject, text, html });
    return true;
  } catch (error) {
    const details = [error.code, error.responseCode, error.command, error.message]
      .filter(Boolean)
      .join(' ');
    console.warn(`Email delivery failed${details ? `: ${details}` : '.'}`);
    return false;
  }
}

module.exports = { isMailConfigured, sendMail, warnMailNotConfigured };
