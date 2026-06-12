import ComplaintFilesDropdown from "./ComplaintFilesDropdown";
import { formatComplaintDateTime } from "./complaintConstants";

const ComplaintAccordionDetails = ({ complaint }) => {
  const comments = Array.isArray(complaint?.comments) ? complaint.comments : [];

  return (
    <div className="complaint-details-panel">
      <div className="complaint-details-grid">
        <div>
          <div className="small text-secondary">Complain No</div>
          <div className="fw-semibold">{complaint?.complaint_no || "N/A"}</div>
        </div>
        <div>
          <div className="small text-secondary">Item Code</div>
          <div className="fw-semibold">{complaint?.item_code || "N/A"}</div>
        </div>
        <div>
          <div className="small text-secondary">Brand</div>
          <div>{complaint?.brand || "N/A"}</div>
        </div>
        <div>
          <div className="small text-secondary">Vendor</div>
          <div>{complaint?.vendor || "N/A"}</div>
        </div>
        <div>
          <div className="small text-secondary">PO</div>
          <div>{complaint?.po || "N/A"}</div>
        </div>
        <div>
          <div className="small text-secondary">Category</div>
          <div>{complaint?.category || "N/A"}</div>
        </div>
        <div>
          <div className="small text-secondary">Created By</div>
          <div>{complaint?.created_by?.name || "N/A"}</div>
        </div>
        <div>
          <div className="small text-secondary">Created At</div>
          <div>{formatComplaintDateTime(complaint?.created_at)}</div>
        </div>
        <div>
          <div className="small text-secondary">Updated At</div>
          <div>{formatComplaintDateTime(complaint?.updated_at)}</div>
        </div>
      </div>

      <div className="complaint-detail-section">
        <h4 className="h6 mb-2">Comments</h4>
        {comments.length === 0 ? (
          <div className="text-secondary small">No comments added.</div>
        ) : (
          <div className="complaint-timeline">
            {comments.map((entry, index) => (
              <div className="complaint-timeline-entry" key={entry._id || `comment-${index}`}>
                <div>{entry.comment}</div>
                <div className="small text-secondary">
                  {entry.created_by?.name || "Unknown"} · {formatComplaintDateTime(entry.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="complaint-detail-section">
        <h4 className="h6 mb-2">Files</h4>
        <ComplaintFilesDropdown files={complaint?.files} />
      </div>
    </div>
  );
};

export default ComplaintAccordionDetails;
