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

    const clientDemand = Number(quantities?.client_demand);
    const vendorProvision = Number(quantities?.vendor_provision);

    if (Number.isNaN(clientDemand) || Number.isNaN(vendorProvision)) {
      return res.status(400).json({
        message: "client demand and vendor provision must be valid numbers",
      });
    }

    if( vendorProvision > clientDemand){
      return res.status(400).json({message: "vendor provision can't be greater than client demand"})
    }

    if (new Date(request_date).getTime() < Date.now()){
      return res.status(400).json({message: "request date must be a present date or future date"})
    }

    if (existingQC) {
      if (clientDemand < existingQC.quantities.qc_passed) {
        return res.status(400).json({
          message: "client demand cannot be less than already passed quantity",
        });
      }

      if (vendorProvision < existingQC.quantities.qc_passed) {
        return res.status(400).json({
          message: "vendor provision cannot be less than already passed quantity",
        });
      }

      const totalOffered =
        vendorProvision + (existingQC.quantities.qc_rejected || 0);

      if ((existingQC.quantities.qc_checked || 0) > totalOffered) {
        return res.status(400).json({
          message: "vendor provision cannot be less than already checked quantity",
        });
      }

      existingQC.inspector = inspector;
      existingQC.request_date = request_date;
      existingQC.item = item;
      existingQC.quantities.client_demand = clientDemand;
      existingQC.quantities.vendor_provision = vendorProvision;
      existingQC.quantities.pending =
        clientDemand - (existingQC.quantities.qc_passed || 0);

      if (remarks !== undefined) {
        existingQC.remarks = remarks;
      }

      await existingQC.save();

      const orderRecord = await Order.findById(order);
      if (orderRecord) {
        orderRecord.status = "Under Inspection";
        orderRecord.qc_record = existingQC._id;
        await orderRecord.save();
      }

      return res.status(200).json({
        message: "QC re-aligned successfully",
        data: existingQC,
      });
    }

    const qc = await QC.create({
      order,
      item,
      inspector,
      request_date,
      quantities: {
        client_demand: clientDemand,
        vendor_provision: vendorProvision,
        qc_checked: 0,
        qc_passed: 0,
        qc_rejected: 0,
        pending: clientDemand - vendorProvision,
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
      barcode,
      packed_size,
      finishing,
      branding,

      // 🔁 NEW INPUTS
      LBH_top,
      LBH_bottom,
      LBH,
    } = req.body;

    const qc = await QC.findById(req.params.id).populate("inspector");
    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const isAdmin = req.user.role === "admin";

    if (
      !isAdmin &&
      qc.inspector._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        message: "You are not authorized to update this QC record",
      });
    }

    /* ────────────────────────
       📐 LBH → CBM HELPERS
    ──────────────────────── */

    const isValidLBH = (obj) =>
      obj &&
      typeof obj === "object" &&
      ["l", "b", "h"].every(
        (k) => typeof obj[k] === "number" && obj[k] > 0
      );

    const cmToCbmString = ({ l, b, h }) => {
      const cbm = (l * b * h) / 1_000_000;
      return cbm.toFixed(6).replace(/\.?0+$/, "");
    };

    const existingCbm = {
      top: qc.cbm?.top ?? "0",
      bottom: qc.cbm?.bottom ?? "0",
      total: qc.cbm?.total ?? "0",
    };

    const cbmAlreadySet =
      existingCbm.top !== "0" ||
      existingCbm.bottom !== "0" ||
      existingCbm.total !== "0";

    const hasLBHTop = LBH_top !== undefined;
    const hasLBHBottom = LBH_bottom !== undefined;
    const hasLBHTotal = LBH !== undefined;

    if (hasLBHTotal && (hasLBHTop || hasLBHBottom)) {
      return res.status(400).json({
        message: "Provide either LBH or LBH_top/LBH_bottom, not both",
      });
    }

    if (hasLBHTop !== hasLBHBottom) {
      return res.status(400).json({
        message: "Both LBH_top and LBH_bottom are required",
      });
    }

    let computedTop = "0";
    let computedBottom = "0";
    let computedTotal = "0";

    if (hasLBHTotal) {
      if (!isValidLBH(LBH)) {
        return res.status(400).json({ message: "Invalid LBH structure" });
      }
      computedTotal = cmToCbmString(LBH);
    }

    if (hasLBHTop && hasLBHBottom) {
      if (!isValidLBH(LBH_top) || !isValidLBH(LBH_bottom)) {
        return res.status(400).json({
          message: "Invalid LBH_top or LBH_bottom structure",
        });
      }

      computedTop = cmToCbmString(LBH_top);
      computedBottom = cmToCbmString(LBH_bottom);
      computedTotal = (
        Number(computedTop) + Number(computedBottom)
      )
        .toFixed(6)
        .replace(/\.?0+$/, "");
    }

    if ((hasLBHTotal || hasLBHTop) && cbmAlreadySet && !isAdmin) {
      const mismatch =
        computedTop !== existingCbm.top ||
        computedBottom !== existingCbm.bottom ||
        computedTotal !== existingCbm.total;

      if (mismatch) {
        return res.status(400).json({
          message: "CBM can only be set once",
        });
      }
    }

    if (hasLBHTotal || hasLBHTop) {
      qc.cbm = {
        top: computedTop,
        bottom: computedBottom,
        total: computedTotal,
      };
    }

    /* ────────────────────────
       🔢 BARCODE
    ──────────────────────── */

    if (barcode !== undefined) {
      if (qc.barcode > 0 && Number(barcode) !== qc.barcode) {
        return res
          .status(400)
          .json({ message: "barcode can only be set once" });
      }
      qc.barcode = Number(barcode);
    }

    /* ────────────────────────
       ✅ BOOLEAN FLAGS
    ──────────────────────── */

    const setOnceBoolean = (field, value, name) => {
      if (value === undefined) return;
      if (typeof value !== "boolean") {
        throw new Error(`${name} must be boolean`);
      }
      if (qc[field] && value === false) {
        throw new Error(`${name} can only be set once`);
      }
      if (!qc[field] && value === true) {
        qc[field] = true;
      }
    };

    setOnceBoolean("packed_size", packed_size, "packed_size");
    setOnceBoolean("finishing", finishing, "finishing");
    setOnceBoolean("branding", branding, "branding");

    /* ────────────────────────
       🔢 QUANTITIES
    ──────────────────────── */

    const addChecked = Number(qc_checked || 0);
    const addPassed = Number(qc_passed || 0);
    const addRejected = Number(qc_rejected || 0);
    const addProvision = Number(vendor_provision || 0);

    if (
      [addChecked, addPassed, addRejected, addProvision].some(
        (v) => v < 0 || Number.isNaN(v)
      )
    ) {
      return res.status(400).json({
        message: "Quantity values must be valid non-negative numbers",
      });
    }

    if ((addPassed || addRejected || labels?.length) && addChecked <= 0) {
      return res.status(400).json({
        message:
          "qc_checked must be greater than 0 when updating quantities or labels",
      });
    }

    const nextVendorProvision =
      qc.quantities.vendor_provision + addProvision - addRejected;
    const nextChecked = qc.quantities.qc_checked + addChecked;
    const nextPassed = qc.quantities.qc_passed + addPassed;
    const nextRejected = qc.quantities.qc_rejected + addRejected;

    if (nextVendorProvision < 0) {
      return res
        .status(400)
        .json({ message: "offered quantity cannot be negative" });
    }

    if (nextPassed + nextRejected > nextChecked) {
      return res.status(400).json({
        message: "qc_passed + qc_rejected cannot exceed qc_checked",
      });
    }

    qc.quantities.vendor_provision = nextVendorProvision;
    qc.quantities.qc_checked = nextChecked;
    qc.quantities.qc_passed = nextPassed;
    qc.quantities.qc_rejected = nextRejected;
    qc.quantities.pending =
      qc.quantities.client_demand - qc.quantities.qc_passed;

    /* ────────────────────────
       🏷️ LABELS (UNCHANGED LOGIC)
    ──────────────────────── */

    if (labels !== undefined && Array.isArray(labels) && labels.length > 0) {
      const Inspector = require("../models/inspector.model");
      const inspector = await Inspector.findOne({ user: req.user._id });

      if (!inspector) {
        return res
          .status(404)
          .json({ message: "Inspector record not found" });
      }

      const parsedLabels = labels.map(Number);
      if (parsedLabels.some(Number.isNaN)) {
        return res
          .status(400)
          .json({ message: "All labels must be numbers" });
      }

      const hasDualCbm =
        Number(qc.cbm?.top) > 0 && Number(qc.cbm?.bottom) > 0;
      const labelMultiplier = hasDualCbm ? 2 : 1;

      const uniqueIncoming = [...new Set(parsedLabels)];
      const existingSet = new Set((qc.labels || []).map(Number));
      const incomingNew = uniqueIncoming.filter((label) => !existingSet.has(label));

      if (incomingNew.length > addChecked * labelMultiplier) {
        return res.status(400).json({
          message: `labels count cannot exceed ${labelMultiplier}x qc_checked for this update`,
        });
      }

      const totalLabels = existingSet.size + incomingNew.length;
      const maxTotal = nextChecked * labelMultiplier;
      if (totalLabels > maxTotal) {
        return res.status(400).json({
          message: `total labels cannot exceed ${labelMultiplier}x total qc_checked`,
        });
      }

      qc.labels = [...new Set([...qc.labels, ...incomingNew])];
      inspector.used_labels = [
        ...new Set([...inspector.used_labels, ...incomingNew]),
      ];

      await inspector.save();
    }

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
