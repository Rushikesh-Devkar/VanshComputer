const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  _id: { type: String, default: 'homepage' },
  kicker: { type: String, required: true, maxlength: 100 },
  title: { type: String, required: true, maxlength: 220 },
  description: { type: String, required: true, maxlength: 500 },
  imageUrl: { type: String, default: '' },
  imagePublicId: { type: String, default: '' },
  shopKicker: { type: String, default: 'SHOP OFFERS', maxlength: 100 },
  shopTitle: { type: String, default: 'Deals on laptops and accessories', maxlength: 220 },
  shopDescription: { type: String, default: 'Fresh picks and offers from Vansh Computer.', maxlength: 500 },
  shopImageUrl: { type: String, default: '' },
  shopImagePublicId: { type: String, default: '' },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Banner', bannerSchema);
