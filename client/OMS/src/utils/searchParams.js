const toEntries = (value) => {
  if (value instanceof URLSearchParams) {
    return [...value.entries()];
  }
  return [...new URLSearchParams(value || "").entries()];
};

const sortEntries = (entries) =>
  [...entries].sort(([keyA, valueA], [keyB, valueB]) => {
    if (keyA === keyB) {
      return String(valueA).localeCompare(String(valueB));
    }
    return String(keyA).localeCompare(String(keyB));
  });

const toCanonicalQueryString = (value) => {
  const params = new URLSearchParams();
  const entries = sortEntries(toEntries(value));
  entries.forEach(([key, val]) => params.append(key, val));
  return params.toString();
};

export const areSearchParamsEquivalent = (left, right) =>
  toCanonicalQueryString(left) === toCanonicalQueryString(right);

