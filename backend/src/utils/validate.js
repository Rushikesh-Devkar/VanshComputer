const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

exports.leadCreate = z.object({
  phone: z.string().min(1),
  name: z.string().trim().max(100).optional(),
  preferredContact: z.enum(['whatsapp', 'call', 'either']).optional(),
  enquiryType: z.enum(['hold-request', 'callback', 'product-enquiry', 'repair']).optional(),
  product: objectId.optional(),
  productSnapshot: z.object({
    name: z.string().max(200).optional(),
    price: z.number().optional(),
    slug: z.string().max(200).optional(),
  }).optional(),
  consent: z.object({
    contactAllowed: z.boolean(),
    marketingAllowed: z.boolean().optional(),
    purpose: z.string().max(300).optional(),
    policyVersion: z.string().max(50).optional(),
    source: z.string().max(50).optional(),
  }),
});

exports.leadUpdate = z.object({
  name: z.string().trim().max(100).optional(),
  status: z.enum(['new', 'contacted', 'interested', 'follow-up', 'converted', 'lost']).optional(),
  followUpDate: z.coerce.date().nullable().optional(),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();

const productBase = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().min(1).max(100),
  section: z.enum(['laptop', 'accessories']).optional(),
  category: z.enum(['laptop', 'desktop', 'monitor', 'printer', 'accessory', 'tablet']).optional(),
  subcategory: z.string().trim().max(80).optional(),
  type: z.enum(['new', 'refurbished']),
  sku: z.string().trim().min(1).max(100),
  hsnCode: z.string().trim().max(8).optional().default(''),
  specs: z.object({
    cpu: z.string().optional().default(''),
    ram: z.string().optional().default(''),
    storage: z.string().optional().default(''),
    gpu: z.string().optional(),
    screen: z.string().optional(),
    os: z.string().optional(),
  }),
  storageGb: z.number().min(0).nullable().optional(),
  price: z.number().min(1),
  description: z.string().max(3000).optional(),
  featuredOnHome: z.boolean().optional(),
  stock: z.number().int().min(0).optional(),
  warrantyMonths: z.number().int().min(0).optional(),
  refurbished: z.object({
    grade: z.enum(['A', 'B', 'C']).optional(),
    batteryHealth: z.number().min(0).max(100).optional(),
    cosmeticNotes: z.string().optional(),
    inspectionChecklist: z.array(z.string()).optional(),
    includedAccessories: z.array(z.string()).optional(),
    serialNumber: z.string().optional(),
  }).optional(),
  images: z.array(z.object({
    url: z.string().url(),
    publicId: z.string().optional(),
    alt: z.string().optional(),
  })).optional(),
  status: z.enum(['active', 'sold', 'archived']).optional(),
});

exports.productCreate = productBase;
exports.productUpdate = productBase.partial();
exports.objectId = objectId;
