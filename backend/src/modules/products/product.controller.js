const Product = require('./product.model');
const v = require('../../utils/validate');
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.list = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.category && !['accessories', 'laptop'].includes(req.query.category)) filter.category = req.query.category;
    if (req.query.section === 'accessories' || req.query.category === 'accessories') filter.section = 'accessories';
    else if (req.query.section === 'laptop' || req.query.category === 'laptop') filter.section = { $in: ['laptop', null] };
    if (req.query.subcategory) filter.subcategory = String(req.query.subcategory).toLowerCase();
    if (req.query.type) filter.type = req.query.type;
    if (req.query.home === '1') filter.featuredOnHome = true;
    if (req.query.brand) filter.brand = new RegExp(`^${escapeRegex(req.query.brand)}$`, 'i');
    if (req.query.storage) filter['specs.storage'] = new RegExp(escapeRegex(req.query.storage), 'i');
    if (req.query.ram) filter['specs.ram'] = new RegExp(escapeRegex(req.query.ram), 'i');
    if (req.query.gpu) filter['specs.gpu'] = new RegExp(escapeRegex(req.query.gpu), 'i');
    if (req.query.cpu) filter['specs.cpu'] = new RegExp(escapeRegex(req.query.cpu), 'i');
    if (req.query.screen) filter['specs.screen'] = new RegExp(escapeRegex(req.query.screen), 'i');
    if (req.query.inStock === '1') filter.stock = { $gt: 0 };
    if (req.query.minStorage || req.query.maxStorage) {
      filter.storageGb = {};
      if (req.query.minStorage && Number.isFinite(Number(req.query.minStorage))) filter.storageGb.$gte = Number(req.query.minStorage);
      if (req.query.maxStorage && Number.isFinite(Number(req.query.maxStorage))) filter.storageGb.$lte = Number(req.query.maxStorage);
    }
    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice && Number.isFinite(Number(req.query.minPrice))) filter.price.$gte = Number(req.query.minPrice);
      if (req.query.maxPrice && Number.isFinite(Number(req.query.maxPrice))) filter.price.$lte = Number(req.query.maxPrice);
    }
    if (req.query.grade) filter['refurbished.grade'] = req.query.grade;
    if (req.query.q) {
      const search = new RegExp(escapeRegex(req.query.q), 'i');
      filter.$or = [{ name: search }, { brand: search }, { subcategory: search }, { sku: search }];
    }
    // Public listing mein sirf active products; admin ?status=sold/archived maang sakta hai
    filter.status = req.query.status || 'active';

    const sort = req.query.sort === 'priceAsc' ? { price: 1 } : req.query.sort === 'priceDesc' ? { price: -1 } : { createdAt: -1 };
    const products = await Product.find(filter).sort(sort);
    res.json(products);
  } catch (error) {
    next(error);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const key = req.params.slug;
    const product = await Product.findOne({ slug: key })
      || (v.objectId.safeParse(key).success ? await Product.findById(key) : null);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const product = await Product.create(v.productCreate.parse(req.body));
    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    v.objectId.parse(req.params.id);
    const product = await Product.findByIdAndUpdate(req.params.id, v.productUpdate.parse(req.body), {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
};

exports.archive = async (req, res, next) => {
  try {
    v.objectId.parse(req.params.id);
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { status: 'archived' },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
};
