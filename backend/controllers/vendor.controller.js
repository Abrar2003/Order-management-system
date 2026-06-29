const XLSX = require("xlsx");
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
  owner_name: normalizeText(vendor.owner_name),
  email: normalizeEmail(vendor.email),
  phone: normalizeText(vendor.phone),
  country: normalizeText(vendor.country),
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
      .sort({ country: 1, name: 1, vendor_code: 1 })
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
    const owner_name = normalizeText(req.body?.owner_name);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizeText(req.body?.phone);
    const country = normalizeText(req.body?.country);
    const address = normalizeText(req.body?.address);
    const vendor_code = normalizeText(req.body?.vendor_code);
    const contact_person = normalizeContactPersons(req.body?.contact_person);
    const is_active = req.body?.is_active !== false;

    if (!name || !vendor_code) {
      return res.status(400).json({
        success: false,
        message: "Name and vendor code are required",
      });
    }

    const duplicateConditions = [
      { name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } },
      { vendor_code: { $regex: `^${escapeRegex(vendor_code)}$`, $options: "i" } },
    ];
    if (email) {
      duplicateConditions.push({ email });
    }

    const existingVendor = await Vendor.findOne({
      $or: duplicateConditions,
    }).lean();

    if (existingVendor) {
      return res.status(409).json({
        success: false,
        message: email
          ? "Vendor with this name, email, or vendor code already exists"
          : "Vendor with this name or vendor code already exists",
      });
    }

    const vendor = await Vendor.create({
      name,
      owner_name,
      email,
      phone,
      country,
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

const updateVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const name = normalizeText(req.body?.name);
    const owner_name = normalizeText(req.body?.owner_name);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizeText(req.body?.phone);
    const country = normalizeText(req.body?.country);
    const address = normalizeText(req.body?.address);
    const vendor_code = normalizeText(req.body?.vendor_code);
    const contact_person = normalizeContactPersons(req.body?.contact_person);
    const is_active = req.body?.is_active !== false;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Vendor ID is required",
      });
    }

    if (!name || !vendor_code) {
      return res.status(400).json({
        success: false,
        message: "Name and vendor code are required",
      });
    }

    const existingVendor = await Vendor.findById(id);
    if (!existingVendor || existingVendor.deleted_at) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    const duplicateConditions = [
      { name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } },
      { vendor_code: { $regex: `^${escapeRegex(vendor_code)}$`, $options: "i" } },
    ];
    if (email) {
      duplicateConditions.push({ email });
    }

    const duplicateVendor = await Vendor.findOne({
      _id: { $ne: id },
      $or: duplicateConditions,
    }).lean();

    if (duplicateVendor) {
      return res.status(409).json({
        success: false,
        message: email
          ? "Another vendor with this name, email, or vendor code already exists"
          : "Another vendor with this name or vendor code already exists",
      });
    }

    existingVendor.name = name;
    existingVendor.owner_name = owner_name;
    existingVendor.email = email;
    existingVendor.phone = phone;
    existingVendor.country = country;
    existingVendor.address = address;
    existingVendor.vendor_code = vendor_code;
    existingVendor.contact_person = contact_person;
    existingVendor.is_active = is_active;
    existingVendor.updated_at = new Date();

    await existingVendor.save();

    return res.status(200).json({
      success: true,
      message: "Vendor updated successfully",
      data: serializeVendor(existingVendor.toObject()),
    });
  } catch (error) {
    console.error("Update Vendor Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update vendor",
    });
  }
};

const exportVendors = async (req, res) => {
  try {
    let selectedCountries = [];
    const rawParam = req.query.countries || req.query.country;
    if (rawParam) {
      if (Array.isArray(rawParam)) {
        selectedCountries = rawParam.map(normalizeText).filter(Boolean);
      } else {
        selectedCountries = String(rawParam)
          .split(",")
          .map(normalizeText)
          .filter(Boolean);
      }
    }

    const rawVendors = await Vendor.find({
      $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
    })
      .sort({ country: 1, name: 1, vendor_code: 1 })
      .lean();

    let vendors = rawVendors.map(serializeVendor);

    if (selectedCountries.length > 0) {
      const lowerCountries = selectedCountries.map((c) => c.toLowerCase());
      vendors = vendors.filter((v) => {
        const vCountry = (v.country || "").toLowerCase();
        if (!vCountry) {
          return lowerCountries.includes("unspecified") || lowerCountries.includes("n/a");
        }
        return lowerCountries.includes(vCountry);
      });
    }

    const columns = [
      { header: "Vendor Name", value: (v) => v.name || "N/A" },
      { header: "Owner Name", value: (v) => v.owner_name || "N/A" },
      { header: "Vendor Code", value: (v) => v.vendor_code || "N/A" },
      { header: "Email", value: (v) => v.email || "N/A" },
      { header: "Phone", value: (v) => v.phone || "N/A" },
      { header: "Country", value: (v) => v.country || "Unspecified" },
      { header: "Status", value: (v) => (v.is_active ? "Active" : "Inactive") },
      { header: "Address", value: (v) => v.address || "N/A" },
      {
        header: "Contact Persons",
        value: (v) =>
          Array.isArray(v.contact_person) && v.contact_person.length > 0
            ? v.contact_person
                .map((c) =>
                  [c.name, c.email, c.phone, c.type ? `Type: ${c.type}` : ""]
                    .filter(Boolean)
                    .join(" / ")
                )
                .join("; ")
            : "N/A",
      },
    ];

    const headerRow = columns.map((col) => col.header);
    const dataRows = vendors.map((v) => columns.map((col) => col.value(v)));

    const worksheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    worksheet["!cols"] = columns.map((col, colIdx) => {
      const maxLen = Math.max(
        col.header.length,
        ...dataRows.map((row) => String(row[colIdx] ?? "").length)
      );
      return { wch: Math.min(45, Math.max(12, maxLen + 2)) };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendors");
    const fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xls" });
    const fileDate = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "application/vnd.ms-excel");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vendors-export-${fileDate}.xls"`
    );
    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error("Export Vendors Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export vendor details",
    });
  }
};

module.exports = {
  createVendor,
  getVendors,
  updateVendor,
  exportVendors,
};
