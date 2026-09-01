const LabelStorageState = require("../../models/labelStorageState.model");
const LabelSyncFailure = require("../../models/labelSyncFailure.model");
const legacyRepository = require("./legacyLabel.repository");
const modernRepository = require("./modernLabel.repository");

const DEFAULT_LABEL_STORAGE_STATE = Object.freeze({
  schema_version: 2,
  migration_status: "legacy",
  read_source: "legacy",
  write_mode: "legacy",
  legacy_fallback_enabled: true,
});
const MODERN_READ_STATUSES = new Set(["verified", "modern"]);
const SAFE_PRE_CUTOVER_STATUSES = new Set([
  "backfilled",
  "backfilled_with_conflicts",
  "verifying",
  "verified",
]);

const isSafePreCutoverStorageState = (state) =>
  Number(state?.schema_version) >= 2 &&
  SAFE_PRE_CUTOVER_STATUSES.has(String(state?.migration_status || "")) &&
  String(state?.read_source || "") === "legacy" &&
  String(state?.write_mode || "") === "legacy";

class LabelStorageService {
  constructor({
    storageStateModel = LabelStorageState,
    syncFailureModel = LabelSyncFailure,
    legacy = legacyRepository,
    modern = modernRepository,
    logger = console,
  } = {}) {
    this.storageStateModel = storageStateModel;
    this.syncFailureModel = syncFailureModel;
    this.legacy = legacy;
    this.modern = modern;
    this.logger = logger;
  }

  async getState(inspectorId) {
    const state = await this.storageStateModel.findOne({ inspector: inspectorId })
      .lean();
    return state
      ? { ...DEFAULT_LABEL_STORAGE_STATE, ...state }
      : { ...DEFAULT_LABEL_STORAGE_STATE };
  }

  async read(inspectorId, operation, ...args) {
    const state = await this.getState(inspectorId);
    const canReadModern =
      state.read_source === "modern" &&
      Number(state.schema_version) >= 2 &&
      MODERN_READ_STATUSES.has(state.migration_status);

    if (!canReadModern) {
      return this.legacy[operation](inspectorId, ...args);
    }

    try {
      return await this.modern[operation](inspectorId, ...args);
    } catch (error) {
      if (!state.legacy_fallback_enabled) throw error;
      this.logger.error("Modern label read failed; using legacy fallback", {
        inspector: String(inspectorId),
        operation,
        requested_read_source: state.read_source,
        actual_source: "legacy",
        error: error?.message || String(error),
      });
      return this.legacy[operation](inspectorId, ...args);
    }
  }

  getAllottedLabels(inspectorId, options) {
    return this.read(inspectorId, "getAllottedLabels", options);
  }

  getUsedLabels(inspectorId, options) {
    return this.read(inspectorId, "getUsedLabels", options);
  }

  getRejectedLabels(inspectorId, options) {
    return this.read(inspectorId, "getRejectedLabels", options);
  }

  getAllocationHistory(inspectorId, options) {
    return this.read(inspectorId, "getAllocationHistory", options);
  }

  getUsageHistory(inspectorId, options) {
    return this.read(inspectorId, "getUsageHistory", options);
  }

  getSummary(inspectorId, options) {
    return this.read(inspectorId, "getSummary", options);
  }

  async recordSyncFailure(inspectorId, operation, payload, error) {
    try {
      await this.syncFailureModel.create({
        inspector: inspectorId,
        operation,
        payload: payload || {},
        error: {
          message: error?.message || String(error),
          stack: String(error?.stack || ""),
        },
        attempts: 1,
        last_attempt_at: new Date(),
      });
    } catch (recordError) {
      this.logger.error("Label mirror failure could not be recorded", {
        inspector: String(inspectorId),
        operation,
        error: recordError?.message || String(recordError),
      });
    }
  }

  async write(
    inspectorId,
    operation,
    { legacyWrite, modernWrite, payload = {} } = {},
  ) {
    const state = await this.getState(inspectorId);

    if (state.write_mode === "modern") {
      return modernWrite();
    }
    if (state.write_mode !== "dual") {
      return legacyWrite();
    }

    const legacyResult = await legacyWrite();
    try {
      await modernWrite();
    } catch (error) {
      this.logger.error("Modern label mirror write failed", {
        inspector: String(inspectorId),
        operation,
        requested_write_mode: state.write_mode,
        actual_source: "legacy",
        error: error?.message || String(error),
      });
      await this.recordSyncFailure(inspectorId, operation, payload, error);
    }
    return legacyResult;
  }
}

module.exports = new LabelStorageService();
module.exports.DEFAULT_LABEL_STORAGE_STATE = DEFAULT_LABEL_STORAGE_STATE;
module.exports.LabelStorageService = LabelStorageService;
module.exports.isSafePreCutoverStorageState = isSafePreCutoverStorageState;
