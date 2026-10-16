const { z } = require('zod');
const cloudinary = require('../../config/cloudinary');
const Banner = require('./banner.model');

const DEFAULT_BANNER = {
  kicker: 'CERTIFIED REFURBISHED LAPTOPS',
  title: 'Quality-checked laptops.\nHonest grades.\n6 months warranty.',
  description: 'Har laptop ki asli photos, battery health pehle se dikhai hui, aur seedha hamari team se support.',
  imageUrl: '',
  imagePublicId: '',
};

const schema = z.object({
  kicker: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(220),
  description: z.string().trim().min(1).max(500),
  removeImage: z.enum(['true', 'false']).optional(),
});

const isImage = (buffer) => {
  const jpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  return jpg || png || webp;
};

const uploadBuffer = (buffer) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({
    folder: 'vansh-computer/banners',
    resource_type: 'image',
    allowed_formats: ['jpg', 'png', 'webp'],
    transformation: [{ width: 2400, height: 1400, crop: 'limit' }],
  }, (err, result) => err ? reject(err) : resolve(result));
  stream.end(buffer);
});

exports.get = async (req, res, next) => {
  try {
    const banner = await Banner.findById('homepage').lean();
    res.json({ ...DEFAULT_BANNER, ...(banner || {}) });
  } catch (e) { next(e); }
};

exports.update = async (req, res, next) => {
  let uploaded;
  try {
    const fields = schema.parse(req.body);
    if (req.file && !isImage(req.file.buffer)) {
      return res.status(400).json({ message: 'File valid JPG, PNG ya WebP image nahi hai' });
    }

    const previous = await Banner.findById('homepage');
    const nextBanner = {
      ...DEFAULT_BANNER,
      kicker: fields.kicker,
      title: fields.title,
      description: fields.description,
      imageUrl: previous ? previous.imageUrl : '',
      imagePublicId: previous ? previous.imagePublicId : '',
    };

    if (fields.removeImage === 'true') {
      nextBanner.imageUrl = '';
      nextBanner.imagePublicId = '';
    }
    if (req.file) {
      uploaded = await uploadBuffer(req.file.buffer);
      nextBanner.imageUrl = uploaded.secure_url;
      nextBanner.imagePublicId = uploaded.public_id;
    }

    const saved = await Banner.findByIdAndUpdate('homepage', { $set: nextBanner }, {
      new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true,
    });
    const oldPublicId = previous && previous.imagePublicId;
    if (oldPublicId && oldPublicId !== saved.imagePublicId) {
      cloudinary.uploader.destroy(oldPublicId).catch((e) => console.error('Old banner image cleanup failed:', e.message));
    }
    res.json({ ...DEFAULT_BANNER, ...saved.toObject() });
  } catch (e) {
    if (uploaded) await cloudinary.uploader.destroy(uploaded.public_id).catch(() => {});
    next(e);
  }
};
