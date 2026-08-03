const QC_USER_UPDATE_WINDOW_MS = 60 * 60 * 1000;
const QC_USER_MAX_UPDATES = 3;

const getId = (value) => String(value?._id || value || "").trim();

const getQcUserInspectionUpdateAllowance = ({
  inspectionRecord = {},
  userId = "",
  now = new Date(),
  hasExistingUpdate = false,
} = {}) => {
  const recordInspectorId = getId(inspectionRecord?.inspector);
  const currentUserId = getId(userId);
  if (!currentUserId || !recordInspectorId || recordInspectorId !== currentUserId) {
    return {
      isAvailable: false,
      reason: "QC users can update only their own inspection record.",
      currentUpdateCount: 0,
      windowStartedAt: null,
    };
  }

  const storedCount = Math.max(0, Math.floor(Number(inspectionRecord?.qc_update_count) || 0));
  const currentUpdateCount = storedCount || (hasExistingUpdate ? 1 : 0);
  if (currentUpdateCount === 0) {
    return {
      isAvailable: true,
      reason: "",
      currentUpdateCount,
      remainingUpdates: QC_USER_MAX_UPDATES,
      windowStartedAt: null,
    };
  }

  const windowStartedAt = new Date(
    inspectionRecord?.qc_update_window_started_at ||
      inspectionRecord?.updatedAt ||
      inspectionRecord?.createdAt,
  );
  if (Number.isNaN(windowStartedAt.getTime())) {
    return {
      isAvailable: false,
      reason: "QC update window is invalid.",
      currentUpdateCount,
      windowStartedAt: null,
    };
  }

  if (currentUpdateCount >= QC_USER_MAX_UPDATES) {
    return {
      isAvailable: false,
      reason: "This inspection record has reached the 3-update limit.",
      currentUpdateCount,
      windowStartedAt,
    };
  }

  if (now.getTime() - windowStartedAt.getTime() >= QC_USER_UPDATE_WINDOW_MS) {
    return {
      isAvailable: false,
      reason: "The 1-hour QC update window has expired.",
      currentUpdateCount,
      windowStartedAt,
    };
  }

  return {
    isAvailable: true,
    reason: "",
    currentUpdateCount,
    remainingUpdates: QC_USER_MAX_UPDATES - currentUpdateCount,
    windowStartedAt,
  };
};

module.exports = {
  QC_USER_MAX_UPDATES,
  QC_USER_UPDATE_WINDOW_MS,
  getQcUserInspectionUpdateAllowance,
};
