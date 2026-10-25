const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole } = require('../../middleware/auth');
const c = require('./lead.controller');

// Spam rokne ke liye: ek IP se 15 minute mein max 5 leads
const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Bahut zyada requests, thodi der baad try karo' },
});

const canManageLeads = [requireAuth, requireRole('owner', 'manager', 'sales')];

router.post('/', leadLimiter, c.create);
router.get('/', canManageLeads, c.list);
router.patch('/:id', canManageLeads, c.update);

module.exports = router;
