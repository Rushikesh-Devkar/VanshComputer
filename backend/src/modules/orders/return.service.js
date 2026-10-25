const ShippingSettings = require('./shipping.model');

const OPEN_STATUSES = ['requested', 'approved', 'awaiting_return_shipment', 'return_in_transit', 'received', 'inspection_accepted', 'inspection_rejected', 'refund_pending'];
const DEFAULT_REASONS = ['not_as_described', 'defective_or_not_working', 'damaged_in_transit', 'wrong_item'];

function calculateRefundAmount(order, settings = {}) {
  const delivery = settings.refundOriginalDelivery ? 0 : Number(order.shippingCharge || 0);
  const returnCharge = settings.returnShippingMode === 'deduct_from_refund' ? Number(settings.returnShippingCharge || 0) : 0;
  return Math.max(0, Math.round((Number(order.total || 0) - delivery - returnCharge) * 100) / 100);
}

async function getSettings() {
  return (await ShippingSettings.findById('maharashtra').lean()) || {
    returnsEnabled: false, returnWindowDays: null, eligibleReasons: DEFAULT_REASONS,
    returnShippingMode: 'customer_ships', returnShippingCharge: null, refundOriginalDelivery: false, refundProcessingDays: null,
  };
}

function isEligible(order, settings, now = new Date()) {
  if (!order || order.status !== 'delivered' || !order.deliveredAt || settings.returnsEnabled !== true) return false;
  if (!Number.isInteger(settings.returnWindowDays) || settings.returnWindowDays < 0) return false;
  return now.getTime() <= new Date(order.deliveredAt).getTime() + settings.returnWindowDays * 86400000;
}

module.exports = { OPEN_STATUSES, DEFAULT_REASONS, calculateRefundAmount, getSettings, isEligible };
