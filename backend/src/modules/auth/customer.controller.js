const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const User = require('./user.model');
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 12);

const credentials = z.object({
  email: z.string().trim().email().max(200).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(100),
}).strict();
const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 60 * 60 * 1000 });
const publicAccount = (user) => ({ id: user._id, name: user.name, email: user.email });

exports.register = async (req, res, next) => {
  try {
    const input = credentials.extend({ name: z.string().trim().min(2).max(100) }).parse(req.body);
    if (await User.exists({ email: input.email })) return res.status(409).json({ message: 'An account with this email already exists. Sign in instead.' });
    const user = await User.create({ name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12), role: 'customer' });
    const token = jwt.sign({ sub: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.cookie('token', token, cookieOptions()).status(201).json(publicAccount(user));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'An account with this email already exists. Sign in instead.' });
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const input = credentials.parse(req.body);
    const user = await User.findOne({ email: input.email, role: 'customer' }).select('+passwordHash');
    const ok = await bcrypt.compare(input.password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok || !user.active) return res.status(401).json({ message: 'Email or password is incorrect.' });
    const token = jwt.sign({ sub: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.cookie('token', token, cookieOptions()).json(publicAccount(user));
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
