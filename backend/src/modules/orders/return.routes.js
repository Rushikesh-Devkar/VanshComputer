const router = require('express').Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole } = require('../../middleware/auth');
const c = require('./return.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 7 }, fileFilter: (req, file, cb) => (['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'].includes(file.mimetype) ? cb(null, true) : cb(new Error('INVALID_TYPE'))) });
const managers = [requireAuth, requireRole('owner', 'manager')];
const returnLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { message: 'Too many return requests. Please try again later.' } });
router.get('/return-policy', c.policy);
router.get('/returns/mine', requireAuth('customer'), requireRole('customer'), c.mine);
router.post('/returns/:requestNumber/status', returnLimit, requireAuth('customer'), requireRole('customer'), c.status);
router.post('/:orderNumber/returns', returnLimit, requireAuth('customer'), requireRole('customer'), upload.fields([{ name: 'proof', maxCount: 6 }, { name: 'video', maxCount: 1 }]), (req, res, next) => { req.files = [...(req.files && req.files.proof || []), ...(req.files && req.files.video || [])]; next(); }, c.create);
router.get('/admin/returns', ...managers, c.list);
router.get('/admin/returns/:id', ...managers, c.detail);
router.patch('/admin/returns/:id/:action', ...managers, c.action);
module.exports = router;
