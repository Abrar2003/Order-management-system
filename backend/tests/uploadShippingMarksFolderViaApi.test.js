const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  __test__: {
    getItemFileMatch,
    groupFilesByItemCode,
  },
} = require("../scripts/uploadShippingMarksFolderViaApi");

test("shipping document folders map to their OMS file types", () => {
  const rootPath = path.join("C:\\imports", "BB_shipping_marks");
  const cases = [
    ["SHIPING MARK LEFT RIGHT", "260012_SHIPING_MARK_FRONT_BACK.pdf", "shipping_marks"],
    ["EAN", "260038_EAN_8721274906264.pdf", "ean"],
    ["FLAT CARTON", "260012_FLAT_CARTON.pdf", "flat_carton"],
    ["3D CARTON", "260012_3D_CARTON.pdf", "three_d_carton"],
    ["SATIN", "260394_SATIN_8721274912395.pdf", "satin_label"],
  ];

  for (const [folder, fileName, fileType] of cases) {
    assert.deepEqual(
      getItemFileMatch(path.join(rootPath, folder, fileName), { rootPath }),
      {
        itemCode: fileName.slice(0, 6),
        fileType,
        filePath: path.join(rootPath, folder, fileName),
      },
    );
  }
});

test("files group by both item code and OMS file type", () => {
  const groups = groupFilesByItemCode([
    { itemCode: "260012", fileType: "shipping_marks", filePath: "front.pdf" },
    { itemCode: "260012", fileType: "shipping_marks", filePath: "left.pdf" },
    { itemCode: "260012", fileType: "flat_carton", filePath: "flat.pdf" },
  ]);

  assert.deepEqual(groups, [
    { itemCode: "260012", fileType: "flat_carton", files: ["flat.pdf"] },
    { itemCode: "260012", fileType: "shipping_marks", files: ["front.pdf", "left.pdf"] },
  ]);
});
