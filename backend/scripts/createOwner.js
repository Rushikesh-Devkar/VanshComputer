require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../src/modules/auth/user.model');

(async () => {
  const [email, password, name = 'Owner'] = process.argv.slice(2);
  if (!email || !password || password.length < 10) {
    console.log('Use: node scripts/createOwner.js email "password-10+-chars" "Naam"');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({ name, email, passwordHash, role: 'owner' });
  console.log('Owner created:', email);
  await mongoose.disconnect();
})().catch(() => { console.error('Owner setup failed. Check database configuration and account details.'); process.exit(1); });
