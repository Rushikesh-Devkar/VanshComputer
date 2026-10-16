const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  publicId: String,   // Cloudinary ka ID (baad mein)
  alt: String,
}, { _id: false });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, unique: true, index: true },
  brand: { type: String, required: true, trim: true, index: true },
  category: { type: String, enum: ['laptop', 'desktop', 'monitor', 'printer', 'accessory'], default: 'laptop' },
  type: { type: String, enum: ['new', 'refurbished'], required: true, index: true },
  sku: { type: String, required: true, unique: true, trim: true },
  specs: {
    cpu: { type: String, required: true },
    ram: { type: String, required: true },
    storage: { type: String, required: true },
    gpu: String,
    screen: String,
    os: String,
  },
  price: { type: Number, required: true, min: 1 },
  stock: { type: Number, default: 1, min: 0 },       // refurbished = 1
  warrantyMonths: { type: Number, default: 6 },
  refurbished: {
    grade: { type: String, enum: ['A', 'B', 'C'] },
    batteryHealth: { type: Number, min: 0, max: 100 },
    cosmeticNotes: String,
    inspectionChecklist: [String],
    includedAccessories: [String],
    serialNumber: { type: String, select: false },    // public API mein nahi jayega
  },
  images: [imageSchema],
  status: { type: String, enum: ['active', 'sold', 'archived'], default: 'active', index: true },
}, { timestamps: true });

productSchema.pre('validate', function () {
  if (!this.slug && this.name) {
    const base = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    this.slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
});

// Stock 0 hote hi listing "sold" ho jaye
productSchema.pre('save', function () {
  if (this.stock <= 0 && this.status === 'active') this.status = 'sold';
});

module.exports = mongoose.model('Product', productSchema);