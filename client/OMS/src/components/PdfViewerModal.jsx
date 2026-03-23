import { useEffect } from "react";

const PdfViewerModal = ({
  title = "PDF Preview",
  url = "",
  originalName = "",
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    document.body.classList.add("modal-open");
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const resolvedTitle = String(title || "PDF Preview").trim() || "PDF Preview";
  const resolvedName = String(originalName || "").trim();

  return (
    <div
      className="modal d-block om-modal-backdrop"
      tabIndex="-1"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
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
            {url ? (
              <iframe
                title={resolvedTitle}
                src={url}
                style={{
                  width: "100%",
                  height: "80vh",
                  border: 0,
                  backgroundColor: "#f8f9fa",
                }}
              />
            ) : (
              <div className="p-4 text-center text-muted">
                PDF URL is not available.
              </div>
            )}
          </div>
          <div className="modal-footer">
            {url && (
              <a
                href={url}
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

export default PdfViewerModal;
