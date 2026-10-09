const path = require("path");

const CLAIM_TEST_THRESHOLD = 3;

const DROP_TEST_STAGES = Object.freeze([
  { id: "top", label: "Drop 1 — Top face", group: "Drops 1–5" },
  { id: "right", label: "Drop 2 — Right face", group: "Drops 1–5" },
  { id: "bottom", label: "Drop 3 — Bottom face", group: "Drops 1–5" },
  { id: "corner_2_3_5", label: "Drop 4 — Corner 2-3-5", group: "Drops 1–5" },
  { id: "edge_3_4", label: "Drop 5 — Edge 3-4", group: "Drops 1–5" },
  { id: "front", label: "Drop 6 — Front face", group: "Drop 6" },
]);
const DROP_STAGE_IDS = new Set(DROP_TEST_STAGES.map((stage) => stage.id));
const DROP_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DROP_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv"]);

const DROP_TEST_INSTRUCTIONS = `After the six drops:\nPASS\n- Carton remains structurally intact.\n- No opening of carton seams.\n- No product exposure.\n- No major crushing affecting protection.\n- Furniture has no structural damage.\n- No broken/loose component.\n- No finish damage that would make the product unacceptable to a customer.\n- Product remains properly protected inside the carton.\nFAIL\n- Carton opens or tears through.\n- Product contacts/exposes through carton.\n- Furniture is broken, bent or structurally compromised.\n- Important hardware/components become loose or damaged.\n- Surface/finish damage caused by inadequate packaging.\n- Internal protection has collapsed sufficiently to allow product movement/damage.`;

const getDropHeights = (grossPackedWeightKg) => {
  const weight = Number(grossPackedWeightKg);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  if (weight <= 18) return { drops_1_to_5_mm: 305, drop_6_mm: 460 };
  if (weight <= 36) return { drops_1_to_5_mm: 250, drop_6_mm: 360 };
  if (weight <= 45) return { drops_1_to_5_mm: 200, drop_6_mm: 280 };
  return { drops_1_to_5_mm: 180, drop_6_mm: 230 };
};

const requiresClaimTest = (claimPercentage) => Number(claimPercentage) > CLAIM_TEST_THRESHOLD;

const hasAllDropStages = (stages = []) => {
  const selected = new Set(
    (Array.isArray(stages) ? stages : []).map((stage) => String(stage || "").trim()),
  );
  return selected.size === DROP_STAGE_IDS.size && [...selected].every((stage) => DROP_STAGE_IDS.has(stage));
};

const isAllowedDropMedia = (files = [], kind) => {
  const isImage = kind === "image";
  const limit = isImage ? 10 : 2;
  const extensions = isImage ? DROP_IMAGE_EXTENSIONS : DROP_VIDEO_EXTENSIONS;
  if (!Array.isArray(files) || files.length > limit) return false;
  return files.every((file) => {
    const extension = path.extname(String(file?.originalname || "")).toLowerCase();
    const mimeType = String(file?.mimetype || "").toLowerCase();
    return mimeType.startsWith(`${kind}/`) && extensions.has(extension);
  });
};

const toDateKey = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const getCurrentRequest = (qc = {}) => {
  const entries = Array.isArray(qc?.request_history) ? qc.request_history : [];
  const request = entries.reduce((latest, entry, index) => {
    const timestamp = Math.max(
      new Date(entry?.request_date || entry?.requested_date || 0).getTime() || 0,
      new Date(entry?.updatedAt || entry?.updated_at || 0).getTime() || 0,
      new Date(entry?.createdAt || entry?.created_at || 0).getTime() || 0,
      index,
    );
    return !latest || timestamp >= latest.timestamp ? { entry, timestamp } : latest;
  }, null)?.entry || null;
  const id = String(request?._id || "").trim();
  const date = toDateKey(request?.request_date || request?.requested_date || qc?.request_date);
  return {
    entry: request,
    id,
    date,
    key: id ? `history:${id}` : `date:${date || String(qc?._id || "")}`,
  };
};

const buildRequirementStatus = ({ qc, activeTests = [], claimPercentage = 0 }) => {
  const request = getCurrentRequest(qc);
  const completedRuns =
    (Array.isArray(qc?.test_runs) ? qc.test_runs : [])
      .filter((run) => String(run?.request_key || "").trim() === request.key)
      .map((run) => ({
        test_id: String(run?.test?._id || run?.test || "").trim(),
        version: String(run?.test_version || "").trim(),
      }))
      .filter((run) => run.test_id);
  const required = requiresClaimTest(claimPercentage);
  const tests = activeTests.map((test) => ({
    test_id: String(test?._id || test || "").trim(),
    completed: completedRuns.some(
      (run) =>
        run.test_id === String(test?._id || test || "").trim() &&
        run.version === String(test?.version || "").trim(),
    ),
  }));
  return {
    claim_percentage: Number(claimPercentage) || 0,
    required,
    request_key: request.key,
    request_history_id: request.id,
    request_date: request.date,
    tests,
    missing_test_ids: required
      ? tests.filter((entry) => !entry.completed).map((entry) => entry.test_id)
      : [],
  };
};

module.exports = {
  CLAIM_TEST_THRESHOLD,
  DROP_IMAGE_EXTENSIONS,
  DROP_TEST_INSTRUCTIONS,
  DROP_TEST_STAGES,
  DROP_VIDEO_EXTENSIONS,
  buildRequirementStatus,
  getCurrentRequest,
  getDropHeights,
  hasAllDropStages,
  isAllowedDropMedia,
  requiresClaimTest,
};
