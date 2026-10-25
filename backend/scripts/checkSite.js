const fs = require('fs');
const path = require('path');

const frontend = path.resolve(__dirname, '..', '..', 'frontend');
const files = ['js/business.js', 'terms.html', 'privacy.html', 'shipping-policy.html', 'warranty-policy.html', 'refund-policy.html'];
const placeholder = '[TO BE FILLED BY OWNER]';
const unresolved = files.filter((file) => fs.readFileSync(path.join(frontend, file), 'utf8').includes(placeholder));

if (unresolved.length) {
  console.error('Site readiness check failed. Fill owner values in:');
  unresolved.forEach((file) => console.error(' - ' + file));
  process.exit(1);
}
console.log('Site readiness check passed.');
