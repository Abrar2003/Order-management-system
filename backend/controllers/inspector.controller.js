const Inspector = require("../models/inspector.model");
const User = require("../models/user.model");
const mongoose = require("mongoose");

/**
 * GET /inspectors
 * Get all inspectors with pagination
 * Only accessible to Manager and Admin
 */
exports.getAllInspectors = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const skip = (page - 1) * limit;

    const matchStage = {};

    // 🔍 Search by inspector name or email
    if (search) {
      matchStage.$or = [
        { "user.name": { $regex: search, $options: "i" } },
        { "user.email": { $regex: search, $options: "i" } },
      ];
    }

    const pipeline = [
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      { $match: matchStage },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: Number(limit) },
    ];

    const data = await Inspector.aggregate(pipeline);

    const countPipeline = pipeline.filter(
      (stage) => !stage.$skip && !stage.$limit && !stage.$sort
    );

    const totalRecords = (await Inspector.aggregate(countPipeline)).length;

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
