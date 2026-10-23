const express = require("express");
const mongoose = require("mongoose");
const Species = require("../models/woodSpecies.model");
const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const router = express.Router();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const run = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    const duplicate = error.code === 11000;
    res.status(duplicate ? 409 : 400).json({ code: duplicate ? "SPECIES_DUPLICATE" : "SPECIES_INVALID",
      message: duplicate ? "A species with this common or scientific name already exists." : error.message });
  }
};
router.use(auth);
router.get("/", requirePermission("items", "view"), run(async (req, res) => {
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  if (query.length > 80) throw new Error("Search must be at most 80 characters");
  const match = req.query.includeInactive === "true" ? {} : { active: true };
  if (query) match.$or = [{ name: new RegExp(escape(query), "i") }, { scientific_name: new RegExp(escape(query), "i") }];
  if (req.query.ids !== undefined) {
    if (typeof req.query.ids !== "string") throw new Error("Invalid species IDs");
    const ids = req.query.ids.split(",");
    if (ids.length > 100 || ids.some(id => !/^[a-f\d]{24}$/i.test(id))) throw new Error("Invalid species IDs");
    match._id = { $in: ids };
  }
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Limit must be 1–100");
  res.json({ data: await Species.find(match).sort({ name: 1, _id: 1 }).limit(limit).lean() });
}));
const manage = [requirePermission("settings", "manage"), (req, res, next) =>
  ["admin", "super admin", "super_admin"].includes(req.user.role) ? next() : res.status(403).json({ code: "FORBIDDEN", message: "Species management requires an administrator." })];
function values(body, creating) {
  if (!body || typeof body !== "object" || Object.keys(body).some(key => !["name", "scientific_name", "active"].includes(key))) throw new Error("Only species identity and active status may be edited");
  const result = {};
  for (const key of ["name", "scientific_name"]) {
    if (!creating && !Object.hasOwn(body, key)) continue;
    if (typeof body[key] !== "string" || !body[key].trim() || body[key].length > 160) throw new Error("Common and scientific names are required (maximum 160 characters)");
    result[key] = body[key].trim().replace(/\s+/g, " ");
  }
  if (Object.hasOwn(body, "active")) {
    if (typeof body.active !== "boolean") throw new Error("Active status must be true or false");
    result.active = body.active;
  }
  return result;
}
router.post("/", ...manage, run(async (req, res) => res.status(201).json({ data: await Species.create(values(req.body, true)) })));
router.patch("/:id", ...manage, run(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw new Error("Invalid species ID");
  const row = await Species.findByIdAndUpdate(req.params.id, { $set: values(req.body, false) }, { new: true, runValidators: true });
  if (!row) return res.status(404).json({ code: "NOT_FOUND", message: "Species not found" });
  res.json({ data: row });
}));
module.exports = router;
