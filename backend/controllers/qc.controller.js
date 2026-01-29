const QC = require("../models/qc.model");

/**
 * GET /qclist
 * Fetch all QC records (pagination optional)
 */
exports.getQCList = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const data = await QC.find()
      .populate("order", "order_id vendor")
      .populate("inspector", "name role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await QC.countDocuments();

    res.json({
      data,
      pagination: {
        page: Number(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
      },
    });
  } catch (err) {
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
 * QC inspector updates checked / passed / rejected
 */
exports.updateQC = async (req, res) => {
  try {
    const { qc_checked, qc_passed, qc_rejected, remarks } = req.body;

    const qc = await QC.findById(req.params.id);
    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }

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
