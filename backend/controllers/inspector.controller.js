const Inspector = require("../models/inspector.model");
const User = require("../models/user.model");
const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const normalizeInspectorLabels = (labels = []) =>
  [...new Set(
    (Array.isArray(labels) ? labels : [])
      .map((label) => Number(label))
      .filter((label) => Number.isInteger(label) && label > 0),
  )].sort((left, right) => left - right);

const QC_USER_FILTER = {
  $and: [
    { role: { $regex: "^qc$", $options: "i" } },
    {
      $or: [
        { isQC: true },
        { is_qc: true },
      ],
    },
  ],
};

const buildQcUserFilter = ({ search = "" } = {}) => {
  if (!search) return QC_USER_FILTER;
  return {
    $and: [
      QC_USER_FILTER,
      {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      },
    ],
  };
};

const ensureInspectorRecordsForQcUsers = async ({ search = "" } = {}) => {
  const userFilter = buildQcUserFilter({ search });
  const qcUsers = await User.find(userFilter).select("_id").lean();
  const userIds = qcUsers.map((user) => user._id);

  if (!userIds.length) {
    return {
      userIds: [],
      eligibleQcUsers: 0,
      createdInspectors: 0,
    };
  }

  const existingInspectorUserIds = await Inspector.distinct("user", {
    user: { $in: userIds },
  });

  await Inspector.bulkWrite(
    userIds.map((userId) => ({
      updateOne: {
        filter: { user: userId },
        update: {
          $setOnInsert: {
            user: userId,
            assignedOrders: [],
            alloted_labels: [],
            used_labels: [],
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  const inspectors = await Inspector.find({ user: { $in: userIds } })
    .select("_id user")
    .lean();

  if (inspectors.length > 0) {
    await User.bulkWrite(
      inspectors.map((inspector) => ({
        updateOne: {
          filter: { _id: inspector.user },
          update: {
            $set: {
              inspector_id: inspector._id,
              isQC: true,
            },
          },
        },
      })),
      { ordered: false },
    );
  }

  const createdInspectors = Math.max(
    0,
    inspectors.length - existingInspectorUserIds.length,
  );

  return {
    userIds,
    eligibleQcUsers: userIds.length,
    createdInspectors,
  };
};

/**
 * GET /inspectors
 * Get all inspectors with pagination
 * Only accessible to Manager and Admin
 */
exports.getAllInspectors = async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const limit = parsePositiveInteger(req.query.limit, 20);
    const search = String(req.query.search || "").trim();
    const skip = (page - 1) * limit;

    const syncResult = await ensureInspectorRecordsForQcUsers({ search });
    const { userIds } = syncResult;

    const inspectors = userIds.length
      ? await Inspector.find({ user: { $in: userIds } })
          .populate("user", "name email role")
          .sort({ createdAt: -1 })
          .lean()
      : [];

    const inspectorByUser = new Map();
    inspectors.forEach((inspector) => {
      const userId = String(inspector?.user?._id || inspector?.user || "");
      if (!userId || inspectorByUser.has(userId)) return;
      inspectorByUser.set(userId, inspector);
    });

    const mergedInspectors = Array.from(inspectorByUser.values());
    const totalRecords = mergedInspectors.length;
    const data = mergedInspectors.slice(skip, skip + limit);

    res.json({
      data,
      pagination: {
        page,
        totalPages: totalRecords > 0 ? Math.ceil(totalRecords / limit) : 0,
        totalRecords,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST /inspectors/sync
 * Create missing inspector records for QC users.
 * Only accessible to Manager and Admin
 */
exports.syncInspectors = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const syncResult = await ensureInspectorRecordsForQcUsers({ search });

    res.json({
      message: "Inspector sync completed successfully",
      data: {
        eligible_qc_users: syncResult.eligibleQcUsers,
        created_missing_inspectors: syncResult.createdInspectors,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * GET /inspectors/:id
 * Get inspector by ID
 * Only accessible to Manager and Admin
 */
exports.getInspectorById = async (req, res) => {
  try {
    const inspector = await Inspector.findById(req.params.id)
      .populate("user", "name email role")
      .populate("labels_allotted_by", "name email role")
      .populate("assignedOrders");

    if (!inspector) {
      return res.status(404).json({ message: "Inspector not found" });
    }

    res.json({ data: inspector });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * PATCH /inspectors/:id/allocate-labels
 * Allocate QC labels to an inspector
 * Only accessible to Manager and Admin
 */
exports.allocateLabels = async (req, res) => {
  try {
    const { labels } = req.body;

    // Validate input
    if (!labels || !Array.isArray(labels) || labels.length === 0) {
      return res.status(400).json({ message: "Labels must be a non-empty array of numbers" });
    }

    // Validate that all labels are numbers
    if (!labels.every(label => typeof label === "number")) {
      return res.status(400).json({ message: "All labels must be numbers" });
    }

    const inspector = await Inspector.findById(req.params.id);

    if (!inspector) {
      return res.status(404).json({ message: "Inspector not found" });
    }

    // Check for duplicate labels
    const existingLabels = new Set(inspector.alloted_labels);
    const newLabels = labels.filter(label => !existingLabels.has(label));

    if (newLabels.length === 0) {
      return res.status(400).json({ 
        message: "All provided labels are already allocated to this inspector",
        already_allocated: inspector.alloted_labels
      });
    }

    // Merge with existing labels (avoid duplicates)
    inspector.alloted_labels = [...new Set([...inspector.alloted_labels, ...newLabels])];
    inspector.labels_allotted_by = req.user._id;

    await inspector.save();

    res.json({
      message: `${newLabels.length} label(s) allocated successfully`,
      data: inspector,
      newly_allocated_labels: newLabels,
      total_allocated_labels: inspector.alloted_labels,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/**
 * PATCH /inspectors/transfer-labels
 * Transfer unused QC labels between inspectors
 * Only accessible to Manager and Admin
 */
exports.transferLabels = async (req, res) => {
  try {
    const {
      from_inspector_id: fromInspectorId,
      to_inspector_id: toInspectorId,
      labels,
    } = req.body || {};

    const normalizedLabels = normalizeInspectorLabels(labels);
    if (normalizedLabels.length === 0) {
      return res.status(400).json({
        message: "Labels must be a non-empty array of positive integers",
      });
    }

    if (!fromInspectorId || !toInspectorId) {
      return res.status(400).json({
        message: "Source and target inspectors are required",
      });
    }

    if (String(fromInspectorId) === String(toInspectorId)) {
      return res.status(400).json({
        message: "Source and target inspectors must be different",
      });
    }

    const [sourceInspector, targetInspector] = await Promise.all([
      Inspector.findById(fromInspectorId).populate("user", "name email role"),
      Inspector.findById(toInspectorId).populate("user", "name email role"),
    ]);

    if (!sourceInspector) {
      return res.status(404).json({ message: "Source inspector not found" });
    }

    if (!targetInspector) {
      return res.status(404).json({ message: "Target inspector not found" });
    }

    const sourceAllocated = normalizeInspectorLabels(sourceInspector.alloted_labels);
    const sourceUsed = new Set(normalizeInspectorLabels(sourceInspector.used_labels));
    const targetAllocated = normalizeInspectorLabels(targetInspector.alloted_labels);
    const targetUsed = new Set(normalizeInspectorLabels(targetInspector.used_labels));

    const sourceAllocatedSet = new Set(sourceAllocated);
    const targetAllocatedSet = new Set(targetAllocated);

    const missingFromSource = normalizedLabels.filter(
      (label) => !sourceAllocatedSet.has(label),
    );
    const usedInSource = normalizedLabels.filter((label) => sourceUsed.has(label));
    const alreadyInTarget = normalizedLabels.filter(
      (label) => targetAllocatedSet.has(label) || targetUsed.has(label),
    );

    if (missingFromSource.length > 0) {
      return res.status(400).json({
        message: "Some labels are not allocated to the source inspector",
        labels_not_in_source: missingFromSource,
      });
    }

    if (usedInSource.length > 0) {
      return res.status(400).json({
        message: "Used labels cannot be transferred",
        used_labels: usedInSource,
      });
    }

    if (alreadyInTarget.length > 0) {
      return res.status(400).json({
        message: "Some labels are already assigned to the target inspector",
        target_conflicts: alreadyInTarget,
      });
    }

    const transferSet = new Set(normalizedLabels);
    sourceInspector.alloted_labels = sourceAllocated.filter(
      (label) => !transferSet.has(label),
    );
    targetInspector.alloted_labels = normalizeInspectorLabels([
      ...targetAllocated,
      ...normalizedLabels,
    ]);
    sourceInspector.labels_allotted_by = req.user?._id || sourceInspector.labels_allotted_by;
    targetInspector.labels_allotted_by = req.user?._id || targetInspector.labels_allotted_by;

    await Promise.all([sourceInspector.save(), targetInspector.save()]);

    return res.json({
      message: `${normalizedLabels.length} label(s) transferred successfully`,
      transferred_labels: normalizedLabels,
      data: {
        from_inspector: sourceInspector,
        to_inspector: targetInspector,
      },
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/**
 * PATCH /inspectors/:id/replace-labels
 * Replace all allocated labels for an inspector
 * Only accessible to Manager and Admin
 */
exports.replaceLabels = async (req, res) => {
  try {
    const { labels } = req.body;

    // Validate input
    if (!labels || !Array.isArray(labels) || labels.length === 0) {
      return res.status(400).json({ message: "Labels must be a non-empty array of numbers" });
    }

    // Validate that all labels are numbers
    if (!labels.every(label => typeof label === "number")) {
      return res.status(400).json({ message: "All labels must be numbers" });
    }

    const inspector = await Inspector.findById(req.params.id);

    if (!inspector) {
      return res.status(404).json({ message: "Inspector not found" });
    }

    const oldLabels = inspector.alloted_labels;
    inspector.alloted_labels = [...new Set(labels)]; // Remove duplicates
    inspector.labels_allotted_by = req.user._id;
    inspector.used_labels = []; // Reset used labels when replacing allocation

    await inspector.save();

    res.json({
      message: "Labels replaced successfully",
      data: inspector,
      old_labels: oldLabels,
      new_labels: inspector.alloted_labels,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/**
 * DELETE /inspectors/:id/labels
 * Remove specific labels from an inspector
 * Only accessible to Manager and Admin
 */
exports.removeLabels = async (req, res) => {
  try {
    const { labels } = req.body;

    // Validate input
    if (!labels || !Array.isArray(labels) || labels.length === 0) {
      return res.status(400).json({ message: "Labels must be a non-empty array of numbers" });
    }

    const inspector = await Inspector.findById(req.params.id);

    if (!inspector) {
      return res.status(404).json({ message: "Inspector not found" });
    }

    const labelsToRemove = new Set(labels);
    const removedLabels = [];

    inspector.alloted_labels = inspector.alloted_labels.filter(label => {
      if (labelsToRemove.has(label)) {
        removedLabels.push(label);
        return false;
      }
      return true;
    });

    if (removedLabels.length === 0) {
      return res.status(400).json({ 
        message: "None of the provided labels were found in inspector's allocation",
        allocated_labels: inspector.alloted_labels
      });
    }

    await inspector.save();

    res.json({
      message: `${removedLabels.length} label(s) removed successfully`,
      data: inspector,
      removed_labels: removedLabels,
      remaining_labels: inspector.alloted_labels,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/**
 * GET /inspectors/:id/label-usage
 * Get label usage statistics for an inspector
 * Only accessible to Manager and Admin
 */
exports.getLabelUsageStats = async (req, res) => {
  try {
    const inspector = await Inspector.findById(req.params.id)
      .populate("user", "name email role");

    if (!inspector) {
      return res.status(404).json({ message: "Inspector not found" });
    }

    const allocatedSet = new Set(inspector.alloted_labels);
    const usedSet = new Set(inspector.used_labels);
    const unusedLabels = inspector.alloted_labels.filter(
      label => !usedSet.has(label)
    );

    res.json({
      data: {
        inspector: inspector.user,
        total_allocated: inspector.alloted_labels.length,
        allocated_labels: inspector.alloted_labels,
        total_used: inspector.used_labels.length,
        used_labels: inspector.used_labels,
        unused_labels: unusedLabels,
        usage_percentage: inspector.alloted_labels.length > 0 
          ? ((inspector.used_labels.length / inspector.alloted_labels.length) * 100).toFixed(2)
          : 0,
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

