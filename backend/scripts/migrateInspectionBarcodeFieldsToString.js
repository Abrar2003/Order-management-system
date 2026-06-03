const mongoose = require("mongoose");

const connectDB = require("../config/connectDB");

const TARGET_FIELDS = ["barcode", "master_barcode", "inner_barcode"];

const shouldDryRun = () =>
  process.argv.includes("--dry-run") ||
  String(process.env.DRY_RUN || "").trim().toLowerCase() === "true";

const buildTypeCounts = async (collection, fieldPath) => {
  const [group] = await collection
    .aggregate([
      {
        $group: {
          _id: null,
          missing: {
            $sum: {
              $cond: [{ $eq: [{ $type: `$${fieldPath}` }, "missing"] }, 1, 0],
            },
          },
          nullValue: {
            $sum: {
              $cond: [{ $eq: [{ $type: `$${fieldPath}` }, "null"] }, 1, 0],
            },
          },
          stringValue: {
            $sum: {
              $cond: [{ $eq: [{ $type: `$${fieldPath}` }, "string"] }, 1, 0],
            },
          },
          numericValue: {
            $sum: {
              $cond: [
                {
                  $in: [
                    { $type: `$${fieldPath}` },
                    ["int", "long", "double", "decimal"],
                  ],
                },
                1,
                0,
              ],
            },
          },
          otherValue: {
            $sum: {
              $cond: [
                {
                  $not: [
                    {
                      $in: [
                        { $type: `$${fieldPath}` },
                        [
                          "missing",
                          "null",
                          "string",
                          "int",
                          "long",
                          "double",
                          "decimal",
                        ],
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ])
    .toArray();

  return {
    missing: group?.missing || 0,
    null: group?.nullValue || 0,
    string: group?.stringValue || 0,
    numeric: group?.numericValue || 0,
    other: group?.otherValue || 0,
  };
};

const buildSetExpression = (fieldPath) => ({
  $let: {
    vars: {
      rawValue: `$${fieldPath}`,
      rawType: { $type: `$${fieldPath}` },
    },
    in: {
      $cond: [
        {
          $or: [
            { $eq: ["$$rawType", "missing"] },
            { $eq: ["$$rawType", "null"] },
            { $eq: ["$$rawValue", ""] },
            { $eq: ["$$rawValue", 0] },
            { $eq: ["$$rawValue", "0"] },
          ],
        },
        "",
        { $toString: "$$rawValue" },
      ],
    },
  },
});

const main = async () => {
  const dryRun = shouldDryRun();
  await connectDB();

  const collection = mongoose.connection.collection("inspections");
  const totalInspections = await collection.countDocuments();

  console.log(`Inspections found: ${totalInspections}`);
  console.log(`Mode: ${dryRun ? "dry-run" : "write"}`);

  console.log("Before:");
  for (const field of TARGET_FIELDS) {
    console.log(`  ${field}`, await buildTypeCounts(collection, field));
  }

  if (!dryRun) {
    const result = await collection.updateMany(
      {},
      [
        {
          $set: {
            barcode: buildSetExpression("barcode"),
            master_barcode: buildSetExpression("master_barcode"),
            inner_barcode: buildSetExpression("inner_barcode"),
          },
        },
      ],
    );

    console.log("Update result:", {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  }

  console.log("After:");
  for (const field of TARGET_FIELDS) {
    console.log(`  ${field}`, await buildTypeCounts(collection, field));
  }
};

main()
  .catch((error) => {
    console.error("Inspection barcode field migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
