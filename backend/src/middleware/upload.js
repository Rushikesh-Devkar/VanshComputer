const multer = require('multer');

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) =>
    ALLOWED.includes(file.mimetype) ? cb(null, true) : cb(new Error('INVALID_TYPE')),
});
