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

      // JOIN QC
      {
        $lookup: {
          from: "qcs",
          localField: "qc_record",
          foreignField: "_id",
          as: "qc",
        },
      },
      { $unwind: { path: "$qc", preserveNullAndEmptyArrays: true } },

      // JOIN INSPECTIONS (NO UNWIND)
      {
        $lookup: {
          from: "inspections",
          localField: "qc._id",
          foreignField: "qc",
          as: "inspections",
        },
      },

      // KEEP ONLY REQUIRED FIELDS
      {
        $project: {
          order_id: 1,
          itemCode: "$item.item_code",
          quantity: 1,
          inspections: {
            $map: {
              input: "$inspections",
              as: "insp",
              in: {
                passed: "$$insp.passed",
                createdAt: "$$insp.createdAt",
              },
            },
          },
        },
      },

      { $sort: { quantity: -1 } },

      {
        $facet: {
          data: [{ $skip: skip }, { $limit: Number(limit) }],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const result = await Order.aggregate(pipeline);
    const processOrder = (order) => {
      const inspections = (order.inspections || [])
        .filter((i) => i?.createdAt)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      // Calculate total passed quantity across all inspections
      const totalPassed = inspections.reduce((sum, insp) => sum + (insp.passed || 0), 0);

      if (inspections.length < 2) {
        return {
          orderId: order.order_id,
          itemCode: order.itemCode,
          orderQuantity: order.quantity,
          passedQuantity: totalPassed,
          inspectionTimeDays: null,
          rejectionPercent: null,
        };
      }

      // ✅ Inspection Time
      const first = new Date(inspections[0].createdAt);
      const last = new Date(inspections[inspections.length - 1].createdAt);

      const inspectionTimeDays = (last - first) / (1000 * 60 * 60 * 24);

      // ✅ Rejection Logic (your exact requirement)
      let remaining = order.quantity;
      const percentages = [];

      for (const insp of inspections) {
        if (!remaining || remaining <= 0) break;

        const passed = insp.passed || 0;
        const rejected = remaining - passed;

        if (remaining >= 0) {
          const percent = (rejected / remaining) * 100;

          if (percent !== 0) {
            percentages.push(percent);
          }
        }

        remaining = rejected;
      }

      const rejectionPercent =
        percentages.length > 0
          ? percentages.reduce((a, b) => a + b, 0) / percentages.length
          : null;

      return {
        orderId: order.order_id,
        itemCode: order.itemCode,
        orderQuantity: order.quantity,
        passedQuantity: totalPassed,
        inspectionTimeDays: Number(inspectionTimeDays.toFixed(2)),
        rejectionPercent: rejectionPercent
          ? Number(rejectionPercent.toFixed(2))
          : null,
      };
    };
    const rawData = result[0]?.data || [];
const data = rawData.map(processOrder);
    const total = result[0]?.totalCount[0]?.count || 0;
    const totalPages = Math.ceil(total / Number(limit));
    
    console.log("Product Analytics Result:", data);
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
