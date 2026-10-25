const { ZodError } = require('zod');

exports.notFound = (req, res) => res.status(404).json({ message: 'Route not found' });

exports.errorHandler = (err, req, res, next) => {
  if (err.http_code === 401) {
    return res.status(503).json({ message: 'Cloudinary credentials were rejected. Update the current account credentials and restart the backend.' });
  }
  if (err.status && err.status >= 400 && err.status < 600) {
    return res.status(err.status).json({ message: err.message || 'Request failed' });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: err.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: 'A record with that value already exists.' });
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({
      message: err.code === 'LIMIT_FILE_SIZE' ? (err.field === 'video' ? 'Video must be 100 MB or smaller' : 'Photo 5 MB se badi hai') : 'Upload error: ' + err.message,
    });
  }
  if (err.message === 'INVALID_TYPE') {
    return res.status(400).json({ message: 'Sirf JPG, PNG ya WebP photos allowed hain' });
  }
  if (err.message === 'INVALID_VIDEO_TYPE') {
    return res.status(400).json({ message: 'Sirf MP4 video allowed hai' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: 'Video must be 100 MB or smaller' });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid id' });
  }
  console.error('Unhandled request error:', err && err.name || 'Error');
  res.status(500).json({ message: 'Something went wrong' });
};
