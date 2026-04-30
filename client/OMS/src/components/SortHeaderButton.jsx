const normalizeSortDirection = (direction) =>
  String(direction || "").trim().toLowerCase() === "desc" ? "desc" : "asc";

const SortHeaderButton = ({
  label,
  isActive = false,
  direction = "asc",
  onClick,
  className = "",
  showNativeTitle = true,
}) => {
  const normalizedDirection = normalizeSortDirection(direction);
  const buttonClassName = [
    "btn btn-link p-0 text-decoration-none text-reset fw-semibold om-sort-header",
    isActive ? "om-sort-header-active" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const sortLabel = isActive
    ? `Sorted ${normalizedDirection === "asc" ? "ascending" : "descending"}`
    : "Sortable";

  return (
    <button
      type="button"
      className={buttonClassName}
      onClick={onClick}
      aria-label={`${label}. ${sortLabel}.`}
      title={showNativeTitle ? `${label} - ${sortLabel}` : undefined}
    >
      <span>{label}</span>
      <span className="om-sort-header-arrows" aria-hidden="true">
        <span
          className={`om-sort-header-arrow ${isActive && normalizedDirection === "asc" ? "active" : ""}`}
        >
          &#9650;
        </span>
        <span
          className={`om-sort-header-arrow ${isActive && normalizedDirection === "desc" ? "active" : ""}`}
        >
          &#9660;
        </span>
      </span>
    </button>
  );
};

export default SortHeaderButton;
