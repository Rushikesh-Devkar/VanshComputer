const crypto = require('crypto');
const mongoose = require('mongoose');
const Product = require('../products/product.model');
const Order = require('./order.model');
const ShippingSettings = require('./shipping.model');

const SHIPPING_RATES = Object.freeze({ laptop: 550, setup: 850, accessories: 150 });
const shippingClass = (product) => product.section === 'accessories' || product.category === 'accessory' || product.category === 'printer' || product.category === 'monitor' || product.category === 'tablet'
  ? 'accessories'
  : product.category === 'desktop' ? 'setup' : 'laptop';

const currentShipping = async (session) => {
  let query = ShippingSettings.findById('maharashtra');
  if (session) query = query.session(session);
  return (await query.lean()) || { freeDeliveryEnabled: false, freeDeliveryMinimum: null, freeDeliveryEndsAt: null };
};

exports.priceQuote = async (items, address, session) => {
  if (address.state.toLowerCase() !== 'maharashtra') {
    const error = new Error('Delivery is available only within Maharashtra.'); error.status = 400; throw error;
  }
  const ids = items.map((item) => item.productId);
  let query = Product.find({ _id: { $in: ids }, status: 'active' }).select('name slug sku hsnCode type category section warrantyMonths price originalPrice stock images');
  if (session) query = query.session(session);
  const products = await query.lean();
  if (products.length !== items.length) {
    const error = new Error('One or more products are unavailable.'); error.status = 409; throw error;
  }
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const lines = items.map(({ productId, quantity }) => {
    const product = byId.get(String(productId));
    if (!product || product.stock < quantity || (product.type === 'refurbished' && quantity !== 1)) {
      const error = new Error(`Unavailable quantity for ${product ? product.name : 'product'}.`); error.status = 409; throw error;
    }
    const shippingCategory = shippingClass(product);
    const shippingRate = SHIPPING_RATES[shippingCategory];
    return {
      product: product._id, slug: product.slug, name: product.name, sku: product.sku, hsnCode: product.hsnCode || '',
      type: product.type, category: product.category, section: product.section, warrantyMonths: product.warrantyMonths || 0, quantity,
      unitPrice: product.price, originalPrice: product.originalPrice || null, lineTotal: product.price * quantity,
      shippingCategory, shippingRate, shippingTotal: shippingRate * quantity,
      availableStock: product.stock,
      imageUrl: product.images && product.images[0] ? product.images[0].url : '',
    };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const settings = await currentShipping(session);
  const offerHasScope = settings.freeDeliveryMinimum != null || settings.freeDeliveryEndsAt != null;
  const offerActive = settings.freeDeliveryEnabled && offerHasScope && (!settings.freeDeliveryEndsAt || new Date(settings.freeDeliveryEndsAt) >= new Date());
  const qualifiesFree = offerActive && (settings.freeDeliveryMinimum == null || subtotal >= settings.freeDeliveryMinimum);
  const calculatedShipping = lines.reduce((sum, line) => sum + line.shippingTotal, 0);
  const shippingCharge = qualifiesFree ? 0 : calculatedShipping;
  const shippingBreakdown = Object.entries(SHIPPING_RATES).map(([category, rate]) => ({
    category, rate, quantity: lines.filter((line) => line.shippingCategory === category).reduce((sum, line) => sum + line.quantity, 0),
  })).filter((line) => line.quantity > 0);
  const discount = 0;
  return {
    items: lines, subtotal, discount, shippingCharge, shippingBreakdown, total: subtotal - discount + shippingCharge,
    taxSnapshot: { status: 'not_configured', sellerGstin: settings.gstin || '', configuredRate: settings.gstRate ?? null, placeOfSupply: 'Maharashtra', items: lines.map(({ hsnCode, lineTotal }) => ({ hsnCode, taxableValue: lineTotal, gstRate: null })) },
    shippingRuleSnapshot: {
      region: 'Maharashtra', calculatedCharge: calculatedShipping, shippingBreakdown, freeDeliveryEnabled: settings.freeDeliveryEnabled,
      freeDeliveryMinimum: settings.freeDeliveryMinimum, freeDeliveryEndsAt: settings.freeDeliveryEndsAt,
      freeDeliveryApplied: qualifiesFree,
    },
  };
};

exports.newOrderNumber = () => `VC${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

exports.reserveAndCreate = async ({ customer, address, items, expectedTotal, reservationMinutes, accessTokenHash, checkoutRequestId }) => {
  const session = await mongoose.startSession();
  let order;
  const orderNumber = exports.newOrderNumber();
  try {
    await session.withTransaction(async () => {
      const quote = await exports.priceQuote(items, address, session);
      if (Number.isFinite(expectedTotal) && Math.round(quote.total * 100) !== Math.round(expectedTotal * 100)) {
        const error = new Error('The cart total changed. Review the updated price and delivery charge before paying.'); error.status = 409; throw error;
      }
      for (const item of quote.items) {
        const reserved = await Product.updateOne(
          { _id: item.product, status: 'active', stock: { $gte: item.quantity }, ...(item.type === 'refurbished' ? { stock: 1 } : {}) },
          { $inc: { stock: -item.quantity } }, { session }
        );
        if (reserved.modifiedCount !== 1) {
          const error = new Error(`Product stock changed for ${item.name}. Refresh your cart and try again.`); error.status = 409; throw error;
        }
      }
      const expiresAt = new Date(Date.now() + reservationMinutes * 60 * 1000);
      [order] = await Order.create([{
        orderNumber, checkoutRequestId, customer, address, items: quote.items, subtotal: quote.subtotal,
        discount: quote.discount, shippingCharge: quote.shippingCharge,
        shippingRuleSnapshot: quote.shippingRuleSnapshot, total: quote.total,
        accessTokenHash,
        taxSnapshot: { ...quote.taxSnapshot, buyerGstin: customer.gstin || '' },
        reservationExpiresAt: expiresAt,
        statusHistory: [{ action: 'order_created', detail: 'Inventory reserved for payment.' }],
      }], { session });
      order = { order, quote };
    });
    return order;
  } finally { await session.endSession(); }
};

exports.releaseReservation = async (orderId, status = 'expired') => {
  const session = await mongoose.startSession();
  let order = null;
  try {
    await session.withTransaction(async () => {
      order = await Order.findOneAndUpdate(
        { _id: orderId, status: 'pending_payment' },
        { $set: { status, paymentStatus: status === 'expired' ? 'expired' : 'failed' }, $push: { statusHistory: { action: status, detail: 'Reserved stock released.', at: new Date() } } },
        { new: true, session }
      );
      if (!order) return;
      for (const item of order.items) await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } }, { session });
    });
    return order;
  } finally { await session.endSession(); }
};

exports.expireReservations = async () => {
  const due = await Order.find({ status: 'pending_payment', reservationExpiresAt: { $lte: new Date() } }).select('_id').limit(100).lean();
  for (const entry of due) {
    try { await exports.releaseReservation(entry._id, 'expired'); }
    catch (_) { console.error('Order reservation expiry failed.'); }
  }
};
