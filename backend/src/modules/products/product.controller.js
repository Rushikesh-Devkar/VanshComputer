const Product = require('./product.model');
const v = require('../../utils/validate');

exports.list = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.type) filter.type = req.query.type;
    // Public listing mein sirf active products; admin ?status=sold/archived maang sakta hai
    filter.status = req.query.status || 'active';

    const products = await Product.find(filter).sort({ createdAt: -1 });
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
