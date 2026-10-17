const router = require('express').Router();
const multer = require('multer');
const { requireAuth, requireRole } = require('../../middleware/auth');
const c = require('./reel.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => file.mimetype === 'video/mp4' ? cb(null, true) : cb(new Error('INVALID_VIDEO_TYPE')),
});
const managers = [requireAuth, requireRole('owner', 'manager')];

router.get('/', c.listPublic);
router.get('/admin', ...managers, c.listAdmin);
router.post('/', ...managers, upload.single('video'), c.create);
router.patch('/:id/active', ...managers, c.setActive);
router.delete('/:id', ...managers, c.remove);

module.exports = router;
