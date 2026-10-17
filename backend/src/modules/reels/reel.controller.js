const mongoose = require('mongoose');
const cloudinary = require('../../config/cloudinary');
const Reel = require('./reel.model');

const isInstagramReel = (value) => {
  try {
    const url = new URL(value);
    return ['instagram.com', 'www.instagram.com'].includes(url.hostname)
      && /^\/(reel|reels)\/[A-Za-z\d_-]+\/?$/.test(url.pathname);
  } catch (_) { return false; }
};
const uploadBuffer = (buffer) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({ folder: 'vansh-computer/reels', resource_type: 'video', allowed_formats: ['mp4'], eager: [{ width: 720, height: 1280, crop: 'limit', format: 'mp4', video_codec: 'h264' }] }, (err, result) => err ? reject(err) : resolve(result));
  stream.end(buffer);
});

exports.listPublic = async (req, res, next) => {
  try { res.json(await Reel.find({ active: true }).sort({ sortOrder: 1, createdAt: -1 }).limit(12).select('instagramUrl caption videoUrl')); }
  catch (error) { next(error); }
};
exports.listAdmin = async (req, res, next) => {
  try { res.json(await Reel.find().sort({ sortOrder: 1, createdAt: -1 })); }
  catch (error) { next(error); }
};
exports.create = async (req, res, next) => {
  let uploaded;
  try {
    const instagramUrl = String(req.body.instagramUrl || '').trim();
    const caption = String(req.body.caption || '').trim();
    if (!isInstagramReel(instagramUrl)) return res.status(400).json({ message: 'Enter a valid Instagram Reel URL' });
    if (caption.length > 180) return res.status(400).json({ message: 'Caption must be 180 characters or fewer' });
    if (!req.file) return res.status(400).json({ message: 'Choose an MP4 video' });
    if (req.file.buffer.length < 12 || req.file.buffer.subarray(4, 8).toString() !== 'ftyp') return res.status(400).json({ message: 'The uploaded file is not a valid MP4 video' });
    if (await Reel.countDocuments() >= 30) return res.status(400).json({ message: 'Delete an older reel before adding another (30 reel limit)' });
    uploaded = await uploadBuffer(req.file.buffer);
    const reel = await Reel.create({ instagramUrl, caption, videoUrl: uploaded.eager?.[0]?.secure_url || uploaded.secure_url, videoPublicId: uploaded.public_id, sortOrder: await Reel.countDocuments() });
    res.status(201).json(reel);
  } catch (error) {
    if (uploaded) await cloudinary.uploader.destroy(uploaded.public_id, { resource_type: 'video' }).catch(() => {});
    next(error);
  }
};
exports.setActive = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid reel id' });
    const reel = await Reel.findByIdAndUpdate(req.params.id, { active: req.body.active === true }, { new: true });
    if (!reel) return res.status(404).json({ message: 'Reel not found' });
    res.json(reel);
  } catch (error) { next(error); }
};
exports.remove = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid reel id' });
    const reel = await Reel.findByIdAndDelete(req.params.id);
    if (!reel) return res.status(404).json({ message: 'Reel not found' });
    await cloudinary.uploader.destroy(reel.videoPublicId, { resource_type: 'video' });
    res.json({ message: 'Reel deleted' });
  } catch (error) { next(error); }
};
