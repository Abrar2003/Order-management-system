import { useNavigate } from "react-router-dom";

const getToastClassName = (priority = "") =>
  [
    "om-notification-toast",
    priority === "critical" ? "om-notification-toast--critical" : "",
    priority === "high" ? "om-notification-toast--high" : "",
  ].filter(Boolean).join(" ");

const NotificationToast = ({ notification, onClose }) => {
  const navigate = useNavigate();
  if (!notification) return null;

  return (
    <button
      type="button"
      className={getToastClassName(notification.priority)}
      onClick={() => {
        onClose?.();
        if (notification.deep_link) navigate(notification.deep_link);
      }}
    >
      <span className="om-notification-toast-dot" />
      <span className="om-notification-toast-copy">
        <strong>{notification.title}</strong>
        <span>{notification.message}</span>
      </span>
    </button>
  );
};

export default NotificationToast;
