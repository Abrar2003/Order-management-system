import { useNavigate } from "react-router-dom";
import { NOTIFICATION_TABS, getPriorityLabel } from "./useNotifications";
import { getNotificationCard } from "./notificationCard";

const CATEGORY_MARKS = Object.freeze({
  comment: "C",
  system: "S",
});

const formatRelativeTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const NotificationDock = ({
  activeTab,
  archive,
  error,
  hasMore,
  list,
  loadMore,
  loading,
  loadingMore,
  markAllRead,
  markRead,
  onClose,
  setActiveTab,
  summary,
}) => {
  const navigate = useNavigate();

  const openNotification = async (notification) => {
    const card = getNotificationCard(notification);
    await markRead(notification);
    if (card.deepLink) {
      navigate(card.deepLink);
      onClose?.();
    }
  };

  return (
    <div className="om-notification-dock" role="dialog" aria-modal="true" aria-label="Notifications">
      <div className="om-notification-dock-header">
        <div>
          <h5 className="mb-1">Notifications</h5>
          <div className="text-secondary small">
            {Number(summary?.unreadCount || 0)} unread
          </div>
        </div>
        <button type="button" className="btn-close" onClick={onClose} aria-label="Close notifications" />
      </div>

      <div className="om-notification-summary-strip">
        <span>{Number(summary?.unreadCount || 0)} unread notifications</span>
      </div>

      <div className="om-notification-tabs" role="tablist">
        {NOTIFICATION_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "active" : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="om-notification-dock-actions">
        <button type="button" className="btn btn-sm btn-outline-primary" onClick={markAllRead}>
          Mark all read
        </button>
      </div>

      <div className="om-notification-list">
        {loading && (
          <div className="om-notification-skeleton">
            <span />
            <span />
            <span />
          </div>
        )}
        {error && <div className="alert alert-danger py-2">{error}</div>}
        {!loading && !error && list.length === 0 && (
          <div className="om-notification-empty">
            <strong>No notifications</strong>
            <span>You are caught up for this view.</span>
          </div>
        )}
        {list.map((notification) => {
          const card = getNotificationCard(notification);
          return (
            <article
              key={notification._id}
              className={[
                "om-notification-item",
                notification.read ? "" : "unread",
                `om-notification-item--${card.category}`,
                `om-notification-item--priority-${card.priority}`,
              ].filter(Boolean).join(" ")}
            >
              <button
                type="button"
                className="om-notification-item-main"
                onClick={() => openNotification(notification)}
              >
                <span className={`om-notification-category om-notification-category--${card.category}`}>
                  {CATEGORY_MARKS[card.category] || "N"}
                </span>
                <span className="om-notification-copy">
                  <span className="om-notification-title-line">
                    <strong>{card.heading}</strong>
                    <span className={`om-notification-priority om-notification-priority--${card.priority}`}>
                      {getPriorityLabel(card.priority)}
                    </span>
                  </span>
                  {card.body && (
                    <span className="om-notification-card-task">{card.body}</span>
                  )}
                  {card.comment && <span className="om-notification-comment">{card.comment}</span>}
                  <small>{formatRelativeTime(notification.created_at)}</small>
                </span>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-link text-secondary"
                onClick={() => archive(notification)}
              >
                Archive
              </button>
            </article>
          );
        })}
      </div>

      {hasMore && (
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm w-100 mt-2"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
};

export default NotificationDock;
