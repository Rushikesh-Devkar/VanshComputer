// Indian mobile number ko +91XXXXXXXXXX format mein badalta hai
exports.normalizeIndianPhone = (input) => {
  let n = String(input || '').replace(/\D/g, '');
  if (n.length === 12 && n.startsWith('91')) n = n.slice(2);
  else if (n.length === 11 && n.startsWith('0')) n = n.slice(1);
  return /^[6-9]\d{9}$/.test(n) ? `+91${n}` : null;
};