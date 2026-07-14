const XLSX = require("xlsx");
const Brand = require("../models/brand.model");
const Finish = require("../models/finish.model");
const Item = require("../models/item.model");
const Vendor = require("../models/vendor.model");
const { getVendorCountry, getVendorId, getVendorName } = require("../helpers/vendorRef");
const {
  applyBrandDocumentAccessMatch,
  getVendorAccessOptions,
} = require("../services/userDataAccess.service");

const normalizeText = (value = "") => String(value ?? "").trim();
const normalizeEmail = (value = "") => normalizeText(value).toLowerCase();
const escapeRegex = (value = "") => normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CONTACT_PERSON_TYPES = new Set(["merchant", "shipment"]);
const normalizeCode = (value = "") => normalizeText(value).toUpperCase().replace(/\s+/g, "");
const normalizeKey = (value = "") => normalizeText(value).toLowerCase().replace(/\s+/g, " ");

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

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

const normalizeVendorCodeEntries = (value = []) => {
  if (typeof value === "string") {
    const code = normalizeText(value);
    return code ? [{ brand: "", code }] : [];
  }

  return (Array.isArray(value) ? value : [])
    .map((entry = {}) => {
      if (typeof entry === "string") {
        return { brand: "", code: normalizeText(entry) };
      }

      return {
        brand: normalizeText(entry?.brand || entry?.brand_name || entry?.brandName),
        code: normalizeText(entry?.code || entry?.vendor_code || entry?.vendorCode),
      };
    })
    .filter((entry) => entry.brand || entry.code);
};

const formatVendorCodes = (value = []) => {
  const entries = normalizeVendorCodeEntries(value);
  if (entries.length === 0) return "";

  return entries
    .map((entry) =>
      entry.brand && entry.code
        ? `${entry.brand}: ${entry.code}`
        : entry.code || entry.brand,
    )
    .filter(Boolean)
    .join("; ");
};

const normalizeVendorCodeKey = (entry = {}) =>
  `${normalizeText(entry.brand).toLowerCase()}\u0000${normalizeText(entry.code).toLowerCase()}`;

const getBrandNameMap = async (user = {}) => {
  const brands = await Brand.find(
    applyBrandDocumentAccessMatch({}, user),
    "name",
  ).sort({ name: 1 }).lean();
  return new Map(
    brands
      .map((brand) => normalizeText(brand?.name))
      .filter(Boolean)
      .map((name) => [name.toLowerCase(), name]),
  );
};

const normalizeVendorCodesForSave = async (value = [], user = {}) => {
  const entries = normalizeVendorCodeEntries(value);
  if (entries.length === 0) {
    throw createHttpError(400, "At least one brand and vendor code is required");
  }

  const incompleteEntry = entries.find((entry) => !entry.brand || !entry.code);
  if (incompleteEntry) {
    throw createHttpError(400, "Select a brand and enter a code for every vendor code row");
  }

  const seen = new Set();
  for (const entry of entries) {
    const key = normalizeVendorCodeKey(entry);
    if (seen.has(key)) {
      throw createHttpError(400, "Duplicate brand and vendor code rows are not allowed");
    }
    seen.add(key);
  }

  const brandNameMap = await getBrandNameMap(user);
  const unknownBrands = [
    ...new Set(
      entries
        .map((entry) => entry.brand)
        .filter((brand) => !brandNameMap.has(brand.toLowerCase())),
    ),
  ];
  if (unknownBrands.length > 0) {
    throw createHttpError(400, `Unknown brand selected: ${unknownBrands.join(", ")}`);
  }

  return entries.map((entry) => ({
    brand: brandNameMap.get(entry.brand.toLowerCase()),
    code: entry.code,
  }));
};

const buildVendorCodeDuplicateConditions = (vendorCodes = []) =>
  normalizeVendorCodeEntries(vendorCodes).map((entry) => ({
    vendor_code: {
      $elemMatch: {
        brand: { $regex: `^${escapeRegex(entry.brand)}$`, $options: "i" },
        code: { $regex: `^${escapeRegex(entry.code)}$`, $options: "i" },
      },
    },
  }));

const serializeVendor = (vendor = {}, allowedBrandNames = null) => ({
  _id: String(vendor._id || ""),
  name: normalizeText(vendor.name),
  owner_name: normalizeText(vendor.owner_name),
  email: normalizeEmail(vendor.email),
  phone: normalizeText(vendor.phone),
  country: normalizeText(vendor.country),
  address: normalizeText(vendor.address),
  vendor_code: normalizeVendorCodeEntries(vendor.vendor_code).filter((entry) =>
    !allowedBrandNames || allowedBrandNames.has(entry.brand.toLowerCase()),
  ),
  vendor_code_label: formatVendorCodes(
    normalizeVendorCodeEntries(vendor.vendor_code).filter((entry) =>
      !allowedBrandNames || allowedBrandNames.has(entry.brand.toLowerCase()),
    ),
  ),
  contact_person: normalizeContactPersons(vendor.contact_person),
  is_active: vendor.is_active !== false,
  created_at: vendor.created_at || vendor.createdAt || null,
  updated_at: vendor.updated_at || vendor.updatedAt || null,
  deleted_at: vendor.deleted_at || null,
});

const getVendorCodeForBrand = (vendorCodes = [], brand = "") => {
  const brandKey = normalizeKey(brand);
  if (!brandKey) return "";
  const match = normalizeVendorCodeEntries(vendorCodes).find(
    (entry) => normalizeKey(entry.brand) === brandKey,
  );
  return normalizeCode(match?.code);
};

const buildVendorSnapshot = (vendor = {}) => ({
  name: normalizeText(vendor.name),
  vendor_id: vendor._id,
  country: normalizeText(vendor.country),
});

const getVendorCodeSignature = (vendorCodes = []) =>
  normalizeVendorCodeEntries(vendorCodes)
    .map((entry) => `${normalizeKey(entry.brand)}:${normalizeCode(entry.code)}`)
    .sort()
    .join("|");

const shouldSyncVendorFinishes = (vendor = {}, previousVendor = {}) =>
  normalizeText(vendor.name) !== normalizeText(previousVendor.name) ||
  normalizeText(vendor.country) !== normalizeText(previousVendor.country) ||
  getVendorCodeSignature(vendor.vendor_code) !== getVendorCodeSignature(previousVendor.vendor_code);

const buildVendorFinishMatch = (vendor = {}, previousVendor = {}) => {
  const names = [
    normalizeText(vendor.name),
    normalizeText(previousVendor.name),
  ].filter(Boolean);
  const seen = new Set();
  const nameConditions = names.flatMap((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    const regex = new RegExp(`^${escapeRegex(name)}$`, "i");
    return [{ vendor: regex }, { "vendor.name": regex }];
  });

  return {
    $or: [
      { "vendor.vendor_id": vendor._id },
      ...nameConditions,
    ],
  };
};

const buildVendorFinishSyncPlan = async (vendor = {}, previousVendor = {}) => {
  const finishes = await Finish.find(buildVendorFinishMatch(vendor, previousVendor))
    .select("_id unique_code vendor vendor_code color_code item_codes")
    .lean();
  if (finishes.length === 0) return [];

  const itemCodes = [
    ...new Set(
      finishes
        .flatMap((finish) => Array.isArray(finish.item_codes) ? finish.item_codes : [])
        .map(normalizeText)
        .filter(Boolean),
    ),
  ];
  const items = await Item.find({ code: { $in: itemCodes } })
    .select("code brand brand_name")
    .lean();
  const brandByItemCode = new Map(
    items.map((item) => [normalizeText(item.code), normalizeText(item.brand_name || item.brand)]),
  );
  const vendorSnapshot = buildVendorSnapshot(vendor);
  const updates = finishes.flatMap((finish) => {
    const brands = [
      ...new Set(
        (Array.isArray(finish.item_codes) ? finish.item_codes : [])
          .map((itemCode) => brandByItemCode.get(normalizeText(itemCode)))
          .filter(Boolean),
      ),
    ];
    const expectedCodes = [
      ...new Set(
        brands
          .map((brand) => getVendorCodeForBrand(vendor.vendor_code, brand))
          .filter(Boolean),
      ),
    ];
    if (expectedCodes.length !== 1) return [];

    const vendorCode = expectedCodes[0];
    const uniqueCode = normalizeCode(`${vendorCode}-${finish.color_code}`);
    if (!vendorCode || !uniqueCode) return [];
    const vendorChanged =
      String(getVendorId(finish.vendor) || "") !== String(vendor._id || "") ||
      normalizeText(getVendorName(finish.vendor)) !== vendorSnapshot.name ||
      normalizeText(getVendorCountry(finish.vendor)) !== vendorSnapshot.country;
    if (
      normalizeCode(finish.vendor_code) === vendorCode &&
      normalizeCode(finish.unique_code) === uniqueCode &&
      !vendorChanged
    ) {
      return [];
    }
    return [{
      finishId: finish._id,
      currentUniqueCode: normalizeCode(finish.unique_code),
      vendorCode,
      uniqueCode,
      vendor: vendorSnapshot,
    }];
  });

  const nextUniqueCodes = updates.map((update) => update.uniqueCode);
  const duplicateUniqueCode = nextUniqueCodes.find(
    (uniqueCode, index) => nextUniqueCodes.indexOf(uniqueCode) !== index,
  );
  if (duplicateUniqueCode) {
    throw createHttpError(409, `Vendor code update would duplicate finish ${duplicateUniqueCode}`);
  }

  const conflicts = await Finish.find({
    unique_code: { $in: nextUniqueCodes },
    _id: { $nin: updates.map((update) => update.finishId) },
  })
    .select("unique_code")
    .lean();
  if (conflicts.length > 0) {
    throw createHttpError(
      409,
      `Vendor code update conflicts with finish ${conflicts.map((finish) => finish.unique_code).join(", ")}`,
    );
  }

  return updates;
};

const applyVendorFinishSyncPlan = async (updates = []) => {
  for (const update of updates) {
    await Finish.updateOne(
      { _id: update.finishId },
      {
        $set: {
          vendor: update.vendor,
          vendor_code: update.vendorCode,
          unique_code: update.uniqueCode,
        },
      },
    );
    await Item.updateMany(
      { "finish.finish_id": update.finishId },
      {
        $set: {
          "finish.$[entry].vendor": update.vendor,
          "finish.$[entry].vendor_code": update.vendorCode,
          "finish.$[entry].unique_code": update.uniqueCode,
        },
      },
      { arrayFilters: [{ "entry.finish_id": update.finishId }] },
    );
    if (update.currentUniqueCode && update.currentUniqueCode !== update.uniqueCode) {
      await Item.updateMany(
        { "finish.unique_code": update.currentUniqueCode },
        {
          $set: {
            "finish.$[entry].vendor": update.vendor,
            "finish.$[entry].vendor_code": update.vendorCode,
            "finish.$[entry].unique_code": update.uniqueCode,
          },
        },
        { arrayFilters: [{ "entry.unique_code": update.currentUniqueCode }] },
      );
    }
  }

  return { updated_finishes: updates.length };
};

const getVendors = async (req, res) => {
  try {
    const [vendorOptions, brandNameMap] = await Promise.all([
      getVendorAccessOptions({ user: req.user }),
      getBrandNameMap(req.user),
    ]);
    const vendors = await Vendor.find({
      _id: { $in: vendorOptions.map((vendor) => vendor._id) },
      $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
    })
      .sort({ country: 1, name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: vendors.map((vendor) => serializeVendor(vendor, new Set(brandNameMap.keys()))),
    });
  } catch (error) {
    console.error("Get Vendors Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch vendors",
    });
  }
};

const getVendorBrandOptions = async (req, res) => {
  try {
    const brands = await Brand.find(
      applyBrandDocumentAccessMatch({}, req.user),
      "name",
    ).sort({ name: 1 }).lean();

    return res.status(200).json({
      success: true,
      data: [
        ...new Set(
          brands
            .map((brand) => normalizeText(brand?.name))
            .filter(Boolean),
        ),
      ],
    });
  } catch (error) {
    console.error("Get Vendor Brand Options Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch brand options",
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
    const vendor_code = await normalizeVendorCodesForSave(req.body?.vendor_code, req.user);
    const contact_person = normalizeContactPersons(req.body?.contact_person);
    const is_active = req.body?.is_active !== false;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    const duplicateConditions = [
      { name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } },
      ...buildVendorCodeDuplicateConditions(vendor_code),
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
          ? "Vendor with this name, email, or brand/code pair already exists"
          : "Vendor with this name or brand/code pair already exists",
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
    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
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
    let vendor_code = await normalizeVendorCodesForSave(req.body?.vendor_code, req.user);
    const contact_person = normalizeContactPersons(req.body?.contact_person);
    const is_active = req.body?.is_active !== false;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Vendor ID is required",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    const accessibleVendorIds = (await getVendorAccessOptions({ user: req.user }))
      .map((vendor) => vendor._id);
    const existingVendor = accessibleVendorIds.includes(String(id))
      ? await Vendor.findById(id)
      : null;
    if (!existingVendor || existingVendor.deleted_at) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    const allowedBrandNames = await getBrandNameMap(req.user);
    const preservedVendorCodes = normalizeVendorCodeEntries(existingVendor.vendor_code)
      .filter((entry) => !allowedBrandNames.has(entry.brand.toLowerCase()));
    vendor_code = [...preservedVendorCodes, ...vendor_code];

    const duplicateConditions = [
      { name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } },
      ...buildVendorCodeDuplicateConditions(vendor_code),
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
          ? "Another vendor with this name, email, or brand/code pair already exists"
          : "Another vendor with this name or brand/code pair already exists",
      });
    }

    const previousVendor = existingVendor.toObject();
    const nextVendor = {
      ...previousVendor,
      _id: existingVendor._id,
      name,
      country,
      vendor_code,
    };
    const finishSyncPlan = shouldSyncVendorFinishes(nextVendor, previousVendor)
      ? await buildVendorFinishSyncPlan(nextVendor, previousVendor)
      : [];

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
    const finishSync = await applyVendorFinishSyncPlan(finishSyncPlan);

    return res.status(200).json({
      success: true,
      message: "Vendor updated successfully",
      data: {
        ...serializeVendor(existingVendor.toObject(), new Set(allowedBrandNames.keys())),
        finish_sync: finishSync,
      },
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
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

    const [vendorOptions, brandNameMap] = await Promise.all([
      getVendorAccessOptions({ user: req.user }),
      getBrandNameMap(req.user),
    ]);
    const rawVendors = await Vendor.find({
      _id: { $in: vendorOptions.map((vendor) => vendor._id) },
      $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
    })
      .sort({ country: 1, name: 1 })
      .lean();

    const allowedBrandNames = new Set(brandNameMap.keys());
    let vendors = rawVendors.map((vendor) => serializeVendor(vendor, allowedBrandNames));

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
      { header: "Vendor Codes", value: (v) => v.vendor_code_label || "N/A" },
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
  getVendorBrandOptions,
  getVendors,
  updateVendor,
  exportVendors,
};
