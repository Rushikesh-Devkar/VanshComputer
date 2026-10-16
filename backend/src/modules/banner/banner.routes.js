const router = require('express').Router();
const { requireAuth, requireRole } = require('../../middleware/auth');
const multer = require('multer');
const c = require('./banner.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      ? cb(null, true) : cb(new Error('INVALID_TYPE')),
});

router.get('/', c.get);
router.put('/', requireAuth, requireRole('owner', 'manager'), upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'shopImage', maxCount: 1 },
]), c.update);

module.exports = router;
