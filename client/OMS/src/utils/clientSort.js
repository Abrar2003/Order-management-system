const sortCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export const normalizeClientSortDirection = (direction) =>
  String(direction || "").trim().toLowerCase() === "desc" ? "desc" : "asc";

const normalizeComparableSortValue = (value) => {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparableSortValue(entry)).join(" | ");
  }
  if (typeof value === "object") {
    if (typeof value.valueOf === "function") {
      const primitiveValue = value.valueOf();
      if (primitiveValue !== value) {
        return normalizeComparableSortValue(primitiveValue);
      }
    }
    return JSON.stringify(value);
  }
  return String(value).trim();
};

export const compareClientSortValues = (leftValue, rightValue) => {
  const normalizedLeft = normalizeComparableSortValue(leftValue);
  const normalizedRight = normalizeComparableSortValue(rightValue);
  const leftIsBlank =
    normalizedLeft == null
    || (typeof normalizedLeft === "string" && !normalizedLeft.trim());
  const rightIsBlank =
    normalizedRight == null
    || (typeof normalizedRight === "string" && !normalizedRight.trim());

  if (leftIsBlank && rightIsBlank) return 0;
  if (leftIsBlank) return 1;
  if (rightIsBlank) return -1;

  if (
    typeof normalizedLeft === "number"
    && typeof normalizedRight === "number"
  ) {
    return normalizedLeft - normalizedRight;
  }

  return sortCollator.compare(String(normalizedLeft), String(normalizedRight));
};

export const sortClientRows = (
  rows = [],
  {
    sortBy = "",
    sortOrder = "asc",
    getSortValue,
  } = {},
) => {
  if (!Array.isArray(rows) || typeof getSortValue !== "function" || !sortBy) {
    return Array.isArray(rows) ? rows : [];
  }

  const directionMultiplier =
    normalizeClientSortDirection(sortOrder) === "desc" ? -1 : 1;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((leftEntry, rightEntry) => {
      const comparedValue =
        compareClientSortValues(
          getSortValue(leftEntry.row, sortBy),
          getSortValue(rightEntry.row, sortBy),
        ) * directionMultiplier;

      if (comparedValue !== 0) return comparedValue;
      return leftEntry.index - rightEntry.index;
    })
    .map(({ row }) => row);
};

export const getNextClientSortState = (
  currentSortBy,
  currentSortOrder,
  nextSortBy,
  defaultDirection = "asc",
) => {
  if (currentSortBy === nextSortBy) {
    return {
      sortBy: nextSortBy,
      sortOrder:
        normalizeClientSortDirection(currentSortOrder) === "asc"
          ? "desc"
          : "asc",
    };
  }

  return {
    sortBy: nextSortBy,
    sortOrder: normalizeClientSortDirection(defaultDirection),
  };
};
