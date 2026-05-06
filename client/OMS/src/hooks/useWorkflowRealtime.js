import { useEffect, useRef, useState } from "react";
import { connectWorkflowSocket } from "../realtime/socket";

const normalizeText = (value) => String(value || "").trim();
const ROOM_JOIN_TIMEOUT_MS = 4000;

const emitWithAck = (socket, eventName, payload, timeoutMs = ROOM_JOIN_TIMEOUT_MS) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timerId = globalThis.setTimeout(() => {
      finish({
        success: false,
        message: `${eventName} timed out`,
      });
    }, timeoutMs);

    const acknowledge = (response = {}) => {
      globalThis.clearTimeout(timerId);
      finish({
        success: response?.success !== false,
        message: response?.message || "",
      });
    };

    if (payload === undefined) {
      socket.emit(eventName, acknowledge);
      return;
    }

    socket.emit(eventName, payload, acknowledge);
  });

export const useWorkflowRealtime = ({
  enabled = true,
  joinDashboard = false,
  batchId = "",
  userId = "",
  onTaskUpdated,
  onBatchUpdated,
  onCommentAdded,
} = {}) => {
  const [connectionState, setConnectionState] = useState("offline");
  const onTaskUpdatedRef = useRef(onTaskUpdated);
  const onBatchUpdatedRef = useRef(onBatchUpdated);
  const onCommentAddedRef = useRef(onCommentAdded);
  const hasSyncedRef = useRef(false);

  useEffect(() => {
    onTaskUpdatedRef.current = onTaskUpdated;
  }, [onTaskUpdated]);

  useEffect(() => {
    onBatchUpdatedRef.current = onBatchUpdated;
  }, [onBatchUpdated]);

  useEffect(() => {
    onCommentAddedRef.current = onCommentAdded;
  }, [onCommentAdded]);

  useEffect(() => {
    if (!enabled) {
      setConnectionState("offline");
      hasSyncedRef.current = false;
      return undefined;
    }

    const socket = connectWorkflowSocket();
    const normalizedBatchId = normalizeText(batchId);
    const normalizedUserId = normalizeText(userId);

    const syncCurrentView = () => {
      const callbacks = [
        onTaskUpdatedRef.current,
        onBatchUpdatedRef.current,
      ].filter(Boolean);

      [...new Set(callbacks)].forEach((callback) => {
        callback?.({
          reason: "realtime_sync",
        });
      });
    };

    const joinRooms = async () => {
      const joinRequests = [];
      if (joinDashboard) {
        joinRequests.push(emitWithAck(socket, "workflow:join_dashboard"));
      }
      if (normalizedBatchId) {
        joinRequests.push(
          emitWithAck(socket, "workflow:join_batch", normalizedBatchId),
        );
      }
      if (normalizedUserId) {
        joinRequests.push(
          emitWithAck(socket, "workflow:join_user", normalizedUserId),
        );
      }

      const results = await Promise.all(joinRequests);
      const failedJoin = results.find((result) => result?.success === false);
      if (failedJoin) {
        throw new Error(failedJoin.message || "Failed to join workflow realtime room");
      }
    };

    const handleConnect = async () => {
      setConnectionState("reconnecting");
      try {
        await joinRooms();
        setConnectionState("live");
        if (hasSyncedRef.current) {
          syncCurrentView();
          return;
        }

        hasSyncedRef.current = true;
        syncCurrentView();
      } catch (error) {
        console.error("Workflow realtime room join failed:", error);
        setConnectionState("offline");
      }
    };

    const handleDisconnect = () => {
      setConnectionState("offline");
    };

    const handleReconnectAttempt = () => {
      setConnectionState("reconnecting");
    };

    const handleConnectError = () => {
      setConnectionState("offline");
    };

    const handleTaskUpdated = (payload) => {
      onTaskUpdatedRef.current?.(payload);
    };

    const handleBatchUpdated = (payload) => {
      onBatchUpdatedRef.current?.(payload);
    };

    const handleCommentAdded = (payload) => {
      onCommentAddedRef.current?.(payload);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.io.on("reconnect_attempt", handleReconnectAttempt);
    socket.io.on("reconnect_error", handleConnectError);
    socket.io.on("reconnect_failed", handleConnectError);
    socket.on("workflow:task_updated", handleTaskUpdated);
    socket.on("workflow:batch_updated", handleBatchUpdated);
    socket.on("workflow:comment_added", handleCommentAdded);

    if (socket.connected) {
      void handleConnect();
    } else {
      setConnectionState("reconnecting");
      socket.connect();
    }

    return () => {
      if (normalizedBatchId) {
        socket.emit("workflow:leave_batch", normalizedBatchId);
      }

      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.io.off("reconnect_attempt", handleReconnectAttempt);
      socket.io.off("reconnect_error", handleConnectError);
      socket.io.off("reconnect_failed", handleConnectError);
      socket.off("workflow:task_updated", handleTaskUpdated);
      socket.off("workflow:batch_updated", handleBatchUpdated);
      socket.off("workflow:comment_added", handleCommentAdded);
    };
  }, [batchId, enabled, joinDashboard, userId]);

  return {
    connectionState,
    isLive: connectionState === "live",
  };
};

export default useWorkflowRealtime;
