const Lead = require('./lead.model');
const { normalizeIndianPhone } = require('../../utils/phone');
const v = require('../../utils/validate');

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
