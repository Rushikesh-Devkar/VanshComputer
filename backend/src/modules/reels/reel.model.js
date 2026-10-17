const mongoose = require('mongoose');

const reelSchema = new mongoose.Schema({
  instagramUrl: { type: String, required: true, trim: true, maxlength: 500 },
  caption: { type: String, trim: true, maxlength: 180, default: '' },
  videoUrl: { type: String, required: true },
  videoPublicId: { type: String, required: true },
  active: { type: Boolean, default: true, index: true },
  sortOrder: { type: Number, default: 0, index: true },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Reel', reelSchema);
