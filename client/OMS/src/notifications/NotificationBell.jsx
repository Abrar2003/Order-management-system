import { createPortal } from "react-dom";
import NotificationDock from "./NotificationDock";
import NotificationPopupModal from "./NotificationPopupModal";
import NotificationToast from "./NotificationToast";
import { useNotifications } from "./useNotifications";

const NotificationBell = ({ enabled = true }) => {
  const notifications = useNotifications({ enabled });

  if (!enabled) return null;

  const overlayRoot = typeof document !== "undefined" ? document.body : null;
  const overlays = (
    <>
      {notifications.dockOpen && (
        <div className="om-notification-dock-backdrop" onMouseDown={() => notifications.setDockOpen(false)}>
          <div onMouseDown={(event) => event.stopPropagation()}>
            <NotificationDock
              activeTab={notifications.activeTab}
              archive={notifications.archive}
              error={notifications.error}
              hasMore={notifications.hasMore}
              list={notifications.list}
              loadMore={notifications.loadMore}
              loading={notifications.loading}
              loadingMore={notifications.loadingMore}
              markAllRead={notifications.markAllRead}
              markRead={notifications.markRead}
              onClose={() => notifications.setDockOpen(false)}
              setActiveTab={notifications.setActiveTab}
              summary={notifications.summary}
            />
          </div>
        </div>
      )}

      <NotificationPopupModal
        summary={notifications.popupSummary}
        onAcknowledge={notifications.acknowledgePopup}
      />

      <NotificationToast
        notification={notifications.toast}
        onClose={notifications.closeToast}
      />
    </>
  );

  return (
    <>
      <button
        type="button"
        className="btn btn-outline-primary btn-sm rounded-pill om-notification-bell"
        onClick={() => notifications.setDockOpen(true)}
        aria-label={`Open notifications. ${notifications.unreadCount} unread.`}
      >
        <span aria-hidden="true">!</span>
        <span>Alerts</span>
        {notifications.unreadCount > 0 && (
          <span className="om-notification-badge">
            {notifications.unreadCount > 99 ? "99+" : notifications.unreadCount}
          </span>
        )}
      </button>

      {overlayRoot ? createPortal(overlays, overlayRoot) : overlays}
    </>
  );
};

export default NotificationBell;
