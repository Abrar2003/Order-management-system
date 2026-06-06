import { useNavigate } from "react-router-dom";
import { getNotificationCard } from "./notificationCard";

const getToastClassName = (priority = "") =>
  [
    "om-notification-toast",
    priority === "critical" ? "om-notification-toast--critical" : "",
    priority === "high" ? "om-notification-toast--high" : "",
  ].filter(Boolean).join(" ");

const NotificationToast = ({ notification, onClose }) => {
  const navigate = useNavigate();
  if (!notification) return null;
  const card = getNotificationCard(notification);

  return (
    <button
      type="button"
      className={getToastClassName(card.priority)}
      onClick={() => {
        onClose?.();
        if (card.deepLink) navigate(card.deepLink);
      }}
    >
      <span className="om-notification-toast-dot" />
      <span className="om-notification-toast-copy">
        <strong>{card.heading}</strong>
        <span>{card.taskTitle || notification.message}</span>
      </span>
    </button>
  );
};

export default NotificationToast;
