const normalizeText = (value) => String(value || "").trim();

const ProductImageThumbnail = ({
  src = "",
  originalName = "",
  alt = "Product image",
  size = "md",
}) => {
  const imageSrc = normalizeText(src);
  const label = normalizeText(originalName);
  const className = ["product-image-thumbnail", `is-${size}`].filter(Boolean).join(" ");
  const dimension = size === "sm" ? 56 : 72;

  if (!imageSrc) {
    return (
      <div className={`${className} is-empty`} aria-label="No product image">
        <span>No Image</span>
      </div>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={normalizeText(alt) || label || "Product image"}
      title={label || undefined}
      className={className}
      width={dimension}
      height={dimension}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
};

export default ProductImageThumbnail;
