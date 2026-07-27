const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveIsaaFolderCode,
  evaluateIsaaCandidate,
} = require("../scripts/uploadPisFolderViaApi");

test("ISAA folder code validation only permits exact PIS article matches", () => {
  assert.equal(deriveIsaaFolderCode("86310_Pot Tasmania"), "86310");
  assert.equal(deriveIsaaFolderCode("old"), "");

  assert.deepEqual(
    evaluateIsaaCandidate({ folderCode: "86310", articleNumber: "86310" }),
    { upload: true, reason: "" },
  );
  assert.deepEqual(
    evaluateIsaaCandidate({ folderCode: "86310", articleNumber: "89310" }),
    {
      upload: false,
      reason: "PIS article number 89310 does not match folder code 86310",
    },
  );
});
