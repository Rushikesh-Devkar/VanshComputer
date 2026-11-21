const Lead = require('./lead.model');
const { normalizeIndianPhone } = require('../../utils/phone');
const v = require('../../utils/validate');
const { escapeHtml, appAdminUrl, notifyOwner } = require('../../utils/ownerAlerts');

exports.create = async (req, res, next) => {
  try {
    const body = v.leadCreate.parse(req.body);
    const phone = normalizeIndianPhone(body.phone);

    if (!phone) {
      return res.status(400).json({ message: 'Please enter a valid Indian mobile number' });
    }

    const lead = await Lead.create({
      ...body,
      phone,
      consent: { ...body.consent, capturedAt: new Date() },
    });
    const adminUrl = appAdminUrl();
    const name = lead.name || '';
    const productName = lead.productSnapshot?.name || '';
    notifyOwner({
      subject: `New lead: ${lead.enquiryType || 'callback'}`,
      text: `New lead\nName: ${name}\nPhone: ${lead.phone}\nEnquiry: ${lead.enquiryType || 'callback'}\nPreferred contact: ${lead.preferredContact || 'either'}\nProduct: ${productName}\nAdmin: ${adminUrl}`,
      html: `<p><strong>New lead</strong></p><p>Name: ${escapeHtml(name)}<br>Phone: ${escapeHtml(lead.phone)}<br>Enquiry: ${escapeHtml(lead.enquiryType || 'callback')}<br>Preferred contact: ${escapeHtml(lead.preferredContact || 'either')}<br>Product: ${escapeHtml(productName)}</p><p><a href="${escapeHtml(adminUrl)}">Open admin</a></p>`,
    });

    res.status(201).json(lead);
  } catch (error) {
    next(error);
  }
};

exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 50;
    const filter = {};
    if (req.query.status) {
      const status = String(req.query.status).trim();
      if (['new', 'contacted', 'interested', 'follow-up', 'converted', 'lost'].includes(status)) {
        filter.status = status;
      }
    }
    const search = String(req.query.q || '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: new RegExp(escaped, 'i') },
        { phone: new RegExp(escaped, 'i') },
      ];
    }
    const total = await Lead.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / limit));
    const leads = await Lead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    res.json({ items: leads, total, page: Math.min(page, pages), pages, limit });
  } catch (error) {
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    v.objectId.parse(req.params.id);
    const { note, ...fields } = v.leadUpdate.parse(req.body);
    const update = { ...fields };
    if (note) update.$push = { notes: { text: note } };

    const lead = await Lead.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    res.json(lead);
  } catch (error) {
    next(error);
  }
};
