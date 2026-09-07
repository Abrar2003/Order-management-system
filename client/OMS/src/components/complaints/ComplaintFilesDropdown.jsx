import { useState } from "react";
import { createPortal } from "react-dom";
import FilePreviewModal from "../FilePreviewModal";
import {
  formatComplaintDateTime,
  getFileTypeLabel,
  isComplaintImageFile,
} from "./complaintConstants";

const ComplaintFilesDropdown = ({ files = [] }) => {
  const [previewFile, setPreviewFile] = useState(null);
  const safeFiles = Array.isArray(files) ? files : [];

  if (safeFiles.length === 0) {
    return <span className="text-secondary small">No files uploaded.</span>;
  }

  return (
    <div className="complaint-file-list">
      {safeFiles.map((file, index) => (
        <a
          key={file._id || `${file.key || "file"}-${index}`}
          className={`complaint-file-link${isComplaintImageFile(file) ? " complaint-file-link--image" : ""}`}
          href={file.url || "#"}
          onClick={(event) => {
            if (isComplaintImageFile(file) && file.url) {
              event.preventDefault();
              event.stopPropagation();
              setPreviewFile(file);
            }
          }}
          target="_blank"
          rel="noreferrer"
        >
          {isComplaintImageFile(file) && file.url && (
            <img
              className="complaint-file-thumbnail"
              src={file.url}
              alt={file.original_name || file.file_name || "Complain file"}
              loading="lazy"
            />
          )}
          <span className="complaint-file-meta">
            <span className="fw-semibold">{file.original_name || file.file_name || "File"}</span>
            <span className="badge text-bg-light border text-secondary">
              {getFileTypeLabel(file)}
            </span>
            <span className="small text-secondary">
              Uploaded by {file.uploaded_by?.name || "Unknown"} on{" "}
              {formatComplaintDateTime(file.uploaded_at)}
            </span>
          </span>
        </a>
      ))}
      {previewFile && createPortal(
        <FilePreviewModal
          title="Complaint Image"
          originalName={previewFile.original_name || previewFile.file_name}
          url={previewFile.url}
          previewMode="image"
          modalClassName="thumbnail-image-preview-modal"
          onClose={() => setPreviewFile(null)}
        />,
        document.body,
      )}
    </div>
  );
};

export default ComplaintFilesDropdown;
