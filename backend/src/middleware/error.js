const { ZodError } = require('zod');

exports.notFound = (req, res) => res.status(404).json({ message: 'Route not found' });

exports.errorHandler = (err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: err.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: 'Duplicate value', fields: err.keyValue });
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({
      message: err.code === 'LIMIT_FILE_SIZE' ? 'Photo 5 MB se badi hai' : 'Upload error: ' + err.message,
    });
  }
  if (err.message === 'INVALID_TYPE') {
    return res.status(400).json({ message: 'Sirf JPG, PNG ya WebP photos allowed hain' });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid id' });
  }
  console.error(err);
  res.status(500).json({ message: 'Something went wrong' });
};
