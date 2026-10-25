const mongoose = require('mongoose');
const cloudinary = require('../../config/cloudinary');
const Product = require('./product.model');

const MAX_IMAGES = 8;

const looksLikeImage = (buf) => {
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  return jpg || png || webp;
};

const uploadBuffer = (buffer, folder) =>
  new Promise((resolve, reject) => {
    cloudinary.assertConfigured();
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        allowed_formats: ['jpg', 'png', 'webp'],
        transformation: [{ width: 2000, height: 2000, crop: 'limit' }],
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

const validId = (id) => mongoose.isValidObjectId(id);

exports.add = async (req, res, next) => {
  const uploaded = [];
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid product id' });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ message: 'Koi photo select nahi ki' });
    if (product.images.length + files.length > MAX_IMAGES) {
      return res.status(400).json({ message: `Ek product pe max ${MAX_IMAGES} photos` });
    }
    if (files.some((f) => !looksLikeImage(f.buffer))) {
      return res.status(400).json({ message: 'Sirf asli JPG, PNG ya WebP photos allowed hain' });
    }

    for (const f of files) {
      const r = await uploadBuffer(f.buffer, `vansh-computer/products/${product._id}`);
      uploaded.push(r);
      product.images.push({ url: r.secure_url, publicId: r.public_id, alt: product.name });
    }
    await product.save();
    res.status(201).json(product.images);
  } catch (e) {
    await Promise.allSettled(uploaded.map((r) => cloudinary.uploader.destroy(r.public_id)));
    next(e);
  }
};

exports.setCover = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid product id' });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const i = product.images.findIndex((img) => img.publicId === req.body.publicId);
    if (i === -1) return res.status(404).json({ message: 'Ye photo is product ki nahi hai' });
    const [cover] = product.images.splice(i, 1);
    product.images.unshift(cover);
    await product.save();
    res.json(product.images);
  } catch (e) { next(e); }
};

exports.remove = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid product id' });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const publicId = req.query.publicId;
    const img = product.images.find((x) => x.publicId === publicId);
    if (!img) return res.status(404).json({ message: 'Ye photo is product ki nahi hai' });

    await cloudinary.uploader.destroy(publicId);
    product.images = product.images.filter((x) => x.publicId !== publicId);
    await product.save();
    res.json(product.images);
  } catch (e) { next(e); }
};
