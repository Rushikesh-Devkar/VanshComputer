let noneWarningLogged = false;

async function sendSms(phone, text) {
  const provider = String(process.env.SMS_PROVIDER || 'none').trim().toLowerCase();
  const recipient = String(phone || '').trim();
  if (!recipient) return false;

  if (provider === 'none') {
    if (!noneWarningLogged) {
      noneWarningLogged = true;
      console.warn('SMS_PROVIDER=none; delivery SMS not sent.');
    }
    return false;
  }

  try {
    if (provider === 'msg91') {
      if (!process.env.MSG91_AUTH_KEY || !process.env.MSG91_TEMPLATE_ID) {
        console.warn('MSG91 SMS configuration is incomplete.');
        return false;
      }
      const response = await fetch('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: { authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: [{ mobiles: recipient.replace(/\D/g, '') }],
          template_id: process.env.MSG91_TEMPLATE_ID,
          message: text,
        }),
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    }

    if (provider === 'fast2sms') {
      if (!process.env.FAST2SMS_API_KEY) {
        console.warn('FAST2SMS SMS configuration is incomplete.');
        return false;
      }
      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: { authorization: process.env.FAST2SMS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'q', message: text, numbers: recipient.replace(/\D/g, '') }),
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    }

    console.warn(`Unsupported SMS_PROVIDER "${provider}"; delivery SMS not sent.`);
    return false;
  } catch (error) {
    console.warn(`Delivery SMS failed: ${error.message || 'unknown error'}`);
    return false;
  }
}

module.exports = { sendSms };
