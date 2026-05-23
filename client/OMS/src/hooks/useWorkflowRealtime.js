import { useEffect, useRef, useState } from "react";
import { connectWorkflowSocket } from "../realtime/workflowSocket";

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
  onTaskCreated,
  onTaskUpdated,
  onTaskDeleted,
  onBatchUpdated,
  onCommentAdded,
  onForceRefetch,
  onSyncRequired,
} = {}) => {
  const [connectionState, setConnectionState] = useState("disconnected");
  const callbackRefs = useRef({
    onTaskCreated,
    onTaskUpdated,
    onTaskDeleted,
    onBatchUpdated,
    onCommentAdded,
    onForceRefetch,
    onSyncRequired,
  });
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    callbackRefs.current = {
      onTaskCreated,
      onTaskUpdated,
      onTaskDeleted,
      onBatchUpdated,
      onCommentAdded,
      onForceRefetch,
      onSyncRequired,
    };
  }, [
    onBatchUpdated,
    onCommentAdded,
    onForceRefetch,
    onSyncRequired,
    onTaskCreated,
    onTaskDeleted,
    onTaskUpdated,
  ]);

  useEffect(() => {
    if (!enabled) {
      setConnectionState("disconnected");
      hasConnectedRef.current = false;
      return undefined;
    }

    const socket = connectWorkflowSocket();
    const normalizedBatchId = normalizeText(batchId);
    const normalizedUserId = normalizeText(userId);

    const joinRooms = async () => {
      const joinRequests = [];
      if (joinDashboard) {
        joinRequests.push(emitWithAck(socket, "workflow:join_dashboard"));
      }
      if (normalizedBatchId) {
        joinRequests.push(emitWithAck(socket, "workflow:join_batch", normalizedBatchId));
      }
      if (normalizedUserId) {
        joinRequests.push(emitWithAck(socket, "workflow:join_user", normalizedUserId));
      }

      const results = await Promise.all(joinRequests);
      const failedJoin = results.find((result) => result?.success === false);
      if (failedJoin) {
        throw new Error(failedJoin.message || "Failed to join workflow realtime room");
      }
    };

    const syncCurrentView = (reason) => {
      callbackRefs.current.onSyncRequired?.({
        reason,
      });
    };

    const handleConnect = async () => {
      setConnectionState("connecting");
      try {
        await joinRooms();
        setConnectionState("live");
        if (hasConnectedRef.current) {
          syncCurrentView("reconnected");
        }
        hasConnectedRef.current = true;
      } catch (error) {
        console.error("Workflow realtime room join failed:", error);
        setConnectionState("error");
      }
    };

    const handleDisconnect = () => {
      setConnectionState("disconnected");
    };

    const handleReconnectAttempt = () => {
      setConnectionState("connecting");
    };

    const handleConnectError = () => {
      setConnectionState("error");
    };

    const handleTaskCreated = (payload) => callbackRefs.current.onTaskCreated?.(payload);
    const handleTaskUpdated = (payload) => callbackRefs.current.onTaskUpdated?.(payload);
    const handleTaskDeleted = (payload) => callbackRefs.current.onTaskDeleted?.(payload);
    const handleBatchUpdated = (payload) => callbackRefs.current.onBatchUpdated?.(payload);
    const handleCommentAdded = (payload) => callbackRefs.current.onCommentAdded?.(payload);
    const handleForceRefetch = (payload) => {
      callbackRefs.current.onForceRefetch?.(payload);
      callbackRefs.current.onSyncRequired?.({
        reason: payload?.reason || "force_refetch",
      });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.io.on("reconnect_attempt", handleReconnectAttempt);
    socket.io.on("reconnect_error", handleConnectError);
    socket.io.on("reconnect_failed", handleConnectError);
    socket.on("workflow:task_created", handleTaskCreated);
    socket.on("workflow:task_updated", handleTaskUpdated);
    socket.on("workflow:task_deleted", handleTaskDeleted);
    socket.on("workflow:batch_updated", handleBatchUpdated);
    socket.on("workflow:comment_added", handleCommentAdded);
    socket.on("workflow:force_refetch", handleForceRefetch);

    if (socket.connected) {
      void handleConnect();
    } else {
      setConnectionState("connecting");
      socket.connect();
    }

    return () => {
      if (joinDashboard) {
        socket.emit("workflow:leave_dashboard");
      }
      if (normalizedBatchId) {
        socket.emit("workflow:leave_batch", normalizedBatchId);
      }
      if (normalizedUserId) {
        socket.emit("workflow:leave_user", normalizedUserId);
      }

      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.io.off("reconnect_attempt", handleReconnectAttempt);
      socket.io.off("reconnect_error", handleConnectError);
      socket.io.off("reconnect_failed", handleConnectError);
      socket.off("workflow:task_created", handleTaskCreated);
      socket.off("workflow:task_updated", handleTaskUpdated);
      socket.off("workflow:task_deleted", handleTaskDeleted);
      socket.off("workflow:batch_updated", handleBatchUpdated);
      socket.off("workflow:comment_added", handleCommentAdded);
      socket.off("workflow:force_refetch", handleForceRefetch);
    };
  }, [batchId, enabled, joinDashboard, userId]);

  return {
    connectionState,
    isLive: connectionState === "live",
  };
};

export default useWorkflowRealtime;
