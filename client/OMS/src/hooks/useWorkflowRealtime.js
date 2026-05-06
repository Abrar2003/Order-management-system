import { useEffect, useRef, useState } from "react";
import { connectWorkflowSocket } from "../realtime/socket";

const normalizeText = (value) => String(value || "").trim();

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
      return undefined;
    }

    const socket = connectWorkflowSocket();
    const normalizedBatchId = normalizeText(batchId);
    const normalizedUserId = normalizeText(userId);

    const joinRooms = () => {
      if (joinDashboard) {
        socket.emit("workflow:join_dashboard");
      }
      if (normalizedBatchId) {
        socket.emit("workflow:join_batch", normalizedBatchId);
      }
      if (normalizedUserId) {
        socket.emit("workflow:join_user", normalizedUserId);
      }
    };

    const handleConnect = () => {
      setConnectionState("live");
      joinRooms();
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
      handleConnect();
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
