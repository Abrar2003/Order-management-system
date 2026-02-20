const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");

const Order = require("../models/order.model")
const mongoose = require("mongoose");
const { upsertItemFromQc } = require("../services/itemSync");

const normalizeLabels = (labels = []) => {
  if (!Array.isArray(labels)) return [];
  const numericLabels = labels
    .map((label) => Number(label))
    .filter((label) => Number.isFinite(label));
  return [...new Set(numericLabels)].sort((a, b) => a - b);
};

/**
 * GET /qclist
 * Fetch all QC records (pagination optional)
 */
const escapeRegex = (value = "") =>
  String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toDateInputValue = (value = new Date()) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const offsetMs = parsed.getTimezoneOffset() * 60000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 10);
};

const resolveReportDate = (value) => {
  const asString = String(value || "").trim();
  if (!asString) return toDateInputValue(new Date());
  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;
  return toDateInputValue(asString);
};

const toSortableTimestamp = (value) => {
  const asString = String(value || "").trim();
  if (!asString) return 0;

  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    const parsed = new Date(`${asString}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(asString)) {
    const parts = asString.split(/[/-]/);
    const parsed = new Date(
      Date.UTC(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])),
    );
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const buildStringDateToDateExpression = (fieldPath) => ({
  $let: {
    vars: {
      rawDate: {
        $trim: {
          input: { $toString: { $ifNull: [fieldPath, ""] } },
        },
      },
    },
    in: {
      $switch: {
        branches: [
          {
            case: {
              $regexMatch: {
                input: "$$rawDate",
                regex: /^\d{4}-\d{2}-\d{2}$/,
              },
            },
            then: {
              $dateFromString: {
                dateString: "$$rawDate",
                format: "%Y-%m-%d",
                onError: null,
                onNull: null,
              },
            },
          },
          {
            case: {
              $regexMatch: {
                input: "$$rawDate",
                regex: /^\d{2}\/\d{2}\/\d{4}$/,
              },
            },
            then: {
              $dateFromString: {
                dateString: "$$rawDate",
                format: "%d/%m/%Y",
                onError: null,
                onNull: null,
              },
            },
          },
          {
            case: {
              $regexMatch: {
                input: "$$rawDate",
                regex: /^\d{2}-\d{2}-\d{4}$/,
              },
            },
            then: {
              $dateFromString: {
                dateString: "$$rawDate",
                format: "%d-%m-%Y",
                onError: null,
                onNull: null,
              },
            },
          },
        ],
        default: {
          $convert: {
            input: "$$rawDate",
            to: "date",
            onError: null,
            onNull: null,
          },
        },
      },
    },
  },
});

const requestDateToDateExpression = buildStringDateToDateExpression("$request_date");
const inspectionDateToDateExpression = buildStringDateToDateExpression("$inspection_date");

const normalizeDistinctValues = (values = []) =>
  [...new Set(
    values
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));

const buildQcListMatch = ({
  inspector = "",
  vendor = "",
  brand = "",
  order = "",
  search = "",
  from = "",
  to = "",
  includeVendor = true,
  includeOrder = true,
  includeSearch = true,
} = {}) => {
  const match = {};

  const inspectorId = String(inspector || "").trim();
  const vendorValue = String(vendor || "").trim();
  const brandValue = String(brand || "").trim();
  const orderValue = String(order || "").trim();
  const searchValue = String(search || "").trim();
  const fromDate = String(from || "").trim();
  const toDate = String(to || "").trim();

  if (inspectorId) {
    match.inspector = new mongoose.Types.ObjectId(inspectorId);
  }

  if (includeVendor && vendorValue) {
    match["order_meta.vendor"] = vendorValue;
  }

  if (brandValue) {
    match["order_meta.brand"] = brandValue;
  }

  if (includeOrder && orderValue) {
    const q = escapeRegex(orderValue);
    match["order_meta.order_id"] = { $regex: `^${q}`, $options: "i" };
  }

  if (includeSearch && searchValue) {
    const q = escapeRegex(searchValue);
    match["item.item_code"] = { $regex: q, $options: "i" };
  }

  if (fromDate || toDate) {
    match.request_date = {};
    if (fromDate) match.request_date.$gte = fromDate;
    if (toDate) match.request_date.$lte = toDate;
  }

  return match;
};

exports.getQCList = async (req, res) => {

  await QC.createIndexes();
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      inspector = "",
      vendor = "",
      brand = "",
      order = "",
      from = "",
      to = "",
      sort = "-request_date",
    } = req.query;
    const inspectorId = String(inspector || "").trim();

    if (inspectorId && !mongoose.Types.ObjectId.isValid(inspectorId)) {
      return res.status(400).json({ message: "Invalid inspector id" });
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;
    const filterInput = {
      inspector: inspectorId,
      vendor,
      brand,
      order,
      search,
      from,
      to,
    };
    const match = buildQcListMatch(filterInput);

    let sortStage = { request_date_sort_key: -1, createdAt: -1 };
    if (sort === "request_date") sortStage = { request_date_sort_key: 1, createdAt: 1 };
    if (sort === "-request_date") sortStage = { request_date_sort_key: -1, createdAt: -1 };
    if (sort === "createdAt") sortStage = { createdAt: 1 };
    if (sort === "-createdAt") sortStage = { createdAt: -1 };

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          request_date_sort_key: {
            $ifNull: [requestDateToDateExpression, "$createdAt"],
          },
        },
      },
      { $sort: sortStage },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limitNum },

            {
              $lookup: {
                from: "users",
                localField: "inspector",
                foreignField: "_id",
                as: "inspector",
              },
            },
            { $unwind: { path: "$inspector", preserveNullAndEmptyArrays: true } },

            {
              $lookup: {
                from: "orders",
                localField: "order",
                foreignField: "_id",
                as: "order",
              },
            },
            { $unwind: { path: "$order", preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: "inspections",
                let: { qcId: "$_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: { $eq: ["$qc", "$$qcId"] },
                    },
                  },
                  {
                    $addFields: {
                      inspection_date_sort_key: {
                        $ifNull: [inspectionDateToDateExpression, "$createdAt"],
                      },
                    },
                  },
                  { $sort: { inspection_date_sort_key: -1, createdAt: -1 } },
                  { $limit: 1 },
                  {
                    $project: {
                      inspection_date_sort_key: 0,
                      __v: 0,
                    },
                  },
                ],
                as: "last_inspection",
              },
            },
            {
              $addFields: {
                last_inspection: { $arrayElemAt: ["$last_inspection", 0] },
              },
            },
            { $project: { request_date_sort_key: 0 } },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const [result, vendorsRaw, ordersRaw, itemCodesRaw] = await Promise.all([
      QC.aggregate(pipeline).allowDiskUse(true),
      QC.distinct(
        "order_meta.vendor",
        buildQcListMatch({ ...filterInput, includeVendor: false }),
      ),
      QC.distinct(
        "order_meta.order_id",
        buildQcListMatch({ ...filterInput, includeOrder: false }),
      ),
      QC.distinct(
        "item.item_code",
        buildQcListMatch({ ...filterInput, includeSearch: false }),
      ),
    ]);

    const data = result?.[0]?.data || [];
    const totalRecords = result?.[0]?.totalCount?.[0]?.count || 0;

    res.json({
      data,
      pagination: {
        page: pageNum,
        totalPages: Math.ceil(totalRecords / limitNum) || 1,
        totalRecords,
      },
      filters: {
        vendors: normalizeDistinctValues(vendorsRaw),
        orders: normalizeDistinctValues(ordersRaw),
        item_codes: normalizeDistinctValues(itemCodesRaw),
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

    const inspectorId = String(inspector || "").trim();
    if (!inspectorId) {
      return res.status(400).json({ message: "inspector is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(inspectorId)) {
      return res.status(400).json({ message: "invalid inspector id" });
    }

    const existingQC = await QC.findOne({
      order: order,
      "item.item_code": item.item_code,
    });

    const clientDemand = Number(quantities?.client_demand);
    const quantityRequested = Number(
      quantities?.quantity_requested ?? quantities?.vendor_provision
    );
    const hasVendorProvisionInput =
      quantities?.vendor_provision !== undefined &&
      quantities?.vendor_provision !== null &&
      quantities?.vendor_provision !== "";
    const vendorProvision =
      !hasVendorProvisionInput
        ? 0
        : Number(quantities?.vendor_provision);

    if (
      Number.isNaN(clientDemand) ||
      Number.isNaN(quantityRequested) ||
      Number.isNaN(vendorProvision)
    ) {
      return res.status(400).json({
        message:
          "client demand, quantity requested and vendor provision must be valid numbers",
      });
    }

    if (clientDemand < 0 || quantityRequested < 0 || vendorProvision < 0) {
      return res.status(400).json({
        message: "Quantity values must be valid non-negative numbers",
      });
    }

    if (quantityRequested > clientDemand) {
      return res.status(400).json({
        message: "quantity requested can't be greater than client demand",
      });
    }

    if (hasVendorProvisionInput && vendorProvision > quantityRequested) {
      return res.status(400).json({
        message: "vendor provision can't be greater than quantity requested",
      });
    }

    const requestDateValue = String(request_date || "").trim();
    if (!requestDateValue) {
      return res.status(400).json({ message: "request date is required" });
    }

    const parsedRequestDate = /^\d{4}-\d{2}-\d{2}$/.test(requestDateValue)
      ? new Date(`${requestDateValue}T00:00:00`)
      : new Date(requestDateValue);

    if (Number.isNaN(parsedRequestDate.getTime())) {
      return res.status(400).json({ message: "request date must be a valid date" });
    }

    const requestDateDay = new Date(parsedRequestDate);
    requestDateDay.setHours(0, 0, 0, 0);

    const todayDay = new Date();
    todayDay.setHours(0, 0, 0, 0);

    const isBackdatedRequest = requestDateDay < todayDay;

    if (isBackdatedRequest && req.user.role !== "admin") {
      return res.status(403).json({
        message: "Only admin can align backdated QC requests",
      });
    }

    if (existingQC) {

      if (clientDemand < existingQC.quantities.qc_passed) {
        return res.status(400).json({
          message: "client demand cannot be less than already passed quantity",
        });
      }

      const existingPendingRaw = Number(
        existingQC?.quantities?.pending ??
          ((existingQC?.quantities?.client_demand || 0) -
            (existingQC?.quantities?.qc_passed || 0)),
      );
      const existingPendingQuantity = Number.isFinite(existingPendingRaw)
        ? Math.max(0, existingPendingRaw)
        : 0;

      if (quantityRequested > existingPendingQuantity) {
        return res.status(400).json({
          message: "quantity requested cannot be greater than pending quantity",
        });
      }

      if (hasVendorProvisionInput && vendorProvision < existingQC.quantities.qc_passed) {
        return res.status(400).json({
          message: "vendor provision cannot be less than already passed quantity",
        });
      }

      const totalOffered =
        (hasVendorProvisionInput
          ? vendorProvision
          : (existingQC.quantities.vendor_provision || 0));

      if ((existingQC.quantities.qc_checked || 0) > totalOffered) {
        return res.status(400).json({
          message: "vendor provision cannot be less than already checked quantity",
        });
      }

      // const dateOnly = new Date(req.body.request_date)

      existingQC.inspector = inspectorId;
      existingQC.request_date = requestDateValue;
      existingQC.item = item;
      existingQC.quantities.client_demand = clientDemand;
      existingQC.quantities.quantity_requested = quantityRequested;
      if (hasVendorProvisionInput) {
        existingQC.quantities.vendor_provision = vendorProvision;
      }
      existingQC.quantities.pending =
        clientDemand - (existingQC.quantities.qc_passed || 0);

      if (remarks !== undefined) {
        existingQC.remarks = remarks;
      }

      existingQC.request_history = existingQC.request_history || [];
      existingQC.request_history.push({
        request_date: requestDateValue,
        quantity_requested: quantityRequested,
        inspector: inspectorId,
        remarks: remarks || "",
        createdBy: req.user._id,
      });

      await existingQC.save();

      const orderRecord = await Order.findById(order);
      if (orderRecord) {
        const passedQty = Number(existingQC.quantities?.qc_passed || 0);
        const clientDemandQty = Number(existingQC.quantities?.client_demand || 0);
        orderRecord.status =
          clientDemandQty > 0 && passedQty >= clientDemandQty
            ? "Inspection Done"
            : "Under Inspection";
        orderRecord.qc_record = existingQC._id;
        await orderRecord.save();
      }

      try {
        await upsertItemFromQc(existingQC);
      } catch (itemSyncError) {
        console.error("Item sync after QC re-align failed:", {
          qcId: existingQC?._id,
          error: itemSyncError?.message || String(itemSyncError),
        });
      }

      return res.status(200).json({
        message: "QC re-aligned successfully",
        data: existingQC,
      });
    }

    const orderRecord = await Order.findById(order);

    const qc = await QC.create({
      order, 
      item,
      inspector: inspectorId,
      order_meta: {
        order_id: orderRecord.order_id,
        vendor: orderRecord.vendor,
        brand: orderRecord.brand
      },
      request_date: requestDateValue,
      last_inspected_date: requestDateValue,
      quantities: {
        client_demand: clientDemand,
        quantity_requested: quantityRequested,
        vendor_provision: hasVendorProvisionInput ? vendorProvision : 0,
        qc_checked: 0,
        qc_passed: 0,
        pending: clientDemand,
      },
      request_history: [
        {
          request_date: requestDateValue,
          quantity_requested: quantityRequested,
          inspector: inspectorId,
          remarks: remarks || "",
          createdBy: req.user._id,
        },
      ],
      remarks,
      createdBy: req.user._id,
    });


    orderRecord.status = "Under Inspection";
    orderRecord.qc_record = qc._id;

    await orderRecord.save();

    try {
      await upsertItemFromQc(qc);
    } catch (itemSyncError) {
      console.error("Item sync after QC align failed:", {
        qcId: qc?._id,
        error: itemSyncError?.message || String(itemSyncError),
      });
    }

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
 * QC inspector updates checked / passed with allocated labels
 */
exports.updateQC = async (req, res) => {
  try {
    const {
      qc_checked,
      qc_passed,
      remarks,
      labels,
      label_ranges,
      inspector,
      vendor_provision,
      barcode,
      packed_size,
      finishing,
      branding,
      last_inspected_date,
      CBM_top,
      CBM_bottom,
      CBM,
    } = req.body;

      const qc = await QC.findById(req.params.id)
        .populate("inspector")
        .populate("order", "status");

      if (!qc) {
        return res.status(404).json({ message: "QC record not found" });
      }

      const isAdmin = req.user.role === "admin";
      const isInspectionDone = qc?.order?.status === "Inspection Done";

      if (!isAdmin && isInspectionDone) {
        return res.status(403).json({
          message: "Only admin can update this QC record after inspection is done",
        });
      }

      const existingInspectorId = qc.inspector?._id
        ? qc.inspector._id.toString()
        : (qc.inspector ? qc.inspector.toString() : null);
      const requestedInspectorId =
        inspector !== undefined && inspector !== null && String(inspector).trim() !== ""
          ? String(inspector).trim()
          : null;

      const hasStartedInspection =
        (qc.quantities?.qc_checked || 0) > 0 ||
        (Array.isArray(qc.inspection_record) && qc.inspection_record.length > 0);

      if (!isAdmin) {
        const currentUserId = req.user._id.toString();
        const isAssignedToCurrentUser =
          existingInspectorId && existingInspectorId === currentUserId;
        const isClaimingSelf = requestedInspectorId === currentUserId;

        if (!isAssignedToCurrentUser) {
          if (hasStartedInspection || !isClaimingSelf) {
            return res.status(403).json({
              message: "You are not authorized to update this QC record",
            });
          }
        }

        if (requestedInspectorId && requestedInspectorId !== currentUserId) {
          return res.status(403).json({
            message: "QC can only assign themselves",
          });
        }
      }

      if (requestedInspectorId) {
        if (!mongoose.Types.ObjectId.isValid(requestedInspectorId)) {
          return res.status(400).json({ message: "Invalid inspector id" });
        }
        qc.inspector = requestedInspectorId;
      }

      /* ────────────────────────
         📐 LBH → CBM HELPERS
      ──────────────────────── */

      const hasCbmUpdate = CBM !== undefined || CBM_top !== undefined || CBM_bottom !== undefined;

      const normalizeCbmValue = (value, fallbackValue) => {
        if (value === undefined) return fallbackValue;
        if (value === null || value === "") return "0";
        return String(value);
      };

      if (hasCbmUpdate) {
        qc.cbm = {
          top: normalizeCbmValue(CBM_top, qc.cbm?.top ?? "0"),
          bottom: normalizeCbmValue(CBM_bottom, qc.cbm?.bottom ?? "0"),
          total: normalizeCbmValue(CBM, qc.cbm?.total ?? "0"),
        };
      }

      if (last_inspected_date !== undefined) {
        qc.last_inspected_date = last_inspected_date;
      }

      /* ────────────────────────
         🔢 BARCODE
      ──────────────────────── */

      if (barcode !== undefined) {
        if (qc.barcode > 0 && Number(barcode) !== qc.barcode) {
          return res.status(400).json({ message: "barcode can only be set once" });
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
      const addProvision = Number(vendor_provision || 0);

      if ([addChecked, addPassed, addProvision].some((v) => v < 0 || Number.isNaN(v))) {
        return res.status(400).json({
          message: "Quantity values must be valid non-negative numbers",
        });
      }

      const hasLabelRangePayload =
        Array.isArray(label_ranges) &&
        label_ranges.some(
          (range) =>
            range &&
            (String(range.start ?? "").trim() !== "" ||
              String(range.end ?? "").trim() !== ""),
        );

      // If user is updating passed quantity or labels, they must provide checked in same visit
      if (
        (addPassed ||
          (Array.isArray(labels) && labels.length) ||
          hasLabelRangePayload) &&
        addChecked <= 0
      ) {
        return res.status(400).json({
          message: "qc_checked must be greater than 0 when updating quantities or labels",
        });
      }

      const nextVendorProvision = qc.quantities.vendor_provision + addProvision;

      const nextChecked = qc.quantities.qc_checked + addChecked;
      const nextPassed = qc.quantities.qc_passed + addPassed;

      if (nextVendorProvision < 0) {
        return res.status(400).json({ message: "offered quantity cannot be negative" });
      }

      const quantityRequestedCap = Number(
        qc.quantities.quantity_requested > 0
          ? qc.quantities.quantity_requested
          : (qc.quantities.client_demand ?? 0)
      );

      const parsedPendingQuantityLimit = Number(
        qc.quantities?.pending ??
          ((qc.quantities?.client_demand || 0) - (qc.quantities?.qc_passed || 0))
      );
      const pendingQuantityLimit = Number.isFinite(parsedPendingQuantityLimit)
        ? Math.max(0, parsedPendingQuantityLimit)
        : 0;

      if (hasStartedInspection) {
        if (addProvision > pendingQuantityLimit) {
          return res.status(400).json({
            message: "offered quantity cannot exceed pending quantity",
          });
        }
      } else if (
        Number.isFinite(quantityRequestedCap) &&
        quantityRequestedCap >= 0 &&
        nextVendorProvision > quantityRequestedCap
      ) {
        return res.status(400).json({
          message: "offered quantity cannot exceed quantity requested",
        });
      }

      if (nextPassed > nextChecked) {
        return res.status(400).json({
          message: "qc_passed cannot exceed qc_checked",
        });
      }

      qc.quantities.vendor_provision = nextVendorProvision;
      qc.quantities.qc_checked = nextChecked;
      qc.quantities.qc_passed = nextPassed;
      qc.quantities.pending = qc.quantities.client_demand - qc.quantities.qc_passed;

      /* ────────────────────────
         🏷️ LABELS (UNCHANGED LOGIC)
      ──────────────────────── */

      const buildLabelsFromRanges = (ranges = []) => {
        const normalizedRanges = [];
        const generatedLabels = [];

        for (let i = 0; i < ranges.length; i++) {
          const range = ranges[i] || {};
          const hasStart = String(range.start ?? "").trim() !== "";
          const hasEnd = String(range.end ?? "").trim() !== "";

          if (!hasStart && !hasEnd) continue;
          if (!hasStart || !hasEnd) {
            throw new Error(
              `Both start and end are required for label range ${i + 1}`,
            );
          }

          const start = Number(range.start);
          const end = Number(range.end);
          if (!Number.isInteger(start) || !Number.isInteger(end)) {
            throw new Error(`Label range ${i + 1} must contain integer values`);
          }
          if (start < 0 || end < 0) {
            throw new Error(
              `Label range ${i + 1} must contain non-negative values`,
            );
          }
          if (start > end) {
            throw new Error(
              `Start cannot be greater than end in label range ${i + 1}`,
            );
          }

          normalizedRanges.push({ start, end });
          for (let label = start; label <= end; label++) {
            generatedLabels.push(label);
          }
        }

        return { generatedLabels, normalizedRanges };
      };

      let labelsAddedThisVisit = [];
      let labelRangesUsedThisVisit = [];
      const hasLabelsPayload =
        (Array.isArray(labels) && labels.length > 0) || hasLabelRangePayload;

      if (hasLabelsPayload) {
        const Inspector = require("../models/inspector.model");
        const inspectionInspectorUserId = qc.inspector?._id
          ? qc.inspector._id
          : qc.inspector;
        const inspector = await Inspector.findOne({ user: inspectionInspectorUserId });

        if (!inspector) {
          return res.status(404).json({ message: "Inspector record not found" });
        }

        const directLabels = Array.isArray(labels) ? labels : [];
        const parsedDirectLabels = directLabels.map(Number);
        if (
          parsedDirectLabels.some(
            (label) => !Number.isInteger(label) || label < 0,
          )
        ) {
          return res.status(400).json({
            message: "All labels must be non-negative integers",
          });
        }

        let generatedFromRanges = [];
        if (Array.isArray(label_ranges)) {
          const rangeResult = buildLabelsFromRanges(label_ranges);
          generatedFromRanges = rangeResult.generatedLabels;
          labelRangesUsedThisVisit = rangeResult.normalizedRanges;
        }

        // If client sends explicit labels, treat them as authoritative.
        // Otherwise derive from ranges.
        const labelsForUpdate =
          parsedDirectLabels.length > 0 ? parsedDirectLabels : generatedFromRanges;
        const uniqueIncoming = [...new Set(labelsForUpdate)];
        const existingSet = new Set((qc.labels || []).map(Number));
        const incomingNew = uniqueIncoming.filter((label) => !existingSet.has(label));

        const totalLabels = existingSet.size + incomingNew.length;
        if (totalLabels > nextPassed) {
          return res.status(400).json({
            message: "total labels cannot exceed total qc_passed",
          });
        }

        qc.labels = [...new Set([...(qc.labels || []), ...incomingNew])];

        inspector.used_labels = [
          ...new Set([...(inspector.used_labels || []), ...incomingNew]),
        ];

        await inspector.save();

        labelsAddedThisVisit = incomingNew;
      }

      if (remarks) qc.remarks = remarks;

      /* ────────────────────────
         🧾 CREATE INSPECTION RECORD (NEW)
         We create a record only when there's a "visit update"
      ──────────────────────── */

      const isVisitUpdate =
        addChecked > 0 ||
        addPassed > 0 ||
        addProvision > 0 ||
        (labelsAddedThisVisit && labelsAddedThisVisit.length > 0);

      if (isVisitUpdate) {
        const vendorRequestedThisVisit = hasStartedInspection
          ? pendingQuantityLimit
          : (
              Number.isFinite(quantityRequestedCap)
                ? quantityRequestedCap
                : qc.quantities.client_demand
            );

        // vendor_offered for the visit: what vendor showed/added in THIS update
        const vendorOfferedThisVisit = addProvision;

        const inspectionInspectorId = qc.inspector?._id
          ? qc.inspector._id
          : qc.inspector;
        if (!inspectionInspectorId) {
          return res
            .status(400)
            .json({ message: "Inspector is required before updating inspection quantities" });
        }

        const inspectionDateForRecord =
          last_inspected_date !== undefined && String(last_inspected_date).trim() !== ""
            ? String(last_inspected_date).trim()
            : String(qc.last_inspected_date || qc.request_date || "").trim();

        if (!inspectionDateForRecord) {
          return res.status(400).json({
            message: "last_inspected_date is required for inspection records",
          });
        }

        const record = await Inspection.create([
          {
            qc: qc._id,
            inspector: inspectionInspectorId,
            inspection_date: inspectionDateForRecord,
            checked: addChecked,
            passed: addPassed,
            vendor_requested: vendorRequestedThisVisit,
            vendor_offered: vendorOfferedThisVisit,
            pending_after: qc.quantities.pending,
            cbm: {
              top: String(qc?.cbm?.top ?? "0"),
              bottom: String(qc?.cbm?.bottom ?? "0"),
              total: String(qc?.cbm?.total ?? "0"),
            },
            label_ranges: labelRangesUsedThisVisit,
            labels_added: labelsAddedThisVisit,
            remarks: remarks || "",
            createdBy: req.user._id,
          },
        ]);

        // push record id into qc
        qc.inspection_record = qc.inspection_record || [];
        qc.inspection_record.push(record[0]._id);
      }

      await qc.save();

      const orderId = qc?.order?._id || qc.order;
      const orderRecord = await Order.findById(orderId);
      if (orderRecord && orderRecord.status !== "Shipped") {
        const passedQty = Number(qc.quantities?.qc_passed || 0);
        const clientDemandQty = Number(qc.quantities?.client_demand || 0);

        orderRecord.status =
          clientDemandQty > 0 && passedQty >= clientDemandQty
            ? "Inspection Done"
            : "Under Inspection";
        await orderRecord.save();
      }

      try {
        await upsertItemFromQc(qc);
      } catch (itemSyncError) {
        console.error("Item sync after QC update failed:", {
          qcId: qc?._id,
          error: itemSyncError?.message || String(itemSyncError),
        });
      }

      res.json({
        message: "QC updated successfully",
        data: qc,
      });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getDailyReport = async (req, res) => {
  try {
    const reportDate = resolveReportDate(req.query.date);
    if (!reportDate) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const [alignedRequestsRaw, inspectionsRaw] = await Promise.all([
      QC.find({ request_date: reportDate })
        .select("request_date order_meta item inspector quantities order")
        .populate("inspector", "name email role")
        .populate("order", "order_id status quantity brand vendor")
        .sort({ createdAt: -1 })
        .lean(),
      Inspection.find({ inspection_date: reportDate })
        .select(
          "inspection_date inspector qc checked passed vendor_requested vendor_offered pending_after cbm remarks createdAt",
        )
        .populate("inspector", "name email role")
        .populate({
          path: "qc",
          select: "item order_meta order cbm request_date",
          populate: { path: "order", select: "order_id status quantity brand vendor" },
        })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const aligned_requests = alignedRequestsRaw.map((qc) => ({
      qc_id: qc._id,
      request_date: qc.request_date,
      order_id: qc?.order_meta?.order_id || qc?.order?.order_id || "N/A",
      brand: qc?.order_meta?.brand || qc?.order?.brand || "N/A",
      vendor: qc?.order_meta?.vendor || qc?.order?.vendor || "N/A",
      item_code: qc?.item?.item_code || "N/A",
      description: qc?.item?.description || "N/A",
      inspector: qc?.inspector
        ? {
            _id: qc.inspector._id,
            name: qc.inspector.name,
            email: qc.inspector.email,
            role: qc.inspector.role,
          }
        : null,
      quantity_requested: Number(qc?.quantities?.quantity_requested || 0),
      quantity_inspected: Number(qc?.quantities?.qc_checked || 0),
      quantity_passed: Number(qc?.quantities?.qc_passed || 0),
      quantity_pending: Number(qc?.quantities?.pending || 0),
      order_status: qc?.order?.status || "N/A",
    }));

    const inspectorMap = new Map();
    const inspectorCbmKeyMap = new Map();
    const globalCbmKeys = new Set();
    let totalInspectedCbm = 0;
    for (const inspection of inspectionsRaw) {
      const inspectorId = String(
        inspection?.inspector?._id || inspection?.inspector || "unassigned",
      );

      if (!inspectorMap.has(inspectorId)) {
        inspectorMap.set(inspectorId, {
          inspector: inspection?.inspector
            ? {
                _id: inspection.inspector._id,
                name: inspection.inspector.name,
                email: inspection.inspector.email,
                role: inspection.inspector.role,
              }
            : {
                _id: null,
                name: "Unassigned",
                email: "",
                role: "",
              },
          total_inspected_quantity: 0,
          total_inspected_cbm: 0,
          inspections_count: 0,
          inspections: [],
        });
      }

      const entry = inspectorMap.get(inspectorId);
      const inspectedQty = Number(inspection?.checked || 0);
      const qcRecord = inspection?.qc || {};
      const cbmSnapshot =
        inspection?.cbm && typeof inspection.cbm === "object"
          ? inspection.cbm
          : (qcRecord?.cbm || {});
      const cbmTotal = Number(cbmSnapshot?.total || 0);
      const safeCbmTotal = Number.isFinite(cbmTotal) ? cbmTotal : 0;
      const orderIdForKey = String(
        qcRecord?.order_meta?.order_id || qcRecord?.order?.order_id || "",
      ).trim();
      const itemCodeForKey = String(qcRecord?.item?.item_code || "").trim();
      const cbmKey =
        orderIdForKey && itemCodeForKey
          ? `${orderIdForKey}__${itemCodeForKey}`
          : `inspection:${inspection._id}`;

      entry.total_inspected_quantity += inspectedQty;
      if (!inspectorCbmKeyMap.has(inspectorId)) {
        inspectorCbmKeyMap.set(inspectorId, new Set());
      }
      const inspectorCbmKeys = inspectorCbmKeyMap.get(inspectorId);
      if (!inspectorCbmKeys.has(cbmKey)) {
        entry.total_inspected_cbm += safeCbmTotal;
        inspectorCbmKeys.add(cbmKey);
      }

      if (!globalCbmKeys.has(cbmKey)) {
        totalInspectedCbm += safeCbmTotal;
        globalCbmKeys.add(cbmKey);
      }

      entry.inspections_count += 1;
      entry.inspections.push({
        inspection_id: inspection._id,
        inspection_date: inspection.inspection_date || null,
        order_id: qcRecord?.order_meta?.order_id || qcRecord?.order?.order_id || "N/A",
        item_code: qcRecord?.item?.item_code || "N/A",
        description: qcRecord?.item?.description || "N/A",
        inspected_quantity: inspectedQty,
        passed_quantity: Number(inspection?.passed || 0),
        vendor_requested: Number(inspection?.vendor_requested || 0),
        vendor_offered: Number(inspection?.vendor_offered || 0),
        pending_after: Number(inspection?.pending_after || 0),
        cbm: {
          top: String(cbmSnapshot?.top ?? "0"),
          bottom: String(cbmSnapshot?.bottom ?? "0"),
          total: String(cbmSnapshot?.total ?? "0"),
        },
        remarks: inspection?.remarks || "",
      });
    }

    const inspector_compiled = Array.from(inspectorMap.values()).sort((a, b) =>
      String(a?.inspector?.name || "").localeCompare(String(b?.inspector?.name || "")),
    );

    const totalInspectedQty = inspector_compiled.reduce(
      (sum, entry) => sum + Number(entry.total_inspected_quantity || 0),
      0,
    );

    res.json({
      date: reportDate,
      summary: {
        aligned_requests_count: aligned_requests.length,
        inspectors_count: inspector_compiled.length,
        inspections_count: inspectionsRaw.length,
        total_inspected_quantity: totalInspectedQty,
        total_inspected_cbm: totalInspectedCbm,
      },
      aligned_requests,
      inspector_compiled,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};



exports.getQCById = async (req, res) => {
  try {
    const qc = await QC.findById(req.params.id)
      .populate("inspector", "name email role")
      .populate("createdBy", "name email role")
      .populate("request_history.inspector", "name email role")
      .populate("request_history.createdBy", "name email role")
      .populate("order")
      .populate({
        path: "inspection_record",
        options: { sort: { inspection_date: -1, createdAt: -1 } },
        populate: { path: "inspector", select: "name email role" },
      });

    if (!qc) {
      return res.status(404).json({ message: "QC record not found" });
    }

    const qcData = qc.toObject();
    const sortedLabels = normalizeLabels(qcData.labels);
    const sortedRequestHistory = Array.isArray(qcData.request_history)
      ? [...qcData.request_history].sort((a, b) => {
          const aTime = Math.max(
            toSortableTimestamp(a?.request_date),
            toSortableTimestamp(a?.createdAt),
          );
          const bTime = Math.max(
            toSortableTimestamp(b?.request_date),
            toSortableTimestamp(b?.createdAt),
          );
          return bTime - aTime;
        })
      : [];

    res.json({
      data: {
        ...qcData,
        labels: sortedLabels,
        request_history: sortedRequestHistory,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
