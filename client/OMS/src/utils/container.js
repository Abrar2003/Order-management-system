export const CONTAINER_NUMBER_REGEX = /^[A-Za-z]{4}-\d{6}-\d{1}$/;

export const CONTAINER_FORMAT_ERROR_MESSAGE =
  "Container number must be in the format 'AAAA-111111-2' (4 letters, hyphen, 6 digits, hyphen, 1 digit).";

export const isValidContainerNumber = (value) => {
  const normalized = String(value || "").trim();
  return CONTAINER_NUMBER_REGEX.test(normalized);
};
