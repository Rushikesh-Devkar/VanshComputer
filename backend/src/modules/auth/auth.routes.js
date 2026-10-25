const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../../middleware/auth');
const c = require('./auth.controller');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Bahut zyada login attempts, 15 minute baad try karo' },
});

router.post('/login', loginLimiter, c.login);
router.post('/logout', c.logout);
router.get('/me', requireAuth('staff'), c.me);

module.exports = router;
