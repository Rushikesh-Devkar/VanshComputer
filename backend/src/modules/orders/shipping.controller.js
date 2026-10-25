const ShippingSettings = require('./shipping.model');
const { shippingSettingsSchema } = require('./schemas');

exports.get = async (req, res, next) => {
  try {
    const settings = await ShippingSettings.findById('maharashtra').select('-auditHistory -updatedBy').lean();
    res.json(settings || { maharashtraCharge: null, freeDeliveryEnabled: true, freeDeliveryMinimum: null, freeDeliveryEndsAt: null, returnPolicyText: '', returnsEnabled: false, returnWindowDays: null, eligibleReasons: ['not_as_described', 'defective_or_not_working', 'damaged_in_transit', 'wrong_item'], returnShippingMode: 'customer_ships', returnShippingCharge: null, refundOriginalDelivery: false, refundProcessingDays: null, gstin: '', gstRate: null, gstCalculationEnabled: false });
  } catch (error) { next(error); }
};
exports.update = async (req, res, next) => {
  try {
    const fields = shippingSettingsSchema.parse(req.body);
    const settings = await ShippingSettings.findByIdAndUpdate('maharashtra', {
      $set: { ...fields, updatedBy: req.user._id },
      $push: { auditHistory: { $each: [{ actor: req.user._id, action: 'shipping_settings_updated' }], $slice: -50 } },
    }, { new: true, upsert: true, runValidators: true });
    res.json(settings);
  } catch (error) { next(error); }
};
