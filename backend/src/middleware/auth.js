const jwt = require('jsonwebtoken');
const User = require('../modules/auth/user.model');

exports.requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies.token;
    if (!token) return res.status(401).json({ message: 'Login required' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ message: 'Login required' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Session expired, dobara login karo' });
  }
};

// Role ki permission backend mein check hoti hai, sirf button chhupana kaafi nahi
exports.requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Aapko is kaam ki permission nahi hai' });
  }
  next();
};