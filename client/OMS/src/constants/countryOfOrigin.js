const normalizeCountryOfOriginValue = (value = "") => String(value || "").trim();

export const COUNTRY_OF_ORIGIN_OPTIONS = Object.freeze([
  { value: "India", label: "India" },
  { value: "China", label: "China" },
  { value: "Vietnam", label: "Vietnam" },
]);

export const getCountryOfOriginOptions = (currentValue = "") => {
  const normalizedCurrentValue = normalizeCountryOfOriginValue(currentValue);
  if (!normalizedCurrentValue) return COUNTRY_OF_ORIGIN_OPTIONS;

  const alreadyListed = COUNTRY_OF_ORIGIN_OPTIONS.some(
    (option) => option.value === normalizedCurrentValue,
  );
  if (alreadyListed) return COUNTRY_OF_ORIGIN_OPTIONS;

  return [
    { value: normalizedCurrentValue, label: normalizedCurrentValue },
    ...COUNTRY_OF_ORIGIN_OPTIONS,
  ];
};

export { normalizeCountryOfOriginValue };
