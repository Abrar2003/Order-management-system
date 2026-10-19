import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api/axios";
import { usePermissions } from "../auth/PermissionContext";
import { getUserFromToken } from "../auth/auth.service";
import { getRemainingTasks, getTaskPopupSlot, TASK_POPUP_LOGIN_KEY } from "../utils/loginTaskPopup";

const ACKNOWLEDGEMENT_DELAY_SECONDS = 3;
const LOGIN_PATHS = new Set(["/signin", "/choose-brand-scope"]);
const formatCount = new Intl.NumberFormat("en-IN");

const LoginTaskPopup = () => {
  const { pathname } = useLocation();
  const { loading } = usePermissions();
  const [tasks, setTasks] = useState([]);
  const [open, setOpen] = useState(false);
  const [seconds, setSeconds] = useState(ACKNOWLEDGEMENT_DELAY_SECONDS);

  useEffect(() => {
    if (LOGIN_PATHS.has(pathname)) {
      setOpen(false);
      return undefined;
    }
    if (loading) return undefined;

    let active = true;
    let fetching = false;
    const checkReminder = async () => {
      const userId = getUserFromToken()?.id;
      if (!userId || open || fetching) return;
      // shortcut: History is browser-local; persist server-side if devices must share it.
      const storageKey = `oms:task-popup:last-slot:${userId}`;
      try {
        const isLogin = sessionStorage.getItem(TASK_POPUP_LOGIN_KEY) === userId;
        const slot = getTaskPopupSlot();
        if (!isLogin && (!slot || localStorage.getItem(storageKey) === slot)) return;
        fetching = true;
        const response = await api.get("/employee-report/me");
        if (!active || getUserFromToken()?.id !== userId) return;
        if (!isLogin && getTaskPopupSlot() !== slot) return;
        // A login reminder also covers the current scheduled slot.
        if (!isLogin && localStorage.getItem(storageKey) === slot) return;
        if (slot) localStorage.setItem(storageKey, slot);
        sessionStorage.removeItem(TASK_POPUP_LOGIN_KEY);
        const remaining = getRemainingTasks(response?.data?.tasks);
        setTasks(remaining);
        setSeconds(ACKNOWLEDGEMENT_DELAY_SECONDS);
        setOpen(remaining.length > 0);
      } catch {
        // Skip unavailable reports or storage and retry on the next check.
      } finally {
        fetching = false;
      }
    };
    checkReminder();
    const timer = window.setInterval(checkReminder, 60_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loading, pathname, open]);

  useEffect(() => {
    if (!open || seconds === 0) return undefined;
    const timer = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, seconds]);

  if (!open) return null;

  return (
    <div
      className="om-notification-popup-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-task-popup-title"
    >
      <div className="om-notification-popup">
        <div className="om-notification-popup-header">
          <div>
            <h5 id="login-task-popup-title" className="mb-1">Remaining tasks</h5>
            <div className="text-secondary small">Please review your outstanding work.</div>
          </div>
        </div>
        <div className="om-notification-popup-body">
          {tasks.length === 0 && (
            <div className="text-secondary">No remaining tasks.</div>
          )}
          {tasks.map((task) => {
            const pending = Math.max(0, Number(task.pending_count) || 0);
            const total = Math.max(pending, Number(task.total_count) || 0);
            const completed = total - pending;
            return (
              <div key={task.key} className="om-notification-popup-row">
                <div>
                  <strong>{task.label}</strong>
                  <small>{formatCount.format(pending)} remaining · {formatCount.format(completed)} completed · {formatCount.format(total)} total</small>
                </div>
                <div className="text-end">
                  <strong className="fs-3 lh-1">{formatCount.format(pending)}</strong>
                  <small className="text-uppercase fw-semibold">Pending</small>
                </div>
              </div>
            );
          })}
        </div>
        <div className="om-notification-popup-footer">
          <span className="small text-secondary">
            {seconds > 0 ? `You can acknowledge in ${seconds} second${seconds === 1 ? "" : "s"}...` : ""}
          </span>
          <button type="button" className="btn btn-primary" disabled={seconds > 0} onClick={() => setOpen(false)}>
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginTaskPopup;
