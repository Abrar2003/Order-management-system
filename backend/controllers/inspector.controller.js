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

const parseRequestedInspectorLabels = (labels = []) => {
  if (!Array.isArray(labels) || labels.length === 0) {
    return {
      labels: [],
      error: "Labels must be a non-empty array of positive integers",
    };
  }

  const hasInvalidLabel = labels.some(
    (label) => !Number.isInteger(Number(label)) || Number(label) <= 0,
  );
  if (hasInvalidLabel) {
    return {
      labels: [],
      error: "All labels must be positive integers",
    };
  }

  return {
    labels: normalizeInspectorLabels(labels),
    error: "",
  };
};

const getInspectorLabelState = (inspector = {}) => ({
  allocated: normalizeInspectorLabels(inspector?.alloted_labels),
  used: normalizeInspectorLabels(inspector?.used_labels),
  rejected: normalizeInspectorLabels(inspector?.rejected_labels),
});

const collectGlobalInspectorLabelSets = async ({ excludeInspectorIds = [] } = {}) => {
  const excludedIdSet = new Set(
    (Array.isArray(excludeInspectorIds) ? excludeInspectorIds : [excludeInspectorIds])
      .filter(Boolean)
      .map((id) => String(id)),
  );
  const inspectors = await Inspector.find({})
    .select("_id alloted_labels used_labels rejected_labels")
    .lean();

  const allocated = new Set();
  const used = new Set();
  const rejected = new Set();

  inspectors.forEach((inspector) => {
    const inspectorId = String(inspector?._id || "");
    if (excludedIdSet.has(inspectorId)) return;

    const labelState = getInspectorLabelState(inspector);
    labelState.allocated.forEach((label) => allocated.add(label));
    labelState.used.forEach((label) => used.add(label));
    labelState.rejected.forEach((label) => rejected.add(label));
  });

  return { allocated, used, rejected };
};

const formatLabelPreview = (labels = [], limit = 10) => {
  const normalized = normalizeInspectorLabels(labels);
  if (normalized.length === 0) return "";

  const preview = normalized.slice(0, limit).join(", ");
  return normalized.length > limit ? `${preview}...` : preview;
};

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
            rejected_labels: [],
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

const buildInspectorOption = (inspector = {}) => {
  const inspectorId = String(inspector?._id || "").trim();
  const displayName = String(
    inspector?.user?.name || inspector?.user?.email || inspectorId,
  ).trim();

  return {
    id: inspectorId,
    name: displayName,
    email: String(inspector?.user?.email || "").trim(),
  };
};

exports.getInspectorOptions = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
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

    const data = Array.from(inspectorByUser.values())
      .map((inspector) => buildInspectorOption(inspector))
      .filter((option) => option.id && option.name)
      .sort((left, right) => left.name.localeCompare(right.name));

    return res.json({ data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
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
    const { labels: normalizedLabels, error } = parseRequestedInspectorLabels(
      req.body?.labels,
    );
    if (error) {
      return res.status(400).json({ message: error });
    }

    const inspector = await Inspector.findById(req.params.id);

    if (!inspector) {
      return res.status(404).json({ message: "Inspector not found" });
    }

    const {
      allocated: allocatedLabels,
      used: usedLabels,
      rejected: rejectedLabels,
    } = getInspectorLabelState(inspector);
    const existingLabels = new Set(allocatedLabels);
    const usedSet = new Set(usedLabels);
    const rejectedSet = new Set(rejectedLabels);

    const ownUsedConflicts = normalizedLabels.filter((label) => usedSet.has(label));
    if (ownUsedConflicts.length > 0) {
      return res.status(400).json({
        message: `Used labels cannot be reallocated: ${formatLabelPreview(ownUsedConflicts)}`,
        used_labels: ownUsedConflicts,
      });
    }

    const ownRejectedConflicts = normalizedLabels.filter((label) => rejectedSet.has(label));
    if (ownRejectedConflicts.length > 0) {
      return res.status(400).json({
        message: `Rejected labels cannot be reallocated: ${formatLabelPreview(ownRejectedConflicts)}`,
        rejected_labels: ownRejectedConflicts,
      });
    }

    const globalLabelSets = await collectGlobalInspectorLabelSets({
      excludeInspectorIds: [req.params.id],
    });
    const allocatedElsewhere = normalizedLabels.filter((label) =>
      globalLabelSets.allocated.has(label),
    );
    if (allocatedElsewhere.length > 0) {
      return res.status(400).json({
        message: `Some labels are already allocated to another inspector: ${formatLabelPreview(allocatedElsewhere)}`,
        allocated_elsewhere: allocatedElsewhere,
      });
    }

    const usedElsewhere = normalizedLabels.filter((label) =>
      globalLabelSets.used.has(label),
    );
    if (usedElsewhere.length > 0) {
      return res.status(400).json({
        message: `Some labels are already used and cannot be reused: ${formatLabelPreview(usedElsewhere)}`,
        used_elsewhere: usedElsewhere,
      });
    }

    const rejectedElsewhere = normalizedLabels.filter((label) =>
      globalLabelSets.rejected.has(label),
    );
    if (rejectedElsewhere.length > 0) {
      return res.status(400).json({
        message: `Rejected labels cannot be allocated again: ${formatLabelPreview(rejectedElsewhere)}`,
        rejected_elsewhere: rejectedElsewhere,
      });
    }

    const newLabels = normalizedLabels.filter((label) => !existingLabels.has(label));

    if (newLabels.length === 0) {
      return res.status(400).json({
        message: "All provided labels are already allocated to this inspector",
        already_allocated: allocatedLabels,
      });
    }

    inspector.alloted_labels = normalizeInspectorLabels([
      ...allocatedLabels,
      ...newLabels,
    ]);
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

    const {
      labels: normalizedLabels,
      error,
    } = parseRequestedInspectorLabels(labels);
    if (error) {
      return res.status(400).json({ message: error });
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

    const {
      allocated: sourceAllocated,
      used: sourceUsedLabels,
      rejected: sourceRejectedLabels,
    } = getInspectorLabelState(sourceInspector);
    const {
      allocated: targetAllocated,
      used: targetUsedLabels,
      rejected: targetRejectedLabels,
    } = getInspectorLabelState(targetInspector);
    const sourceUsed = new Set(sourceUsedLabels);
    const sourceRejected = new Set(sourceRejectedLabels);
    const targetUsed = new Set(targetUsedLabels);
    const targetRejected = new Set(targetRejectedLabels);

    const sourceAllocatedSet = new Set(sourceAllocated);
    const targetAllocatedSet = new Set(targetAllocated);

    const missingFromSource = normalizedLabels.filter(
      (label) => !sourceAllocatedSet.has(label),
    );
    const usedInSource = normalizedLabels.filter((label) => sourceUsed.has(label));
    const alreadyInTarget = normalizedLabels.filter(
      (label) => (
        targetAllocatedSet.has(label)
        || targetUsed.has(label)
        || targetRejected.has(label)
      ),
    );
    const rejectedInSource = normalizedLabels.filter((label) =>
      sourceRejected.has(label),
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

    if (rejectedInSource.length > 0) {
      return res.status(400).json({
        message: `Rejected labels cannot be transferred: ${formatLabelPreview(rejectedInSource)}`,
        rejected_labels: rejectedInSource,
      });
    }

    if (alreadyInTarget.length > 0) {
      return res.status(400).json({
        message: "Some labels are already assigned to the target inspector",
        target_conflicts: alreadyInTarget,
      });
    }

    const globalLabelSets = await collectGlobalInspectorLabelSets({
      excludeInspectorIds: [fromInspectorId, toInspectorId],
    });
    const rejectedElsewhere = normalizedLabels.filter((label) =>
      globalLabelSets.rejected.has(label),
    );
    if (rejectedElsewhere.length > 0) {
      return res.status(400).json({
        message: `Rejected labels cannot be transferred: ${formatLabelPreview(rejectedElsewhere)}`,
        rejected_elsewhere: rejectedElsewhere,
      });
    }

    const usedElsewhere = normalizedLabels.filter((label) =>
      globalLabelSets.used.has(label),
    );
    if (usedElsewhere.length > 0) {
      return res.status(400).json({
        message: `Some labels are already used by another inspector: ${formatLabelPreview(usedElsewhere)}`,
        used_elsewhere: usedElsewhere,
      });
    }

    const allocatedElsewhere = normalizedLabels.filter((label) =>
      globalLabelSets.allocated.has(label),
    );
    if (allocatedElsewhere.length > 0) {
      return res.status(400).json({
        message: `Some labels are already allocated to another inspector: ${formatLabelPreview(allocatedElsewhere)}`,
        allocated_elsewhere: allocatedElsewhere,
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
 * PATCH /inspectors/:id/reject-labels
 * Permanently reject unused QC labels for an inspector
 * Only accessible to Manager and Admin
 */
exports.rejectLabels = async (req, res) => {
  try {
    const { labels: normalizedLabels, error } = parseRequestedInspectorLabels(
      req.body?.labels,
    );
    if (error) {
      return res.status(400).json({ message: error });
    }

    const inspector = await Inspector.findById(req.params.id)
      .populate("user", "name email role");

    if (!inspector) {
      return res.status(404).json({ message: "Inspector not found" });
    }

    const {
      allocated: allocatedLabels,
      used: usedLabels,
      rejected: rejectedLabels,
    } = getInspectorLabelState(inspector);
    const allocatedSet = new Set(allocatedLabels);
    const usedSet = new Set(usedLabels);
    const rejectedSet = new Set(rejectedLabels);

    const alreadyRejected = normalizedLabels.filter((label) =>
      rejectedSet.has(label),
    );
    if (alreadyRejected.length > 0) {
      return res.status(400).json({
        message: `Some labels are already rejected: ${formatLabelPreview(alreadyRejected)}`,
        rejected_labels: alreadyRejected,
      });
    }

    const missingFromAllocation = normalizedLabels.filter(
      (label) => !allocatedSet.has(label),
    );
    if (missingFromAllocation.length > 0) {
      return res.status(400).json({
        message: `Some labels are not allocated to the selected inspector: ${formatLabelPreview(missingFromAllocation)}`,
        labels_not_allocated: missingFromAllocation,
      });
    }

    const usedInInspector = normalizedLabels.filter((label) =>
      usedSet.has(label),
    );
    if (usedInInspector.length > 0) {
      return res.status(400).json({
        message: `Used labels cannot be rejected: ${formatLabelPreview(usedInInspector)}`,
        used_labels: usedInInspector,
      });
    }

    const rejectSet = new Set(normalizedLabels);
    inspector.alloted_labels = allocatedLabels.filter(
      (label) => !rejectSet.has(label),
    );
    inspector.rejected_labels = normalizeInspectorLabels([
      ...rejectedLabels,
      ...normalizedLabels,
    ]);
    inspector.labels_allotted_by =
      req.user?._id || inspector.labels_allotted_by;

    await inspector.save();

    return res.json({
      message: `${normalizedLabels.length} label(s) rejected successfully`,
      rejected_labels: normalizedLabels,
      data: inspector,
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
    const { labels: normalizedLabels, error } = parseRequestedInspectorLabels(
      req.body?.labels,
    );
    if (error) {
      return res.status(400).json({ message: error });
    }

    const inspector = await Inspector.findById(req.params.id);

    if (!inspector) {
      return res.status(404).json({ message: "Inspector not found" });
    }

    const {
      allocated: oldLabels,
      rejected: rejectedLabels,
    } = getInspectorLabelState(inspector);
    const rejectedSet = new Set(rejectedLabels);
    const rejectedConflicts = normalizedLabels.filter((label) =>
      rejectedSet.has(label),
    );
    if (rejectedConflicts.length > 0) {
      return res.status(400).json({
        message: `Rejected labels cannot be allocated again: ${formatLabelPreview(rejectedConflicts)}`,
        rejected_labels: rejectedConflicts,
      });
    }

    const globalLabelSets = await collectGlobalInspectorLabelSets({
      excludeInspectorIds: [req.params.id],
    });
    const allocatedElsewhere = normalizedLabels.filter((label) =>
      globalLabelSets.allocated.has(label),
    );
    if (allocatedElsewhere.length > 0) {
      return res.status(400).json({
        message: `Some labels are already allocated to another inspector: ${formatLabelPreview(allocatedElsewhere)}`,
        allocated_elsewhere: allocatedElsewhere,
      });
    }

    const usedElsewhere = normalizedLabels.filter((label) =>
      globalLabelSets.used.has(label),
    );
    if (usedElsewhere.length > 0) {
      return res.status(400).json({
        message: `Some labels are already used and cannot be reused: ${formatLabelPreview(usedElsewhere)}`,
        used_elsewhere: usedElsewhere,
      });
    }

    const rejectedElsewhere = normalizedLabels.filter((label) =>
      globalLabelSets.rejected.has(label),
    );
    if (rejectedElsewhere.length > 0) {
      return res.status(400).json({
        message: `Rejected labels cannot be allocated again: ${formatLabelPreview(rejectedElsewhere)}`,
        rejected_elsewhere: rejectedElsewhere,
      });
    }

    inspector.alloted_labels = normalizedLabels;
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

    const {
      allocated: allocatedLabels,
      used: usedLabels,
      rejected: rejectedLabels,
    } = getInspectorLabelState(inspector);
    const allocatedSet = new Set(allocatedLabels);
    const usedSet = new Set(usedLabels);
    const unusedLabels = allocatedLabels.filter(
      (label) => !usedSet.has(label),
    );

    res.json({
      data: {
        inspector: inspector.user,
        total_allocated: allocatedLabels.length,
        allocated_labels: allocatedLabels,
        total_used: usedLabels.length,
        used_labels: usedLabels,
        total_rejected: rejectedLabels.length,
        rejected_labels: rejectedLabels,
        unused_labels: unusedLabels,
        usage_percentage: allocatedLabels.length > 0
          ? ((usedLabels.length / allocatedLabels.length) * 100).toFixed(2)
          : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
