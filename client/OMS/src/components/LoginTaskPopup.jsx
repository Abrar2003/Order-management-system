import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api/axios";
import { usePermissions } from "../auth/PermissionContext";
import { getRemainingTasks } from "../utils/loginTaskPopup";

const ACKNOWLEDGEMENT_DELAY_SECONDS = 3;
const LOGIN_PATHS = new Set(["/signin", "/choose-brand-scope"]);
const formatCount = new Intl.NumberFormat("en-IN");

const LoginTaskPopup = () => {
  const { pathname } = useLocation();
  const { loading } = usePermissions();
  const loadedForSession = useRef(false);
  const [tasks, setTasks] = useState([]);
  const [open, setOpen] = useState(false);
  const [seconds, setSeconds] = useState(ACKNOWLEDGEMENT_DELAY_SECONDS);

  useEffect(() => {
    if (LOGIN_PATHS.has(pathname)) {
      loadedForSession.current = false;
      setOpen(false);
      return undefined;
    }
    if (loading || loadedForSession.current) return undefined;

    let active = true;
    loadedForSession.current = true;
    api.get("/employee-report/me").then((response) => {
      const remaining = getRemainingTasks(response?.data?.tasks);
      if (!active) return;
      setTasks(remaining);
      setSeconds(ACKNOWLEDGEMENT_DELAY_SECONDS);
      setOpen(true);
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, [loading, pathname]);

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
