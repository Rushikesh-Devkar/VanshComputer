const mongoose = require('mongoose');
const cloudinary = require('../../config/cloudinary');
const Product = require('../products/product.model');
const Review = require('./review.model');

const validImage = (buf) => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  || buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  || buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
const uploadBuffer = (buffer) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({ folder: 'vansh-computer/reviews', resource_type: 'image', allowed_formats: ['jpg', 'png', 'webp'], transformation: [{ width: 1400, height: 1400, crop: 'limit' }] }, (err, result) => err ? reject(err) : resolve(result));
  stream.end(buffer);
});

exports.listPublic = async (req, res, next) => {
  try {
    const query = { status: 'approved' };
    if (req.query.product) {
      if (!mongoose.isValidObjectId(req.query.product)) return res.status(400).json({ message: 'Invalid product id' });
      query.product = req.query.product;
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 30);
    const reviews = await Review.find(query).sort({ createdAt: -1 }).limit(limit)
      .populate('product', 'name slug');
    res.json(reviews);
  } catch (error) { next(error); }
};

exports.submit = async (req, res, next) => {
  const uploaded = [];
  try {
    const { productId, customerName, rating, text } = req.body;
    if (!mongoose.isValidObjectId(productId)) return res.status(400).json({ message: 'Product is required' });
    if (typeof customerName !== 'string' || !customerName.trim() || customerName.trim().length > 80) return res.status(400).json({ message: 'Enter your name (up to 80 characters)' });
    if (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) return res.status(400).json({ message: 'Choose a rating from 1 to 5 stars' });
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 1200) return res.status(400).json({ message: 'Write a review (up to 1,200 characters)' });
    const product = await Product.findOne({ _id: productId, status: { $ne: 'archived' } }).select('_id');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const files = req.files || [];
    if (files.some((file) => !validImage(file.buffer))) return res.status(400).json({ message: 'Upload valid JPG, PNG or WebP images' });
    const images = [];
    for (const file of files) {
      const image = await uploadBuffer(file.buffer);
      uploaded.push(image);
      images.push({ url: image.secure_url, publicId: image.public_id });
    }
    const review = await Review.create({ product: product._id, customerName: customerName.trim(), rating: Number(rating), text: text.trim(), images });
    res.status(201).json({ message: 'Thanks! Your review will appear after it has been approved.', reviewId: review._id });
  } catch (error) {
    await Promise.allSettled(uploaded.map((image) => cloudinary.uploader.destroy(image.public_id)));
    next(error);
  }
};

exports.listAdmin = async (req, res, next) => {
  try { res.json(await Review.find().sort({ createdAt: -1 }).limit(200).populate('product', 'name slug')); }
  catch (error) { next(error); }
};

exports.setStatus = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid review id' });
    if (!['pending', 'approved', 'rejected'].includes(req.body.status)) return res.status(400).json({ message: 'Invalid review status' });
    const review = await Review.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }).populate('product', 'name slug');
    if (!review) return res.status(404).json({ message: 'Review not found' });
    res.json(review);
  } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid review id' });
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) return res.status(404).json({ message: 'Review not found' });
    await Promise.allSettled(review.images.map((image) => image.publicId && cloudinary.uploader.destroy(image.publicId)));
    res.json({ message: 'Review deleted' });
  } catch (error) { next(error); }
};
