import { isAdminLikeRole, isManagerLikeRole, normalizeUserRole } from "../auth/permissions";

const MANAGER_ALLOWED_PAST_DAYS = 2;
const QC_ALLOWED_PAST_DAYS = 1;
const LABEL_EXEMPT_QC_ALLOWED_PAST_DAYS = 5;

const UPDATE_QC_PAST_DAYS_OVERRIDE_BY_USER = Object.freeze({
  "6993ff47473290fa1cf76b65": 3,
});

const normalizeUserId = (value = "") => String(value || "").trim();

const parseUserIdList = (value = "") =>
  [...new Set(
    String(value || "")
      .split(",")
      .map((entry) => normalizeUserId(entry))
      .filter(Boolean),
  )];

const LABEL_EXEMPT_USERS = new Set(
  parseUserIdList(
    import.meta.env.LabelExemptUsers ||
      import.meta.env.LABEL_EXEMPT_USERS ||
      import.meta.env.VITE_LabelExemptUsers ||
      import.meta.env.VITE_LABEL_EXEMPT_USERS ||
      "",
  ),
);

export const isLabelExemptUser = (userId = "") =>
  LABEL_EXEMPT_USERS.has(normalizeUserId(userId));

export const getUpdateQcPastDaysLimit = ({
  role = "",
  userId = "",
} = {}) => {
  const normalizedUserId = normalizeUserId(userId);
  if (isLabelExemptUser(normalizedUserId)) {
    return LABEL_EXEMPT_QC_ALLOWED_PAST_DAYS;
  }

  const override = UPDATE_QC_PAST_DAYS_OVERRIDE_BY_USER[normalizedUserId];
  if (Number.isInteger(override) && override >= 0) {
    return override;
  }

  const normalizedRole = normalizeUserRole(role);
  if (!isAdminLikeRole(normalizedRole) && isManagerLikeRole(normalizedRole)) {
    return MANAGER_ALLOWED_PAST_DAYS;
  }
  if (normalizedRole === "qc") return QC_ALLOWED_PAST_DAYS;
  return 0;
};

export const buildUpdateQcPastDaysMessage = (role = "", daysBack = 0) => {
  const normalizedRole = normalizeUserRole(role);
  const actorLabel =
    !isAdminLikeRole(normalizedRole) && isManagerLikeRole(normalizedRole)
      ? "Manager"
      : "QC";
  const safeDaysBack =
    Number.isInteger(daysBack) && daysBack >= 0 ? daysBack : 0;
  const dayLabel = safeDaysBack === 1 ? "day" : "days";
  return `${actorLabel} can update QC only for today and previous ${safeDaysBack} ${dayLabel}.`;
};
