const mongoose = require("mongoose");
const Order = require("../models/order.model");

exports.getProductAnalytics = async (req, res) => {
  try {
    const { search = "", brand, vendor, page = 1, limit = 20 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    // -------------------------------
    // MATCH STAGE (Filters)
    // -------------------------------
    const matchStage = {
      archived: { $ne: true },
    };

    if (search) {
      matchStage["item.item_code"] = {
        $regex: search,
        $options: "i",
      };
    }

    if (brand && brand !== "all") matchStage.brand = brand;
    if (vendor && vendor !== "all") matchStage.vendor = vendor;

    // Fetch available filters for dropdowns
    const [brandOptions, vendorOptions] = await Promise.all([
      Order.distinct("brand", { archived: { $ne: true } }),
      Order.distinct("vendor", { archived: { $ne: true } }),
    ]);

    // -------------------------------
    // AGGREGATION PIPELINE
    // -------------------------------
    const pipeline = [
  { $match: matchStage },

  // -------------------------------
  // JOIN QC
  // -------------------------------
  {
    $lookup: {
      from: "qcs",
      localField: "qc_record",
      foreignField: "_id",
      as: "qc",
    },
  },
  { $unwind: { path: "$qc", preserveNullAndEmptyArrays: true } },

  // -------------------------------
  // JOIN INSPECTIONS
  // -------------------------------
  {
    $lookup: {
      from: "inspections",
      localField: "qc._id",
      foreignField: "qc",
      as: "inspections",
    },
  },
  {
    $unwind: {
      path: "$inspections",
      preserveNullAndEmptyArrays: true,
    },
  },

  // -------------------------------
  // COMPUTE FIELDS
  // -------------------------------
  {
    $addFields: {
      // ✅ Delay (use earliest stuffing date)
      delayDays: {
        $cond: [
          {
            $and: [
              { $ifNull: ["$ETD", false] },
              { $gt: [{ $size: { $ifNull: ["$shipment", []] } }, 0] },
            ],
          },
          {
            $divide: [
              {
                $subtract: [
                  { $min: "$shipment.stuffing_date" },
                  "$ETD",
                ],
              },
              1000 * 60 * 60 * 24,
            ],
          },
          null,
        ],
      },

      // ✅ Inspection Time (earliest request_history date)
      inspectionTimeDays: {
        $let: {
          vars: {
            earliestRequestDate: {
              $min: {
                $map: {
                  input: { $ifNull: ["$qc.request_history", []] },
                  as: "rh",
                  in: {
                    $cond: [
                      { $ifNull: ["$$rh.request_date", false] },
                      { $toDate: "$$rh.request_date" },
                      null,
                    ],
                  },
                },
              },
            },
          },
          in: {
            $cond: [
              {
                $and: [
                  { $ifNull: ["$$earliestRequestDate", false] },
                  { $ifNull: ["$order_date", false] },
                ],
              },
              {
                $divide: [
                  {
                    $subtract: ["$$earliestRequestDate", "$order_date"],
                  },
                  1000 * 60 * 60 * 24,
                ],
              },
              null,
            ],
          },
        },
      },

      // ✅ Rejection %
      rejectionPercent: {
        $cond: [
          { $gt: ["$inspections.checked", 0] },
          {
            $multiply: [
              {
                $divide: [
                  {
                    $subtract: [
                      "$inspections.checked",
                      "$inspections.passed",
                    ],
                  },
                  "$inspections.checked",
                ],
              },
              100,
            ],
          },
          null,
        ],
      },
    },
  },

  // -------------------------------
  // 🧠 LEVEL 1: GROUP PER ORDER (CRITICAL FIX)
  // -------------------------------
  {
    $group: {
      _id: "$order_id",

      itemCode: { $first: "$item.item_code" },
      quantity: { $first: "$quantity" },

      delayDays: { $first: "$delayDays" },
      inspectionTimeDays: { $first: "$inspectionTimeDays" },

      rejectionPercent: { $avg: "$rejectionPercent" }, // avg per order
    },
  },

  // -------------------------------
  // 🧠 LEVEL 2: GROUP PER ITEM
  // -------------------------------
  {
    $group: {
      _id: "$itemCode",

      orderedCount: { $sum: 1 },

      totalOrderedQty: { $sum: "$quantity" },

      avgDelay: {
        $avg: {
          $cond: [
            { $ne: ["$delayDays", null] },
            "$delayDays",
            "$$REMOVE",
          ],
        },
      },

      avgInspectionTime: {
        $avg: {
          $cond: [
            { $ne: ["$inspectionTimeDays", null] },
            "$inspectionTimeDays",
            "$$REMOVE",
          ],
        },
      },

      avgRejectionPercent: {
        $avg: {
          $cond: [
            { $ne: ["$rejectionPercent", null] },
            "$rejectionPercent",
            "$$REMOVE",
          ],
        },
      },
    },
  },

  // -------------------------------
  // FORMAT OUTPUT
  // -------------------------------
  {
    $project: {
      _id: 0,
      itemCode: "$_id",
      orderedCount: 1,
      totalOrderedQty: 1,
      avgDelay: { $round: ["$avgDelay", 2] },
      avgInspectionTime: { $round: ["$avgInspectionTime", 2] },
      avgRejectionPercent: { $round: ["$avgRejectionPercent", 2] },
    },
  },

  { $sort: { totalOrderedQty: -1 } },

  // -------------------------------
  // ✅ PAGINATION
  // -------------------------------
  {
    $facet: {
      data: [
        { $skip: skip },
        { $limit: Number(limit) },
      ],
      totalCount: [{ $count: "count" }],
    },
  },
];

    const result = await Order.aggregate(pipeline);
    console.log("Product Analytics Result:", result);
    const data = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;
    const totalPages = Math.ceil(total / Number(limit));

    return res.json({
      success: true,
      data,
      pagination: {
        totalRecords: total,
        totalPages,
        page: Number(page),
        limit: Number(limit),
      },
      filters: {
        brands: brandOptions || [],
        vendors: vendorOptions || [],
      },
    });
  } catch (error) {
    console.error("Product Analytics Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch product analytics",
    });
  }
};
