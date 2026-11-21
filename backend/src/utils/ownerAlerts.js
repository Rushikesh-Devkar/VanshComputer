const mailer = require('./mailer');
const { baseUrl } = require('../config/env');

let missingOwnerAlertWarningLogged = false;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function appAdminUrl() {
  return `${baseUrl()}/admin.html`;
}

function notifyOwner({ subject, text, html }) {
  const recipient = String(process.env.OWNER_ALERT_EMAIL || '').trim();
  if (!recipient) {
    if (!missingOwnerAlertWarningLogged) {
      missingOwnerAlertWarningLogged = true;
      console.warn('OWNER_ALERT_EMAIL is not configured; owner alert skipped');
    }
    return;
  }

  setImmediate(() => {
    Promise.resolve(mailer.sendMail({ to: recipient, subject, text, html }))
      .catch((error) => {
        console.warn(`Owner alert delivery failed: ${error.message || 'unknown error'}`);
      });
  });
}

module.exports = { escapeHtml, appAdminUrl, notifyOwner };
