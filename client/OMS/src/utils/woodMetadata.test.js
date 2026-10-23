import test from "node:test";
import assert from "node:assert/strict";
import { woodForm, woodPayload, shareBps, woodCft, eudrShipmentPayload } from "./woodMetadata.js";
import { integrationContinuation } from "./integrationContinuation.js";
test("wood forms preserve existing IDs and exact percentages", () => {
  const form = woodForm({ timber_cft: 0.5, hs_code: "940360", species_composition: [{ species: "a", share_bp: 6000 }, { species: "b", share_bp: 4000 }] });
  assert.deepEqual(woodPayload(form).species_composition, [{ species: "a", share_bp: 6000 }, { species: "b", share_bp: 4000 }]);
  assert.equal(shareBps("33.33"), 3333);
  assert.throws(() => shareBps("33.333"));
  assert.throws(() => woodPayload({ ...form, parts: [{ species: "a", percent: "99.99" }] }));
  assert.deepEqual(woodPayload({ ...form, value: "0", parts: [] }).species_composition, []);
});

test("EUDR shipping requires positive volume, HSN and complete wood composition only when checked", () => {
  const empty = woodForm();
  assert.deepEqual(eudrShipmentPayload(false, empty), { eudr_needed: false });
  const form = woodForm({ timber_cft: 0.5, hs_code: "9403 60", species_composition: [{ species: "a", share_bp: 10000 }] });
  assert.equal(eudrShipmentPayload(true, form).eudr_needed, true);
  for (const fields of [{ value: "" }, { value: "0" }, { value: "-1" }, { value: "Infinity" }, { hs_code: "" }, { hs_code: "abc" }, { parts: [] }, { parts: [{ species: "a", percent: "99" }] }]) {
    assert.throws(() => eudrShipmentPayload(true, { ...form, ...fields }));
  }
  assert.equal(woodCft(empty), null);
  assert.equal(woodCft({ ...form, unit: "m3", value: "0.014158423296" }), 0.5);
});
test("only the fixed V2 launch can resume after OMS login", () => {
  const state = "a".repeat(64);
  assert.equal(integrationContinuation("?continue=eudr-v2&state=" + state, "/api").url, "/api/integrations/eudr/v2/auth/launch?state=" + state);
  assert.equal(integrationContinuation("?continue=eudr&state=" + state), null);
  assert.equal(integrationContinuation("?continue=https://evil.test&state=" + state), null);
  assert.equal(integrationContinuation("?continue=eudr-v2&state=invalid"), null);
});
