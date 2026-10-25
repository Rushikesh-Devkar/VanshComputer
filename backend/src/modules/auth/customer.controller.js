const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const User = require('./user.model');
const crypto = require('crypto');
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 12);

const credentials = z.object({
  email: z.string().trim().email().max(200).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(100),
}).strict();
const loginCredentials = credentials.extend({ password: z.string().min(1).max(100) });
const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 60 * 60 * 1000 });
const publicAccount = (user) => ({ id: user._id, name: user.name, email: user.email });

exports.register = async (req, res, next) => {
  try {
    const input = credentials.extend({ name: z.string().trim().min(2).max(100) }).parse(req.body);
    if (await User.exists({ email: input.email })) return res.status(409).json({ message: 'An account with this email already exists. Sign in instead.' });
    const user = await User.create({ name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12), role: 'customer' });
    const token = jwt.sign({ sub: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.cookie('ctoken', token, cookieOptions()).status(201).json(publicAccount(user));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'An account with this email already exists. Sign in instead.' });
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const input = loginCredentials.parse(req.body);
    const user = await User.findOne({ email: input.email, role: 'customer' }).select('+passwordHash');
    const ok = await bcrypt.compare(input.password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok || !user.active) return res.status(401).json({ message: 'Email or password is incorrect.' });
    const token = jwt.sign({ sub: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.cookie('ctoken', token, cookieOptions()).json(publicAccount(user));
  } catch (error) { next(error); }
};

exports.logout = (req, res) => { res.clearCookie('ctoken', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }); res.json({ message: 'Logged out' }); };
exports.changePassword = async (req, res, next) => {
  try {
    const input = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(100) }).strict().parse(req.body);
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!await bcrypt.compare(input.currentPassword, user.passwordHash)) return res.status(400).json({ message: 'Current password is incorrect.' });
    user.passwordHash = await bcrypt.hash(input.newPassword, 12); await user.save(); res.json({ message: 'Password updated.' });
  } catch (error) { next(error); }
};
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().trim().email().max(200).transform(v => v.toLowerCase()) }).strict().parse(req.body);
    const user = await User.findOne({ email, role: 'customer' }).select('+resetTokenHash +resetTokenExpires');
    if (user) {
      const token = crypto.randomBytes(32).toString('hex'); user.resetTokenHash = crypto.createHash('sha256').update(token).digest('hex'); user.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000); await user.save();
      if (process.env.NODE_ENV !== 'production') console.info('Customer password reset link:', `${process.env.CLIENT_ORIGIN || 'http://localhost:4000'}/reset-password.html?token=${token}`);
      // TODO: Send this link through the configured mail service when customer mail delivery is added.
    }
    res.json({ message: 'If an account exists for that email, password reset instructions have been sent.' });
  } catch (error) { next(error); }
};
exports.resetPassword = async (req, res, next) => {
  try {
    const input = z.object({ token: z.string().min(32).max(200), password: z.string().min(10).max(100) }).strict().parse(req.body);
    const hash = crypto.createHash('sha256').update(input.token).digest('hex');
    const user = await User.findOne({ role: 'customer', resetTokenHash: hash, resetTokenExpires: { $gt: new Date() } }).select('+resetTokenHash +resetTokenExpires +passwordHash');
    if (!user) return res.status(400).json({ message: 'Reset link is invalid or expired.' });
    user.passwordHash = await bcrypt.hash(input.password, 12); user.resetTokenHash = undefined; user.resetTokenExpires = undefined; await user.save(); res.json({ message: 'Password reset. You can sign in now.' });
  } catch (error) { next(error); }
};

exports.me = (req, res) => res.json(publicAccount(req.user));

exports.update = async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().trim().min(2).max(100) }).strict().parse(req.body);
    req.user.name = name;
    await req.user.save();
    res.json(publicAccount(req.user));
  } catch (error) { next(error); }
};
