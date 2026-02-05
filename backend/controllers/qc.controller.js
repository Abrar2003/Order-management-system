const QC = require("../models/qc.model");
const Order = require("../models/order.model")
const mongoose = require("mongoose");

const normalizeLabels = (labels = []) => {
  if (!Array.isArray(labels)) return [];
  const numericLabels = labels
    .map((label) => Number(label))
    .filter((label) => Number.isFinite(label));
  return [...new Set(numericLabels)].sort((a, b) => a - b);
};

const findRejectedLabels = (sortedLabels = []) => {
  if (sortedLabels.length < 2) return [];
  const rejected = [];
  for (let i = 1; i < sortedLabels.length; i++) {
    const previous = sortedLabels[i - 1];
    const current = sortedLabels[i];
    if (current - previous > 1) {
      for (let missing = previous + 1; missing < current; missing++) {
        rejected.push(missing);
      }
    }
  }
  return rejected;
};

/**
 * GET /qclist
 * Fetch all QC records (pagination optional)
 */
exports.getQCList = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      inspector,
      vendor,
    } = req.query;

    const skip = (page - 1) * limit;

    const matchStage = {};

    // 🔍 Inspector filter
    if (inspector) {
      matchStage.inspector = new mongoose.Types.ObjectId(inspector);
    }

    // 🔍 Search filter
    if (search) {
      matchStage.$or = [
        { "item.item_code": { $regex: search, $options: "i" } },
      ];
    }

    const pipeline = [
      {
        $lookup: {
          from: "orders",
          localField: "order",
          foreignField: "_id",
          as: "order",
        },
      },
      { $unwind: "$order" },

      // 🔍 Vendor search (order.vendor)
      ...(vendor
        ? [{ $match: { "order.vendor": vendor } }]
        : []),

      { $match: matchStage },

      {
        $lookup: {
          from: "users",
          localField: "inspector",
          foreignField: "_id",
          as: "inspector",
        },
      },
      { $unwind: "$inspector" },

      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: Number(limit) },
    ];

    const data = await QC.aggregate(pipeline);

    // 📊 Count
    const countPipeline = pipeline.filter(
      (stage) => !stage.$skip && !stage.$limit && !stage.$sort
    );

    const totalRecords = (await QC.aggregate(countPipeline)).length;

    res.json({
      data,
      pagination: {
        page: Number(page),
        totalPages: Math.ceil(totalRecords / limit),
        totalRecords,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};



/**
 * POST /align-qc
 * Manager/Admin aligns QC + vendor provision
 */
exports.alignQC = async (req, res) => {
  try {
    const { order, item, inspector, quantities, remarks, request_date } = req.body;

    const existingQC = await QC.findOne({
      order: order,
      "item.item_code": item.item_code,
    });

    if (existingQC) {
      return res.status(400).json({ message: "QC already aligned" });
    }

    if( quantities.vendor_provision > quantities.client_demand){
      return res.status(400).json({message: "vendor provision can't be greater than client demand"})
    }

    if (new Date(request_date).getTime() < Date.now()){
      return res.status(400).json({message: "request date must be a present date or future date"})
    }

    const qc = await QC.create({
      order,
      item,
      inspector,
      request_date,
      quantities: {
        client_demand: quantities.client_demand,
        vendor_provision: quantities.vendor_provision,
        qc_checked: 0,
        qc_passed: 0,
        qc_rejected: 0,
        pending: quantities.client_demand - quantities.vendor_provision,
      },
      remarks,
      createdBy: req.user._id,
    });

    const orderRecord = await Order.findById(order);

    orderRecord.status = "Under Inspection";
    orderRecord.qc_record = qc._id;

    await orderRecord.save();

    res.status(201).json({
      message: "QC aligned successfully",
      data: qc,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/**
 * PATCH /update-qc/:id
 * QC inspector updates checked / passed / rejected with allocated labels
 */
exports.updateQC = async (req, res) => {
  try {
    const {
      qc_checked,
      qc_passed,
      qc_rejected,
      remarks,
      labels,
      vendor_provision,
      cbm,
      cbm_top,
      cbm_bottom,
      cbm_total,
      barcode,
      packed_size,
      finishing,
      branding,
    } = req.body;

    const qc = await QC.findById(req.params.id).populate("inspector");
    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const hasQuantityPayload =
      qc_checked !== undefined ||
      qc_passed !== undefined ||
      qc_rejected !== undefined ||
      vendor_provision !== undefined;
    const hasLabelPayload =
      Array.isArray(labels) && labels.length > 0;
    const isAdmin = req.user.role === "admin";

    // 🔐 Verify that the current user is the assigned inspector (admins can override)
    if (!isAdmin && qc.inspector._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You are not authorized to update this QC record" });
    }

    const hasPriorUpdate =
      qc.quantities.qc_checked > 0 ||
      qc.quantities.qc_passed > 0 ||
      qc.quantities.qc_rejected > 0 ||
      (qc.labels?.length || 0) > 0;

    const currentPending =
      qc.quantities.client_demand - qc.quantities.qc_passed;
    const requirementsMet = qc.packed_size && qc.finishing && qc.branding;

    if (!isAdmin && hasPriorUpdate && currentPending <= 0) {
      if (requirementsMet) {
        return res.status(400).json({
          message: "QC record is finalized and cannot be updated",
        });
      }
      if (hasQuantityPayload || hasLabelPayload) {
        return res.status(400).json({
          message: "QC record has no pending quantity to update",
        });
      }
    }

    const parsePositiveInt = (value, fieldName) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { error: `${fieldName} must be a positive integer` };
      }
      return { value: parsed };
    };

    const normalizeDecimalString = (value) => {
      if (value === undefined || value === null) return null;
      const raw = typeof value === "string" ? value.trim() : String(value);
      if (raw === "") return null;
      if (!/^\d+(\.\d+)?$/.test(raw)) return null;
      const [intRaw, fracRaw = ""] = raw.split(".");
      let intPart = intRaw.replace(/^0+(?=\d)/, "");
      if (intPart === "") intPart = "0";
      let fracPart = fracRaw.replace(/0+$/, "");
      if (fracPart === "") return intPart;
      return `${intPart}.${fracPart}`;
    };

    const parsePositiveDecimalString = (value, fieldName) => {
      const raw = typeof value === "string" ? value.trim() : String(value);
      const normalized = normalizeDecimalString(raw);
      if (!normalized || normalized === "0") {
        return { error: `${fieldName} must be a positive number` };
      }
      return { value: raw, normalized };
    };

    const addBigIntStrings = (left, right) => {
      let i = left.length - 1;
      let j = right.length - 1;
      let carry = 0;
      let out = "";

      while (i >= 0 || j >= 0 || carry) {
        const digitLeft = i >= 0 ? Number(left[i]) : 0;
        const digitRight = j >= 0 ? Number(right[j]) : 0;
        const sum = digitLeft + digitRight + carry;
        out = String(sum % 10) + out;
        carry = Math.floor(sum / 10);
        i -= 1;
        j -= 1;
      }

      return out.replace(/^0+(?=\d)/, "");
    };

    const addDecimalStrings = (left, right) => {
      const [leftIntRaw, leftFracRaw = ""] = left.split(".");
      const [rightIntRaw, rightFracRaw = ""] = right.split(".");
      const fracLen = Math.max(leftFracRaw.length, rightFracRaw.length);
      const leftFrac = leftFracRaw.padEnd(fracLen, "0");
      const rightFrac = rightFracRaw.padEnd(fracLen, "0");
      const leftInt = leftIntRaw.replace(/^0+(?=\d)/, "") || "0";
      const rightInt = rightIntRaw.replace(/^0+(?=\d)/, "") || "0";
      const sum = addBigIntStrings(leftInt + leftFrac, rightInt + rightFrac);

      if (fracLen === 0) {
        return sum.replace(/^0+(?=\d)/, "") || "0";
      }

      const padded = sum.padStart(fracLen + 1, "0");
      const intPart = padded.slice(0, -fracLen);
      const fracPart = padded.slice(-fracLen);
      const intClean = intPart.replace(/^0+(?=\d)/, "") || "0";
      return `${intClean}.${fracPart}`;
    };

    const parseBoolean = (value, fieldName) => {
      if (typeof value === "boolean") return { value };
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return { value: true };
        if (normalized === "false") return { value: false };
      }
      return { error: `${fieldName} must be a boolean` };
    };

    const existingCbm =
      qc.cbm && typeof qc.cbm === "object"
        ? {
            top: qc.cbm.top ?? "0",
            bottom: qc.cbm.bottom ?? "0",
            total: qc.cbm.total ?? "0",
          }
        : {
            top: "0",
            bottom: "0",
            total: qc.cbm ?? "0",
          };

    const hasCbmTop = cbm_top !== undefined && cbm_top !== "";
    const hasCbmBottom = cbm_bottom !== undefined && cbm_bottom !== "";
    const hasCbmTotal = cbm_total !== undefined && cbm_total !== "";
    const hasLegacyCbm = cbm !== undefined && cbm !== "";
    const hasCbmPayload = hasCbmTop || hasCbmBottom || hasCbmTotal || hasLegacyCbm;
    const normalizedExisting = {
      top: normalizeDecimalString(existingCbm.top) || "0",
      bottom: normalizeDecimalString(existingCbm.bottom) || "0",
      total: normalizeDecimalString(existingCbm.total) || "0",
    };
    const cbmAlreadySet =
      normalizedExisting.top !== "0" ||
      normalizedExisting.bottom !== "0" ||
      normalizedExisting.total !== "0";

    if (hasCbmPayload) {
      if ((hasCbmTop || hasCbmBottom) && (hasCbmTotal || hasLegacyCbm)) {
        return res.status(400).json({
          message: "Provide either CBM total or CBM top/bottom, not both",
        });
      }

      if (hasCbmTop !== hasCbmBottom) {
        return res.status(400).json({
          message: "Both CBM top and bottom are required",
        });
      }

      const parsedTop = hasCbmTop
        ? parsePositiveDecimalString(cbm_top, "cbm_top")
        : null;
      const parsedBottom = hasCbmBottom
        ? parsePositiveDecimalString(cbm_bottom, "cbm_bottom")
        : null;
      const parsedTotal = hasCbmTotal
        ? parsePositiveDecimalString(cbm_total, "cbm_total")
        : hasLegacyCbm
          ? parsePositiveDecimalString(cbm, "cbm_total")
          : null;

      if (parsedTop?.error || parsedBottom?.error || parsedTotal?.error) {
        return res.status(400).json({
          message: parsedTop?.error || parsedBottom?.error || parsedTotal?.error,
        });
      }

      if (cbmAlreadySet && !isAdmin) {
        const mismatch =
          (parsedTop && parsedTop.normalized !== normalizedExisting.top) ||
          (parsedBottom && parsedBottom.normalized !== normalizedExisting.bottom) ||
          (parsedTotal && parsedTotal.normalized !== normalizedExisting.total);
        if (mismatch) {
          return res.status(400).json({
            message: "cbm can only be set once",
          });
        }
      } else if (parsedTotal) {
        qc.cbm = {
          top: "0",
          bottom: "0",
          total: parsedTotal.value,
        };
      } else if (parsedTop && parsedBottom) {
        qc.cbm = {
          top: parsedTop.value,
          bottom: parsedBottom.value,
          total: addDecimalStrings(parsedTop.value, parsedBottom.value),
        };
      }
    }

    if (barcode !== undefined) {
      if (qc.barcode > 0) {
        if (Number(barcode) !== qc.barcode) {
          return res.status(400).json({
            message: "barcode can only be set once",
          });
        }
      } else {
        const parsed = parsePositiveInt(barcode, "barcode");
        if (parsed.error) {
          return res.status(400).json({ message: parsed.error });
        }
        qc.barcode = parsed.value;
      }
    }

    if (packed_size !== undefined) {
      const parsed = parseBoolean(packed_size, "packed_size");
      if (parsed.error) {
        return res.status(400).json({ message: parsed.error });
      }
      if (qc.packed_size && parsed.value === false) {
        return res.status(400).json({
          message: "packed_size can only be set once",
        });
      }
      if (!qc.packed_size && parsed.value === true) {
        qc.packed_size = true;
      }
    }

    if (finishing !== undefined) {
      const parsed = parseBoolean(finishing, "finishing");
      if (parsed.error) {
        return res.status(400).json({ message: parsed.error });
      }
      if (qc.finishing && parsed.value === false) {
        return res.status(400).json({
          message: "finishing can only be set once",
        });
      }
      if (!qc.finishing && parsed.value === true) {
        qc.finishing = true;
      }
    }

    if (branding !== undefined) {
      const parsed = parseBoolean(branding, "branding");
      if (parsed.error) {
        return res.status(400).json({ message: parsed.error });
      }
      if (qc.branding && parsed.value === false) {
        return res.status(400).json({
          message: "branding can only be set once",
        });
      }
      if (!qc.branding && parsed.value === true) {
        qc.branding = true;
      }
    }

    const addChecked = qc_checked !== undefined ? Number(qc_checked) : 0;
    const addPassed = qc_passed !== undefined ? Number(qc_passed) : 0;
    const addRejected = qc_rejected !== undefined ? Number(qc_rejected) : 0;
    const addProvision =
      vendor_provision !== undefined ? Number(vendor_provision) : 0;

    const numericFields = [
      { name: "qc_checked", value: addChecked, provided: qc_checked !== undefined },
      { name: "qc_passed", value: addPassed, provided: qc_passed !== undefined },
      { name: "qc_rejected", value: addRejected, provided: qc_rejected !== undefined },
      { name: "vendor_provision", value: addProvision, provided: vendor_provision !== undefined },
    ];

    for (const field of numericFields) {
      if (field.provided && Number.isNaN(field.value)) {
        return res.status(400).json({
          message: `${field.name} must be a valid number`,
        });
      }
      if (field.provided && field.value < 0) {
        return res.status(400).json({
          message: `${field.name} cannot be negative`,
        });
      }
    }

    const hasQuantityUpdate = numericFields.some((field) => field.provided);
    const hasLabelUpdate =
      labels !== undefined && Array.isArray(labels) && labels.length > 0;

    if ((hasQuantityUpdate || hasLabelUpdate) && addChecked <= 0) {
      return res.status(400).json({
        message: "qc_checked must be greater than 0 when updating quantities or labels",
      });
    }

    const nextVendorProvision =
      qc.quantities.vendor_provision + addProvision - addRejected;
    const nextChecked = qc.quantities.qc_checked + addChecked;
    const nextPassed = qc.quantities.qc_passed + addPassed;
    const nextRejected = qc.quantities.qc_rejected + addRejected;
    const totalOfferedNext =
      qc.quantities.vendor_provision + qc.quantities.qc_rejected + addProvision;

    if (nextVendorProvision < 0) {
      return res.status(400).json({
        message: "offered quantity cannot be negative",
      });
    }

    if (nextVendorProvision > qc.quantities.client_demand) {
      return res.status(400).json({
        message: "offered quantity cannot exceed client demand",
      });
    }

    if (nextChecked > totalOfferedNext) {
      return res.status(400).json({
        message: "qc_checked cannot exceed offered quantity",
      });
    }

    if (nextPassed > nextVendorProvision) {
      return res.status(400).json({
        message: "qc_passed cannot exceed offered quantity",
      });
    }

    if (nextPassed + nextRejected > nextChecked) {
      return res.status(400).json({
        message: "qc_passed + qc_rejected cannot exceed qc_checked",
      });
    }

    // 📋 Validate and update labels if provided
    if (labels !== undefined) {
      if (!Array.isArray(labels)) {
        return res
          .status(400)
          .json({ message: "Labels must be an array of numbers" });
      }

      if (labels.length > 0) {
        const Inspector = require("../models/inspector.model");

        const inspector = await Inspector.findOne({ user: req.user._id });
        if (!inspector) {
          return res.status(404).json({ message: "Inspector record not found" });
        }

        const parsedLabels = labels.map((label) => Number(label));
        if (parsedLabels.some((label) => Number.isNaN(label))) {
          return res
            .status(400)
            .json({ message: "All labels must be numbers" });
        }

        const uniqueLabels = [...new Set(parsedLabels)];

        const existingQcLabels = new Set(
          (qc.labels || []).map((label) => Number(label))
        );

        const incomingNewLabels = uniqueLabels.filter(
          (label) => !existingQcLabels.has(label)
        );

        if (incomingNewLabels.length > addChecked) {
          return res.status(400).json({
            message: "labels count cannot exceed qc_checked for this update",
          });
        }

        const totalLabelsCount =
          existingQcLabels.size + incomingNewLabels.length;
        if (totalLabelsCount > nextChecked) {
          return res.status(400).json({
            message: "total labels cannot exceed total qc_checked",
          });
        }

        const allocatedSet = new Set(
          (inspector.alloted_labels || []).map((label) => Number(label))
        );

        const unauthorizedLabels = incomingNewLabels.filter(
          (label) => !allocatedSet.has(label)
        );

        if (unauthorizedLabels.length > 0) {
          return res.status(403).json({
            message: `You are not authorized to use labels: ${unauthorizedLabels.join(
              ", "
            )}. Allocated labels: ${inspector.alloted_labels.join(", ")}`,
            unauthorized_labels: unauthorizedLabels,
            allocated_labels: inspector.alloted_labels,
          });
        }

        const usedSet = new Set(
          (inspector.used_labels || []).map((label) => Number(label))
        );

        const alreadyUsedLabels = incomingNewLabels.filter((label) =>
          usedSet.has(label)
        );

        if (alreadyUsedLabels.length > 0) {
          return res.status(403).json({
            message: `These labels are already used: ${alreadyUsedLabels.join(
              ", "
            )}`,
            used_labels: inspector.used_labels,
            already_used: alreadyUsedLabels,
          });
        }

        const newUsedLabels = [
          ...new Set([...usedSet, ...incomingNewLabels]),
        ];
        inspector.used_labels = newUsedLabels;
        await inspector.save();

        qc.labels = normalizeLabels([
          ...existingQcLabels,
          ...incomingNewLabels,
        ]);
      }
    }

    // Update QC quantities (incremental)
    qc.quantities.vendor_provision = nextVendorProvision;
    qc.quantities.qc_checked = nextChecked;
    qc.quantities.qc_passed = nextPassed;
    qc.quantities.qc_rejected = nextRejected;

    qc.quantities.pending =
      qc.quantities.client_demand - qc.quantities.qc_passed;

    if (remarks) qc.remarks = remarks;

    await qc.save();

    res.json({
      message: "QC updated successfully",
      data: qc,
    }); 
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getQCById = async (req, res) => {
  try {
    const qc = await QC.findById(req.params.id)
      .populate("inspector", "name email role")
      .populate("createdBy", "name email role")
      .populate("order");

    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }
    const qcData = qc.toObject();
    const sortedLabels = normalizeLabels(qcData.labels);
    const rejectedLabels = findRejectedLabels(sortedLabels);

    res.json({
      data: {
        ...qcData,
        labels: sortedLabels,
        rejected_labels: rejectedLabels,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
