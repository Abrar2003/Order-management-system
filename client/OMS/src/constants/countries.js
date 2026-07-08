const normalizeCountryValue = (value = "") => String(value || "").trim();

export const COUNTRY_OPTIONS = Object.freeze([
  { value: "India", label: "India" },
  { value: "China", label: "China" },
  { value: "Vietnam", label: "Vietnam" },
]);

export const getCountryOptions = (currentValue = "") => {
  const normalizedCurrentValue = normalizeCountryValue(currentValue);
  if (!normalizedCurrentValue) return COUNTRY_OPTIONS;

  const alreadyListed = COUNTRY_OPTIONS.some(
    (option) => option.value === normalizedCurrentValue,
  );
  if (alreadyListed) return COUNTRY_OPTIONS;

  return [
    { value: normalizedCurrentValue, label: normalizedCurrentValue },
    ...COUNTRY_OPTIONS,
  ];
};

export { normalizeCountryValue };
