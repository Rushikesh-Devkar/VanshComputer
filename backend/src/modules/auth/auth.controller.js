const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const User = require('./user.model');

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// User na mile tab bhi same time lage (email guess rokne ke liye)
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 12);

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 12 * 60 * 60 * 1000, // 12 ghante
});

exports.login = async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok || !user.active || user.role === 'customer') {
      return res.status(401).json({ message: 'Email ya password galat hai' });
    }
    const token = jwt.sign({ sub: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.cookie('token', token, cookieOptions());
    res.json({ id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (e) { next(e); }
};

exports.logout = (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ message: 'Logged out' });
};

exports.me = (req, res) => {
  const u = req.user;
  res.json({ id: u._id, name: u.name, email: u.email, role: u.role });
};
