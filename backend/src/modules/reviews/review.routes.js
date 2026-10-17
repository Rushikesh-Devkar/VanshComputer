const router = require('express').Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole } = require('../../middleware/auth');
const c = require('./review.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
    ? cb(null, true) : cb(new Error('INVALID_TYPE')),
});
const submitLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { message: 'Too many reviews submitted. Please try again later.' } });
const managers = [requireAuth, requireRole('owner', 'manager')];

router.get('/', c.listPublic);
router.post('/', submitLimit, upload.array('images', 3), c.submit);
router.get('/admin', ...managers, c.listAdmin);
router.patch('/:id/status', ...managers, c.setStatus);
router.delete('/:id', ...managers, c.remove);

module.exports = router;
