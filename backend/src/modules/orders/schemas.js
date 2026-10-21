const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid product id');
exports.itemsSchema = z.array(z.object({ productId: objectId, quantity: z.number().int().min(1).max(10) }).strict()).min(1).max(20)
  .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, 'Each product may appear only once');
exports.addressSchema = z.object({
  line1: z.string().trim().min(5).max(160),
  line2: z.string().trim().max(160).optional().default(''),
  city: z.string().trim().min(2).max(80),
  district: z.string().trim().min(2).max(80),
  state: z.string().trim().refine((value) => value.toLowerCase() === 'maharashtra', 'Delivery is available only within Maharashtra'),
  pinCode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
}).strict();
exports.quoteAddressSchema = z.object({
  state: z.string().trim().refine((value) => value.toLowerCase() === 'maharashtra', 'Delivery is available only within Maharashtra'),
}).strict();
exports.customerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().min(8).max(24),
  email: z.union([z.string().trim().email().max(200), z.literal('')]).optional().default(''),
  gstin: z.string().trim().max(20).optional().default(''),
}).strict();
exports.shippingSettingsSchema = z.object({
  maharashtraCharge: z.number().int().min(0).nullable(),
  freeDeliveryEnabled: z.boolean(),
  freeDeliveryMinimum: z.number().int().min(0).nullable(),
  freeDeliveryEndsAt: z.union([z.string().datetime().transform((value) => new Date(value)), z.null()]),
  returnPolicyText: z.string().trim().max(2000),
  gstin: z.string().trim().max(20).optional().default(''),
  gstRate: z.number().min(0).max(100).nullable().optional().default(null),
}).strict();
exports.trackingSchema = z.object({
  orderNumber: z.string().trim().regex(/^VC\d{8}-[A-F\d]{8}$/i),
  phone: z.string().min(8).max(24),
}).strict();
