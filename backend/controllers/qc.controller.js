const QC = require("../models/qc.model");
const Order = require("../models/order.model")
const mongoose = require("mongoose");

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
    const { order, item, inspector, quantities, remarks } = req.body;

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

    const qc = await QC.create({
      order,
      item,
      inspector,
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
    const { qc_checked, qc_passed, qc_rejected, remarks, labels } = req.body;

    const qc = await QC.findById(req.params.id).populate("inspector");
    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }

    // 🔐 Verify that the current user is the assigned inspector
    if (qc.inspector._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You are not authorized to update this QC record" });
    }

    // 📋 Validate and update labels if provided
    if (labels && Array.isArray(labels) && labels.length > 0) {
      const Inspector = require("../models/inspector.model");
      
      const inspector = await Inspector.findOne({ user: req.user._id });
      if (!inspector) {
        return res.status(404).json({ message: "Inspector record not found" });
      }

      // Check if all provided labels are in alloted_labels
      const unauthorizedLabels = labels.filter(
        label => !inspector.alloted_labels.includes(label)
      );

      if (unauthorizedLabels.length > 0) {
        return res.status(403).json({ 
          message: `You are not authorized to use labels: ${unauthorizedLabels.join(", ")}. Allocated labels: ${inspector.alloted_labels.join(", ")}`,
          unauthorized_labels: unauthorizedLabels,
          allocated_labels: inspector.alloted_labels
        });
      }

      // Update used_labels in inspector model (add new labels, avoid duplicates)
      const newUsedLabels = [...new Set([...inspector.used_labels, ...labels])];
      inspector.used_labels = newUsedLabels;
      await inspector.save();

      // Update labels in QC record
      qc.labels = labels;
    }

    // Update QC quantities
    if (qc_checked !== undefined) qc.quantities.qc_checked = qc_checked;
    if (qc_passed !== undefined) qc.quantities.qc_passed = qc_passed;
    if (qc_rejected !== undefined) qc.quantities.qc_rejected = qc_rejected;

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
    res.json({ data: qc });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};