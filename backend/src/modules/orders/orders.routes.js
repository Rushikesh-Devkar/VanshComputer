const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole } = require('../../middleware/auth');
const c = require('./order.controller');
const shipping = require('./shipping.controller');

const quoteLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, message: { message: 'Too many price checks. Please try again later.' } });
const checkoutLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, message: { message: 'Too many checkout attempts. Please try again later.' } });
const verifyLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, message: { message: 'Too many payment verification attempts. Please try again later.' } });
const trackingLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, message: { message: 'Too many tracking attempts. Please try again later.' } });
const receiptLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, message: { message: 'Too many order detail requests. Please try again later.' } });
const mineLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, message: { message: 'Too many order requests. Please try again later.' } });
const managers = [requireAuth, requireRole('owner', 'manager')];

router.get('/shipping', shipping.get);
router.put('/shipping', ...managers, shipping.update);
router.post('/quote', quoteLimit, c.quote);
router.post('/', checkoutLimit, requireAuth('customer'), requireRole('customer'), c.create);
router.get('/mine', mineLimit, requireAuth('customer'), requireRole('customer'), c.accountOrders);
router.get('/mine/:orderNumber', receiptLimit, requireAuth('customer'), requireRole('customer'), c.mineDetail);
router.post('/track', trackingLimit, requireAuth('customer'), requireRole('customer'), c.track);
router.post('/:orderNumber/receipt', receiptLimit, c.receipt);
router.post('/:orderNumber/payment/verify', verifyLimit, c.verifyPayment);
router.get('/admin', ...managers, c.adminList);
router.patch('/admin/:id', ...managers, c.adminUpdate);
router.post('/admin/:id/refund', ...managers, c.adminRefund);

module.exports = router;
