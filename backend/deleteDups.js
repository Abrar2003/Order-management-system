const DO_DELETE = false;

// your same duplicate pipeline
const dupPipeline = [
  {
    $match: {
      qc: { $type: "objectId" },
      inspector: { $type: "objectId" },
      vendor_requested: { $type: "number" },
      vendor_offered: { $type: "number" },
      checked: { $type: "number" },
      passed: { $type: "number" },
    },
  },
  {
    $group: {
      _id: {
        qc: "$qc",
        inspector: "$inspector",
        vendor_requested: "$vendor_requested",
        vendor_offered: "$vendor_offered",
        checked: "$checked",
        passed: "$passed",
      },
      ids: { $push: "$_id" },
      count: { $sum: 1 },
    },
  },
  { $match: { count: { $gt: 1 } } },
];

const groups = db.inspections.aggregate(dupPipeline).toArray();
print(`Duplicate groups found: ${groups.length}`);
groups.slice(0, 10).forEach((g, i) =>
  printjson({ i, count: g.count, key: g._id.qc, ids: g.ids })
);

if (!DO_DELETE) {
  print("Dry run only. Set DO_DELETE=true to apply deletions.");
  quit();
}

const session = db.getMongo().startSession();
const sdb = session.getDatabase(db.getName());

session.withTransaction(() => {
  for (const g of groups) {
    const qcId = g._id.qc; // <- TRUST THIS

    // Fetch docs sorted by createdAt (keep earliest)
    const docs = sdb.inspections
      .find(
        { _id: { $in: g.ids } },
        { projection: { qc: 1, createdAt: 1 } }
      )
      .sort({ createdAt: 1 })
      .toArray();

    if (docs.length < 2) continue;

    // Sanity: ensure every doc has qc and matches group qcId
    const bad = docs.some((d) => !d.qc || d.qc.valueOf() !== qcId.valueOf());
    if (bad) {
      print(`SKIP (missing/mismatched qc in docs) key=${EJSON.stringify(g._id)}`);
      continue;
    }

    const keeper = docs[0];
    deleteIds = docs.slice(1).map((d) => d._id);

    // 1) Pull deleted ids from QC.inspection_record
    const pullRes = sdb.qc.updateOne(
      { _id: qcId },
      { $pull: { inspection_record: { $in: deleteIds } } }
    );

    // Optional extra sanity: if QC doc not found, skip deleting inspections
    if (pullRes.matchedCount === 0) {
      print(`SKIP (QC not found) qc=${qcId.valueOf()} key=${EJSON.stringify(g._id)}`);
      continue;
    }

    // 2) Delete later duplicate inspection docs
    const delRes = sdb.inspections.deleteMany({ _id: { $in: deleteIds } });
    print(
        `DEDUP OK | qc=${qcId.valueOf()} keeper=${keeper._id.valueOf()} deleted=${delRes.deletedCount}`
    );
}
});

session.endSession();
print("Done.");
