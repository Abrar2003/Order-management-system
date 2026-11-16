const mongoose = require("mongoose");
const path = require("path");

const Test = require("../models/tests.model");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const Item = require("../models/item.model");
const Order = require("../models/order.model");
const { isManagerLikeRole, normalizeUserRoleKey } = require("../helpers/userRole");
const {
  DROP_TEST_INSTRUCTIONS,
  buildRequirementStatus,
  getCurrentRequest,
  getDropHeights,
  hasAllDropStages,
  isAllowedDropMedia,
} = require("../helpers/dropTest");
const { deriveOrderStatus } = require("../helpers/orderStatus");
const { runTransactionalController } = require("../helpers/transactionalController");
const { findDropTestWaiver } = require("../services/dropTestRequirement.service");
const { prepareVideoUpload, signVideoPart, completeVideoUpload } = require("../services/dropTestVideoUpload.service");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");
const {
  createStorageKey,
  deleteObject,
  getSignedObjectUrl,
  uploadBuffer,
} = require("../services/wasabiStorage.service");

const ACTIVE_ORDER_MATCH = { archived: { $ne: true }, status: { $ne: "Cancelled" } };

const normalizeText = (value = "") => String(value || "").trim();
const objectId = (value) => String(value?._id || value || "").trim();
const buildActor = (user = {}) => ({
  user: user?._id || user?.id || null,
  name: normalizeText(user?.name || user?.username || user?.email || user?.role),
});
const parseBoolean = (value, fallback = false) => {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "on"].includes(normalizeText(value).toLowerCase());
};
const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(normalizeText(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const isQcAssignedToUser = (qc, user) => {
  if (normalizeUserRoleKey(user?.role) !== "qc") return true;
  const userId = objectId(user?._id || user?.id);
  const inspectorId = objectId(qc?.inspector);
  return Boolean(userId && inspectorId && userId === inspectorId);
};

const loadQc = async (qcId, user) => {
  if (!mongoose.Types.ObjectId.isValid(qcId)) return null;
  const qc = await QC.findById(qcId).populate({
    path: "order",
    match: applyDataAccessMatch(ACTIVE_ORDER_MATCH, user),
    select: "_id quantity shipment status",
  });
  if (!qc?.order || !isQcAssignedToUser(qc, user)) return null;
  return qc;
};

const loadDropTestTarget = async (req, res) => {
  const qc = await loadQc(req.params.qcId, req.user);
  if (!qc) {
    res.status(404).json({ message: "QC record not found" });
    return null;
  }
  if (normalizeUserRoleKey(req.user?.role) !== "qc" || !isQcAssignedToUser(qc, req.user)) {
    res.status(403).json({ message: "Only the assigned QC inspector can run this test" });
    return null;
  }
  const testId = req.params.testId;
  const test = mongoose.isValidObjectId(testId)
    ? await Test.findOne({ _id: testId, type: "drop", is_active: true })
    : null;
  if (!test) {
    res.status(404).json({ message: "Active Drop Test not found" });
    return null;
  }
  const request = getCurrentRequest(qc);
  if ((req.body?.request_key !== undefined && req.body.request_key !== request.key) ||
      (req.body?.test_version !== undefined && req.body.test_version !== test.version)) {
    res.status(409).json({ message: "The inspection request or test template changed. Reopen the Drop Test." });
    return null;
  }
  return { qc, test, request, scope: {
    qc: qc._id, test: test._id, test_version: test.version,
    request_key: request.key, user: req.user._id || req.user.id,
  } };
};

const sendVideoUploadError = (res, error) => {
  if (!error.status) console.error("Drop Test video storage request failed:", error.name, error.$metadata?.httpStatusCode);
  return res.status(error.status || 502).json({
    message: error.status ? error.message : "Wasabi could not be reached or rejected the upload. Retry to continue.",
  });
};

exports.prepareDropTestVideo = async (req, res) => {
  try {
    const target = await loadDropTestTarget(req, res);
    if (target) return res.json({ data: await prepareVideoUpload(target.scope, req.body) });
  } catch (error) {
    return sendVideoUploadError(res, error);
  }
};

exports.signDropTestVideoPart = async (req, res) => {
  try {
    const target = await loadDropTestTarget(req, res);
    if (!target) return;
    const upload_url = await signVideoPart(target.scope, req.params.uploadId, Number(req.params.partNumber));
    return res.json({ data: { upload_url } });
  } catch (error) {
    return sendVideoUploadError(res, error);
  }
};

const serializeGuide = async (guide = {}) => {
  const key = normalizeText(guide?.key);
  let url = normalizeText(guide?.link);
  if (key) {
    url = await getSignedObjectUrl(key, {
      filename: normalizeText(guide?.originalName || guide?.original_name),
    });
  }
  return {
    originalName: normalizeText(guide?.originalName || guide?.original_name),
    contentType: normalizeText(guide?.contentType || guide?.content_type),
    size: Number(guide?.size || 0),
    key,
    url,
  };
};

const serializeTemplate = async (test = {}) => ({
  _id: objectId(test),
  type: normalizeText(test?.type || "drop"),
  name: normalizeText(test?.name),
  description: normalizeText(test?.description),
  version: normalizeText(test?.version),
  is_active: test?.is_active !== false,
  instructions: normalizeText(test?.instructions),
  testing_guide: test?.testing_guide ? await serializeGuide(test.testing_guide) : null,
  createdAt: test?.createdAt || null,
  updatedAt: test?.updatedAt || null,
});

const serializeMedia = async (entry = {}) => ({
  _id: objectId(entry),
  original_name: normalizeText(entry?.original_name),
  content_type: normalizeText(entry?.content_type),
  size: Number(entry?.size || 0),
  key: normalizeText(entry?.key),
  url: await getSignedObjectUrl(normalizeText(entry?.key), {
    filename: normalizeText(entry?.original_name),
  }),
  download_url: await getSignedObjectUrl(normalizeText(entry?.key), {
    filename: normalizeText(entry?.original_name),
    download: true,
  }),
  uploaded_by: entry?.uploaded_by || null,
  uploaded_at: entry?.uploaded_at || null,
});

const serializeRun = async (run = {}) => ({
  _id: objectId(run),
  test: objectId(run?.test),
  test_type: normalizeText(run?.test_type),
  test_name: normalizeText(run?.test_name),
  test_version: normalizeText(run?.test_version),
  request_history_id: objectId(run?.request_history_id),
  request_key: normalizeText(run?.request_key),
  request_date: normalizeText(run?.request_date),
  gross_packed_weight_kg: Number(run?.gross_packed_weight_kg || 0),
  drops_1_to_5_mm: Number(run?.drops_1_to_5_mm || 0),
  drop_6_mm: Number(run?.drop_6_mm || 0),
  confirmed_stages: Array.isArray(run?.confirmed_stages) ? run.confirmed_stages : [],
  result: normalizeText(run?.result),
  images: await Promise.all((run?.images || []).map(serializeMedia)),
  videos: await Promise.all((run?.videos || []).map(serializeMedia)),
  completed_by: run?.completed_by || null,
  completed_at: run?.completed_at || null,
});

const getClaimPercentage = async (qc, user) => {
  const code = normalizeText(qc?.item?.item_code);
  if (!code) return 0;
  const item = await Item.findOne(applyDataAccessMatch(
    { code: { $regex: `^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
    user,
    { brandFields: ["brand", "brand_name", "brands"], vendorFields: ["vendors"] },
  )).select("claim_percentage").lean();
  return Math.max(0, Number(item?.claim_percentage || 0) || 0);
};

const uploadFiles = async (files, actor, kind) => {
  const uploadedAt = new Date();
  const uploads = [];
  for (const file of files) {
    const originalName = normalizeText(file?.originalname);
    const key = createStorageKey({
      folder: "qc-tests",
      originalName,
      extension: path.extname(originalName).toLowerCase(),
    });
    const result = await uploadBuffer({
      buffer: file.buffer,
      key,
      originalName,
      contentType: file.mimetype || "application/octet-stream",
    });
    uploads.push({
      key: result.key,
      original_name: originalName,
      content_type: file.mimetype || "application/octet-stream",
      size: Number(file.size || result.size || 0),
      uploaded_by: actor,
      uploaded_at: uploadedAt,
      kind,
    });
  }
  return uploads;
};

const releasePendingInspection = async ({ qc, request, user }) => {
  const match = request.id
    ? { qc: qc._id, request_history_id: request.id }
    : { qc: qc._id, requested_date: request.date };
  const inspection = await Inspection.findOne(match).sort({ createdAt: -1 });
  if (!inspection?.test_requirement_pending) return false;

  inspection.test_requirement_pending = false;
  inspection.status = "Inspection Done";
  inspection.updated_by = buildActor(user);
  await inspection.save();

  if (request.entry) {
    request.entry.status = "inspected";
    request.entry.updatedAt = new Date();
    request.entry.updated_by = buildActor(user);
  }
  qc.test_requirement_pending = false;
  qc.updated_by = buildActor(user);
  await qc.save();

  const order = await Order.findById(qc.order);
  if (order) {
    const inspections = await Inspection.find({ qc: qc._id }).lean();
    order.status = deriveOrderStatus({
      orderEntry: order,
      qcRecord: { ...qc.toObject(), inspection_record: inspections },
    });
    await order.save();
  }
  return true;
};

const ensureManager = (req, res) => {
  if (isManagerLikeRole(req.user?.role)) return true;
  res.status(403).json({ message: "Test templates are restricted to manager users." });
  return false;
};

exports.ensureDropTestTemplate = async () => {
  const active = await Test.findOne({ type: "drop", is_active: true }).lean();
  if (active) return active;
  return Test.create({
    type: "drop",
    name: "Drop Test",
    description: "ISTA 3B six-drop carton and furniture protection test.",
    version: "1",
    testing_guide: {
      originalName: "drop-test-guide.png",
      contentType: "image/png",
      link: "/drop-test-guide.png",
    },
    instructions: DROP_TEST_INSTRUCTIONS,
    is_active: true,
  });
};

exports.getTests = async (req, res) => {
  try {
    const includeInactive = parseBoolean(req.query?.include_inactive) && isManagerLikeRole(req.user?.role);
    const rows = await Test.find(includeInactive ? {} : { is_active: true }).sort({ is_active: -1, updatedAt: -1 }).lean();
    return res.json({ data: await Promise.all(rows.map(serializeTemplate)) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load tests" });
  }
};

exports.createTest = async (req, res) => {
  if (!ensureManager(req, res)) return;
  try {
    const name = normalizeText(req.body?.name);
    const version = normalizeText(req.body?.version);
    if (!name || !version) return res.status(400).json({ message: "Name and version are required" });
    if (req.file && !isAllowedDropMedia([req.file], "image")) {
      return res.status(400).json({ message: "Testing guide must be a supported image" });
    }
    const isActive = parseBoolean(req.body?.is_active, true);
    let guide = undefined;
    if (req.file) {
      const [uploaded] = await uploadFiles([req.file], buildActor(req.user), "guide");
      guide = {
        key: uploaded.key,
        originalName: uploaded.original_name,
        contentType: uploaded.content_type,
        size: uploaded.size,
      };
    }
    if (isActive) await Test.updateMany({ type: "drop", is_active: true }, { $set: { is_active: false } });
    const test = await Test.create({
      type: "drop",
      name,
      version,
      description: normalizeText(req.body?.description),
      instructions: normalizeText(req.body?.instructions) || DROP_TEST_INSTRUCTIONS,
      testing_guide: guide,
      is_active: isActive,
    });
    return res.status(201).json({ data: await serializeTemplate(test) });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to create test" });
  }
};

exports.updateTest = async (req, res) => {
  if (!ensureManager(req, res)) return;
  try {
    const test = await Test.findById(req.params.id);
    if (!test) return res.status(404).json({ message: "Test not found" });
    if (req.file && !isAllowedDropMedia([req.file], "image")) {
      return res.status(400).json({ message: "Testing guide must be a supported image" });
    }
    const nextActive = req.body?.is_active === undefined ? test.is_active : parseBoolean(req.body.is_active);
    if (nextActive) await Test.updateMany({ _id: { $ne: test._id }, type: "drop", is_active: true }, { $set: { is_active: false } });
    ["name", "version", "description", "instructions"].forEach((field) => {
      if (req.body?.[field] !== undefined) test[field] = normalizeText(req.body[field]);
    });
    test.is_active = nextActive;
    if (req.file) {
      const oldKey = normalizeText(test?.testing_guide?.key);
      const [uploaded] = await uploadFiles([req.file], buildActor(req.user), "guide");
      test.testing_guide = {
        key: uploaded.key,
        originalName: uploaded.original_name,
        contentType: uploaded.content_type,
        size: uploaded.size,
      };
      await test.save();
      if (oldKey) deleteObject(oldKey).catch(() => {});
    } else {
      await test.save();
    }
    return res.json({ data: await serializeTemplate(test) });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to update test" });
  }
};

exports.getQcTests = async (req, res) => {
  try {
    const qc = await loadQc(req.params.qcId, req.user);
    if (!qc) return res.status(404).json({ message: "QC record not found" });
    const [activeTests, claimPercentage, waiver] = await Promise.all([
      Test.find({ is_active: true }).sort({ updatedAt: -1 }).lean(),
      getClaimPercentage(qc, req.user),
      findDropTestWaiver(qc.item?.item_code),
    ]);
    const requirement = buildRequirementStatus({ qc, activeTests, claimPercentage, waiver });
    return res.json({
      data: {
        requirement,
        templates: await Promise.all(activeTests.map(serializeTemplate)),
        runs: await Promise.all((qc.test_runs || []).map(serializeRun)),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load QC tests" });
  }
};

exports.submitDropTestRun = async (req, res) => {
  try {
    const target = await loadDropTestTarget(req, res);
    if (!target) return;
    const { qc, test, request, scope } = target;
    const runId = req.body?.run_id;
    if (runId !== undefined && (typeof runId !== "string" || !/^[a-f0-9]{24}$/i.test(runId))) {
      return res.status(400).json({ message: "Invalid Drop Test run ID" });
    }

    const weight = Number(req.body?.gross_packed_weight_kg);
    const heights = getDropHeights(weight);
    const result = normalizeText(req.body?.result).toLowerCase();
    const confirmedStages = [...new Set(parseArray(req.body?.confirmed_stages).map((entry) => normalizeText(entry)))];
    if (!heights) return res.status(400).json({ message: "Gross packed weight must be greater than 0" });
    if (!["pass", "fail"].includes(result)) return res.status(400).json({ message: "Select PASS or FAIL" });
    if (!hasAllDropStages(confirmedStages)) {
      return res.status(400).json({ message: "Confirm all six drop stages" });
    }

    const images = Array.isArray(req.files?.images) ? req.files.images : [];
    if (!isAllowedDropMedia(images, "image")) {
      return res.status(400).json({ message: "Drop Test accepts up to 10 supported images" });
    }
    let videoIds;
    try {
      videoIds = JSON.parse(req.body?.video_upload_ids ?? "[]");
    } catch {
      return res.status(400).json({ message: "Invalid video upload IDs" });
    }
    if (!Array.isArray(videoIds) || videoIds.length > 2 || new Set(videoIds).size !== videoIds.length ||
        !videoIds.every((id) => typeof id === "string" && /^[a-f0-9]{24}$/.test(id))) {
      return res.status(400).json({ message: "Supply up to 2 distinct video upload IDs" });
    }

    let run;
    if (!runId || !qc.test_runs.id(runId)) {
      if (mongoose.connection.$supportsTransactions === false) {
        return res.status(503).json({ message: "Drop Test submissions require MongoDB transactions." });
      }
      const actor = buildActor(req.user);
      let uploadedVideos;
      try {
        uploadedVideos = await Promise.all(videoIds.map((id) => completeVideoUpload(scope, id, actor)));
      } catch (error) {
        return sendVideoUploadError(res, error);
      }
      const uploadedImages = await uploadFiles(images, actor, "image");
      run = {
        _id: runId || new mongoose.Types.ObjectId(),
        test: test._id,
        test_type: "drop",
        test_name: test.name,
        test_version: test.version,
        request_history_id: request.id || null,
        request_key: request.key,
        request_date: request.date,
        gross_packed_weight_kg: weight,
        ...heights,
        confirmed_stages: confirmedStages,
        result,
        images: uploadedImages,
        videos: uploadedVideos,
        completed_by: actor,
        completed_at: new Date(),
      };
    }

    return await runTransactionalController({ connection: mongoose.connection, req, res, handler: async (req, res) => {
      const current = await loadDropTestTarget(req, res);
      if (!current) return;
      if (current.request.key !== request.key || current.test.version !== test.version) {
        return res.status(409).json({ message: "The inspection request or test template changed. Reopen the Drop Test." });
      }
      const savedQc = current.qc;
      if (run && !savedQc.test_runs.id(run._id)) {
        savedQc.test_runs.push(run);
        savedQc.updated_by = run.completed_by;
        await savedQc.save();
      }
      const activeTests = await Test.find({ is_active: true }).lean();
      const claimPercentage = await getClaimPercentage(savedQc, req.user);
      const waiver = await findDropTestWaiver(savedQc.item?.item_code);
      const requirement = buildRequirementStatus({ qc: savedQc, activeTests, claimPercentage, waiver });
      const released = requirement.missing_test_ids.length === 0
        ? await releasePendingInspection({ qc: savedQc, request: current.request, user: req.user })
        : false;
      return res.status(201).json({ data: { requirement, released } });
    } });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to submit Drop Test" });
  }
};
