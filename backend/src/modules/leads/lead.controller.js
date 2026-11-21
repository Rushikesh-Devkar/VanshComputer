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
    const leads = await Lead.find().sort({ createdAt: -1 });
    res.json(leads);
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
