const { v2: cloudinary } = require('cloudinary');

const credentials = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_CLOUD_NAME.trim(),
  api_key: process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_KEY.trim(),
  api_secret: process.env.CLOUDINARY_API_SECRET && process.env.CLOUDINARY_API_SECRET.trim(),
};

cloudinary.config({
  ...credentials,
  secure: true,
});

cloudinary.assertConfigured = () => {
  if (Object.values(credentials).some((value) => !value)) {
    const error = new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
    error.status = 503;
    throw error;
  }
};

module.exports = cloudinary;
