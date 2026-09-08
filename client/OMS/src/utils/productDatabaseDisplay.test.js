import test from "node:test";
import assert from "node:assert/strict";
import { getProductDatabaseEmptyLabel } from "./productDatabaseDisplay.js";

test("created Product Database records display empty fields as N/A", () => {
  assert.equal(getProductDatabaseEmptyLabel("created"), "N/A");
  assert.equal(getProductDatabaseEmptyLabel("checked"), "Not Set");
});
