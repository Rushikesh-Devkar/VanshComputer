const { z } = require('zod');
const cloudinary = require('../../config/cloudinary');
const Banner = require('./banner.model');

const DEFAULT_BANNER = {
  kicker: 'CERTIFIED REFURBISHED LAPTOPS',
  title: 'Quality-checked laptops.\nHonest grades.\n6 months warranty.',
  description: 'Har laptop ki asli photos, battery health pehle se dikhai hui, aur seedha hamari team se support.',
  imageUrl: '',
  imagePublicId: '',
  shopKicker: 'SHOP OFFERS',
  shopTitle: 'Deals on laptops and accessories',
  shopDescription: 'Fresh picks and offers from Vansh Computer.',
  shopImageUrl: '',
  shopImagePublicId: '',
};

const schema = z.object({
  kicker: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(220),
  description: z.string().trim().min(1).max(500),
  removeImage: z.enum(['true', 'false']).optional(),
  shopKicker: z.string().trim().min(1).max(100).optional(),
  shopTitle: z.string().trim().min(1).max(220).optional(),
  shopDescription: z.string().trim().min(1).max(500).optional(),
  removeShopImage: z.enum(['true', 'false']).optional(),
});

const isImage = (buffer) => {
  const jpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  return jpg || png || webp;
};

const uploadBuffer = (buffer, folder) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({
    folder,
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
  const uploaded = [];
  try {
    const fields = schema.parse(req.body);
    const homeFile = req.files && req.files.image && req.files.image[0];
    const shopFile = req.files && req.files.shopImage && req.files.shopImage[0];
    if ([homeFile, shopFile].filter(Boolean).some((file) => !isImage(file.buffer))) {
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
      shopKicker: fields.shopKicker || previous && previous.shopKicker || DEFAULT_BANNER.shopKicker,
      shopTitle: fields.shopTitle || previous && previous.shopTitle || DEFAULT_BANNER.shopTitle,
      shopDescription: fields.shopDescription || previous && previous.shopDescription || DEFAULT_BANNER.shopDescription,
      shopImageUrl: previous ? previous.shopImageUrl : '',
      shopImagePublicId: previous ? previous.shopImagePublicId : '',
    };

    if (fields.removeImage === 'true') {
      nextBanner.imageUrl = '';
      nextBanner.imagePublicId = '';
    }
    if (fields.removeShopImage === 'true') {
      nextBanner.shopImageUrl = '';
      nextBanner.shopImagePublicId = '';
    }
    if (homeFile) {
      const result = await uploadBuffer(homeFile.buffer, 'vansh-computer/banners/homepage');
      uploaded.push(result);
      nextBanner.imageUrl = result.secure_url;
      nextBanner.imagePublicId = result.public_id;
    }
    if (shopFile) {
      const result = await uploadBuffer(shopFile.buffer, 'vansh-computer/banners/shop');
      uploaded.push(result);
      nextBanner.shopImageUrl = result.secure_url;
      nextBanner.shopImagePublicId = result.public_id;
    }

    const saved = await Banner.findByIdAndUpdate('homepage', { $set: nextBanner }, {
      new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true,
    });
    const oldPublicId = previous && previous.imagePublicId;
    if (oldPublicId && oldPublicId !== saved.imagePublicId) {
      cloudinary.uploader.destroy(oldPublicId).catch((e) => console.error('Old banner image cleanup failed:', e.message));
    }
    const oldShopPublicId = previous && previous.shopImagePublicId;
    if (oldShopPublicId && oldShopPublicId !== saved.shopImagePublicId) {
      cloudinary.uploader.destroy(oldShopPublicId).catch((e) => console.error('Old shop banner cleanup failed:', e.message));
    }
    res.json({ ...DEFAULT_BANNER, ...saved.toObject() });
  } catch (e) {
    await Promise.allSettled(uploaded.map((result) => cloudinary.uploader.destroy(result.public_id)));
    next(e);
  }
};
