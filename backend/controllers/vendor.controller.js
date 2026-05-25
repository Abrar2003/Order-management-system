const Vendor = require("../models/vendor.model");

const normalizeText = (value = "") => String(value ?? "").trim();
const normalizeEmail = (value = "") => normalizeText(value).toLowerCase();
const escapeRegex = (value = "") => normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CONTACT_PERSON_TYPES = new Set(["merchant", "shipment"]);

const normalizeContactPersonType = (value = "") => {
  const normalized = normalizeText(value).toLowerCase();
  return CONTACT_PERSON_TYPES.has(normalized) ? normalized : undefined;
};

const normalizeContactPersons = (value = []) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((contact = {}) => {
      const normalizedContact = {
        name: normalizeText(contact?.name),
        email: normalizeEmail(contact?.email),
        phone: normalizeText(contact?.phone),
      };
      const type = normalizeContactPersonType(contact?.type);
      if (type) {
        normalizedContact.type = type;
      }
      return normalizedContact;
    })
    .filter((contact) => contact.name || contact.email || contact.phone);
};

const serializeVendor = (vendor = {}) => ({
  _id: String(vendor._id || ""),
  name: normalizeText(vendor.name),
  email: normalizeEmail(vendor.email),
  phone: normalizeText(vendor.phone),
  address: normalizeText(vendor.address),
  vendor_code: normalizeText(vendor.vendor_code),
  contact_person: normalizeContactPersons(vendor.contact_person),
  is_active: vendor.is_active !== false,
  created_at: vendor.created_at || vendor.createdAt || null,
  updated_at: vendor.updated_at || vendor.updatedAt || null,
  deleted_at: vendor.deleted_at || null,
});

const getVendors = async (_req, res) => {
  try {
    const vendors = await Vendor.find({
      $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
    })
      .sort({ name: 1, vendor_code: 1, email: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: vendors.map(serializeVendor),
    });
  } catch (error) {
    console.error("Get Vendors Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch vendors",
    });
  }
};

const createVendor = async (req, res) => {
  try {
    const name = normalizeText(req.body?.name);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizeText(req.body?.phone);
    const address = normalizeText(req.body?.address);
    const vendor_code = normalizeText(req.body?.vendor_code);
    const contact_person = normalizeContactPersons(req.body?.contact_person);
    const is_active = req.body?.is_active !== false;

    if (!name || !email || !phone || !vendor_code) {
      return res.status(400).json({
        success: false,
        message: "Name, email, phone, and vendor code are required",
      });
    }

    const existingVendor = await Vendor.findOne({
      $or: [
        { name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } },
        { email },
        { vendor_code: { $regex: `^${escapeRegex(vendor_code)}$`, $options: "i" } },
      ],
    }).lean();

    if (existingVendor) {
      return res.status(409).json({
        success: false,
        message: "Vendor with this name, email, or vendor code already exists",
      });
    }

    const vendor = await Vendor.create({
      name,
      email,
      phone,
      address,
      vendor_code,
      contact_person,
      is_active,
    });

    return res.status(201).json({
      success: true,
      message: "Vendor created successfully",
      data: serializeVendor(vendor.toObject()),
    });
  } catch (error) {
    console.error("Create Vendor Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create vendor",
    });
  }
};

module.exports = {
  createVendor,
  getVendors,
};
