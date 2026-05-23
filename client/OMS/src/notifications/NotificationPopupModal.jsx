import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const SECTIONS = Object.freeze([
  { key: "overdueTasks", label: "Overdue Tasks" },
  { key: "todayDueTasks", label: "Today Due Tasks" },
  { key: "approvalPending", label: "Approval Pending" },
  { key: "holdPending", label: "Hold Pending" },
  { key: "uploadPending", label: "Upload Pending" },
  { key: "criticalNotifications", label: "Critical Notifications" },
]);

const taskLink = (entry = {}) =>
  entry.deep_link || (entry._id ? `/workflow/tasks?task=${entry._id}` : "/workflow/tasks");

const NotificationPopupModal = ({ summary, onAcknowledge }) => {
  const navigate = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState(2);

  const visibleSections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        rows: Array.isArray(summary?.[section.key]) ? summary[section.key] : [],
      })).filter((section) => section.rows.length > 0),
    [summary],
  );

  useEffect(() => {
    if (!summary?.showPopup) return undefined;
    setSecondsLeft(2);
    const timerId = globalThis.setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          globalThis.clearInterval(timerId);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => globalThis.clearInterval(timerId);
  }, [summary?.showPopup]);

  if (!summary?.showPopup || visibleSections.length === 0) return null;
  const blocked = secondsLeft > 0;

  return (
    <div className="om-notification-popup-backdrop" role="dialog" aria-modal="true">
      <div className="om-notification-popup">
        <div className="om-notification-popup-header">
          <div>
            <h5 className="mb-1">Workflow Attention</h5>
            <div className="text-secondary small">
              Review high-priority workflow items before continuing.
            </div>
          </div>
        </div>

        <div className="om-notification-popup-body">
          {visibleSections.map((section) => (
            <section key={section.key} className="om-notification-popup-section">
              <div className="om-notification-popup-section-title">
                <strong>{section.label}</strong>
                <span>{section.rows.length}</span>
              </div>
              {section.rows.slice(0, 5).map((entry) => (
                <div key={`${section.key}-${entry._id}`} className="om-notification-popup-row">
                  <div>
                    <strong>{entry.title || entry.message || "Workflow task"}</strong>
                    {entry.message && entry.message !== entry.title && <span>{entry.message}</span>}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    disabled={blocked}
                    onClick={() => navigate(taskLink(entry))}
                  >
                    Open
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="om-notification-popup-footer">
          {blocked && (
            <span className="small text-secondary">
              You can continue in {secondsLeft} second{secondsLeft === 1 ? "" : "s"}...
            </span>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={blocked}
            onClick={onAcknowledge}
          >
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationPopupModal;
