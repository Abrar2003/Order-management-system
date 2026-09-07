import { useState } from "react";
import { createPortal } from "react-dom";
import FilePreviewModal from "./FilePreviewModal";

const PreviewImage = ({ src, alt = "Image", originalName = "", ...props }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="image-preview-trigger"
        aria-label={`Preview ${alt}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <img {...props} src={src} alt={alt} />
      </button>
      {open && createPortal(
        <FilePreviewModal
          title={alt}
          originalName={originalName}
          url={src}
          previewMode="image"
          modalClassName="thumbnail-image-preview-modal"
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  );
};

export default PreviewImage;
