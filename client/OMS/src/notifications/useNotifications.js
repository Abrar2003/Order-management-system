import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  archiveNotification,
  getNotificationLoginSummary,
  getNotificationSummary,
  getNotifications,
  markAllNotificationsRead,
  markNotificationPopupSeen,
  markNotificationRead,
} from "./notificationApi";
import { getToken } from "../auth/auth.service";
import { connectNotificationSocket, leaveNotificationSocket } from "./notificationSocket";

const DEFAULT_LIMIT = 20;
const POPUP_ACK_PREFIX = "oms_notification_popup_ack";

export const NOTIFICATION_TABS = Object.freeze([
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "task", label: "Tasks", category: "task" },
  { key: "approval", label: "Approvals", category: "approval" },
  { key: "upload", label: "Uploads", category: "upload" },
  { key: "hold", label: "Holds", category: "hold" },
  { key: "comment", label: "Comments", category: "comment" },
  { key: "critical", label: "Critical", priority: "critical" },
]);

const normalizeText = (value) => String(value || "").trim();

const getPopupAckKey = () => {
  const token = normalizeText(getToken());
  return `${POPUP_ACK_PREFIX}:${token || "anonymous"}`;
};

const getTabParams = (tabKey) => {
  const tab = NOTIFICATION_TABS.find((entry) => entry.key === tabKey) || NOTIFICATION_TABS[0];
  return {
    unreadOnly: tab.key === "unread" ? "true" : undefined,
    category: tab.category,
    priority: tab.priority,
  };
};

export const useNotifications = ({ enabled = true } = {}) => {
  const [dockOpen, setDockOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [notifications, setNotifications] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, totalRecords: 0 });
  const [summary, setSummary] = useState(null);
  const [popupSummary, setPopupSummary] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const toastTimerRef = useRef(null);

  const unreadCount = Number(summary?.unreadCount || 0);

  const loadSummary = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await getNotificationSummary();
      setSummary(response?.data || null);
    } catch {
      setSummary(null);
    }
  }, [enabled]);

  const loadNotifications = useCallback(async ({ page = 1, append = false } = {}) => {
    if (!enabled) return;
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);
    setError("");
    try {
      const response = await getNotifications({
        page,
        limit: DEFAULT_LIMIT,
        ...getTabParams(activeTab),
      });
      const rows = Array.isArray(response?.data) ? response.data : [];
      setNotifications((current) => append ? [...current, ...rows] : rows);
      setPagination({
        page: Number(response?.pagination?.page || 1),
        totalPages: Number(response?.pagination?.totalPages || 1),
        totalRecords: Number(response?.pagination?.totalRecords || 0),
      });
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message ||
        loadError?.message ||
        "Failed to load notifications.",
      );
    } finally {
      setBusy(false);
    }
  }, [activeTab, enabled]);

  const loadPopupSummary = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await getNotificationLoginSummary();
      const data = response?.data || null;
      if (data?.showPopup && globalThis.sessionStorage?.getItem(getPopupAckKey()) === "true") {
        setPopupSummary({ ...data, showPopup: false });
        return;
      }
      setPopupSummary(data);
    } catch {
      setPopupSummary(null);
    }
  }, [enabled]);

  useEffect(() => {
    loadSummary();
    loadPopupSummary();
  }, [loadPopupSummary, loadSummary]);

  useEffect(() => {
    if (popupSummary?.showPopup) {
      setDockOpen(false);
    }
  }, [popupSummary?.showPopup]);

  useEffect(() => {
    if (dockOpen) {
      loadNotifications({ page: 1 });
    }
  }, [activeTab, dockOpen, loadNotifications]);

  useEffect(() => {
    if (!enabled) return undefined;
    const socket = connectNotificationSocket();

    const handleNewNotification = (payload) => {
      if (!payload?._id) return;
      setNotifications((current) =>
        current.some((entry) => entry._id === payload._id)
          ? current
          : [payload, ...current],
      );
      if (payload.priority !== "silent") {
        setToast(payload);
        if (toastTimerRef.current) globalThis.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = globalThis.setTimeout(() => setToast(null), 2000);
      }
    };

    const handleUnreadCount = (payload) => {
      setSummary((current) => ({
        ...(current || {}),
        unreadCount: Number(payload?.unreadCount || 0),
      }));
    };

    const handleSummaryUpdated = () => {
      loadSummary();
    };

    socket.on("notification:new", handleNewNotification);
    socket.on("notification:unread_count", handleUnreadCount);
    socket.on("notification:summary_updated", handleSummaryUpdated);

    return () => {
      leaveNotificationSocket(socket);
      socket.off("notification:new", handleNewNotification);
      socket.off("notification:unread_count", handleUnreadCount);
      socket.off("notification:summary_updated", handleSummaryUpdated);
      if (toastTimerRef.current) globalThis.clearTimeout(toastTimerRef.current);
    };
  }, [enabled, loadSummary]);

  const markRead = useCallback(async (notification) => {
    if (!notification?._id || notification.read) return notification;
    const response = await markNotificationRead(notification._id);
    const updated = response?.data || { ...notification, read: true };
    setNotifications((current) =>
      current.map((entry) => entry._id === notification._id ? { ...entry, ...updated, read: true } : entry),
    );
    setSummary((current) => ({
      ...(current || {}),
      unreadCount: Math.max(0, Number(current?.unreadCount || 0) - 1),
    }));
    return updated;
  }, []);

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    setNotifications((current) => current.map((entry) => ({ ...entry, read: true })));
    setSummary((current) => ({ ...(current || {}), unreadCount: 0 }));
  }, []);

  const archive = useCallback(async (notification) => {
    if (!notification?._id) return;
    await archiveNotification(notification._id);
    setNotifications((current) => current.filter((entry) => entry._id !== notification._id));
    if (!notification.read) {
      setSummary((current) => ({
        ...(current || {}),
        unreadCount: Math.max(0, Number(current?.unreadCount || 0) - 1),
      }));
    }
  }, []);

  const acknowledgePopup = useCallback(async () => {
    await markNotificationPopupSeen();
    globalThis.sessionStorage?.setItem(getPopupAckKey(), "true");
    setPopupSummary((current) => ({ ...(current || {}), showPopup: false }));
  }, []);

  const hasMore = pagination.page < pagination.totalPages;

  return useMemo(() => ({
    acknowledgePopup,
    activeTab,
    archive,
    dockOpen,
    error,
    hasMore,
    list: notifications,
    loadMore: () => hasMore && loadNotifications({ page: pagination.page + 1, append: true }),
    loading,
    loadingMore,
    markAllRead,
    markRead,
    popupSummary,
    refreshList: () => loadNotifications({ page: 1 }),
    refreshSummary: loadSummary,
    setActiveTab,
    setDockOpen,
    summary,
    toast,
    unreadCount,
    closeToast: () => setToast(null),
  }), [
    acknowledgePopup,
    activeTab,
    archive,
    dockOpen,
    error,
    hasMore,
    loadNotifications,
    loadSummary,
    loading,
    loadingMore,
    markAllRead,
    markRead,
    notifications,
    pagination.page,
    popupSummary,
    summary,
    toast,
    unreadCount,
  ]);
};

export const getPriorityLabel = (priority = "") => normalizeText(priority || "normal");
