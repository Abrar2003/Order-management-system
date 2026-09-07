import { useEffect, useMemo, useRef } from "react";
import { getFilePreviewSource } from "../constants/itemFiles";

const FilePreviewModal = ({
  title = "File Preview",
  url = "",
  originalName = "",
  previewMode = "pdf",
  modalClassName = "",
  onClose,
}) => {
  const modalRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const wasModalOpen = document.body.classList.contains("modal-open");
    const modal = modalRef.current;
    modal.querySelector("button")?.focus();
    const handleKeyDown = (event) => {
      const previews = document.querySelectorAll("[data-file-preview]");
      if (previews[previews.length - 1] !== modal) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose?.();
      }
      if (event.key === "Tab") {
        const controls = [...modal.querySelectorAll('button, a[href], iframe')];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };

    document.body.classList.add("modal-open");
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      if (!wasModalOpen) document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", handleKeyDown, true);
      previousFocus?.focus();
    };
  }, [onClose]);

  const resolvedTitle = String(title || "File Preview").trim() || "File Preview";
  const resolvedName = String(originalName || "").trim();
  const resolvedUrl = String(url || "").trim();
  const resolvedPreviewMode = String(previewMode || "pdf").trim().toLowerCase() || "pdf";
  const previewSource = useMemo(
    () => getFilePreviewSource({ fileUrl: resolvedUrl, previewMode: resolvedPreviewMode }),
    [resolvedPreviewMode, resolvedUrl],
  );

  return (
    <div
      className={`modal d-block om-modal-backdrop ${modalClassName}`.trim()}
      ref={modalRef}
      data-file-preview=""
      aria-label={resolvedTitle}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose?.();
      }}
      tabIndex="-1"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="modal-dialog modal-dialog-centered modal-xl"
        role="document"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title">{resolvedTitle}</h5>
              {resolvedName && (
                <div className="small text-muted">{resolvedName}</div>
              )}
            </div>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onClose}
            />
          </div>

          <div className="modal-body p-0">
            {!resolvedUrl ? (
              <div className="p-4 text-center text-muted">
                File URL is not available.
              </div>
            ) : resolvedPreviewMode === "image" ? (
              <div className="d-flex justify-content-center align-items-center bg-light" style={{ minHeight: "80vh" }}>
                <img
                  src={resolvedUrl}
                  alt={resolvedName || resolvedTitle}
                  className="img-fluid"
                  style={{ maxHeight: "80vh", objectFit: "contain" }}
                />
              </div>
            ) : previewSource ? (
              <iframe
                title={resolvedTitle}
                src={previewSource}
                style={{
                  width: "100%",
                  height: "80vh",
                  border: 0,
                  backgroundColor: "#f8f9fa",
                }}
              />
            ) : (
              <div className="p-4 text-center text-muted">
                Preview is not available for this file.
              </div>
            )}
          </div>

          <div className="modal-footer">
            {resolvedPreviewMode === "office" && (
              <div className="me-auto small text-muted">
                PowerPoint previews use an embedded Office viewer.
              </div>
            )}
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline-primary"
              >
                Open in New Tab
              </a>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FilePreviewModal;
