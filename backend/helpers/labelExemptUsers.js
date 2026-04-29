const LABEL_EXEMPT_USER_ENV_KEYS = Object.freeze([
  "LabelExemptUsers",
  "LABEL_EXEMPT_USERS",
]);

const LABEL_EXEMPT_QC_ALLOWED_PAST_DAYS = 5;

const normalizeUserId = (value = "") => String(value || "").trim();

const parseUserIdList = (value = "") =>
  [...new Set(
    String(value || "")
      .split(",")
      .map((entry) => normalizeUserId(entry))
      .filter(Boolean),
  )];

const LABEL_EXEMPT_USER_IDS = Object.freeze(
  LABEL_EXEMPT_USER_ENV_KEYS.flatMap((envKey) =>
    parseUserIdList(process.env[envKey]),
  ),
);

const LABEL_EXEMPT_USER_ID_SET = new Set(LABEL_EXEMPT_USER_IDS);

const isLabelExemptUser = (userId = "") =>
  LABEL_EXEMPT_USER_ID_SET.has(normalizeUserId(userId));

module.exports = {
  LABEL_EXEMPT_QC_ALLOWED_PAST_DAYS,
  LABEL_EXEMPT_USER_IDS,
  isLabelExemptUser,
  normalizeUserId,
  parseUserIdList,
};
