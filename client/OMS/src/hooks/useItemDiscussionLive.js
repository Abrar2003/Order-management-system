import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api/axios";
import { connectNotificationSocket } from "../notifications/notificationSocket";
import { subscribeItemDiscussion } from "../realtime/itemDiscussionSubscription";

export default function useItemDiscussionLive(itemId, vendor, qcId, topic) {
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("Connecting…");
  const [typers, setTypers] = useState([]);
  const subscription = useRef(null);
  useEffect(() => {
    if (!itemId) return;
    let mounted = true;
    const socket = connectNotificationSocket();
    const current = subscribeItemDiscussion({ socket, itemId, vendor, qcId, topic,
      onChange: () => setRevision((value) => value + 1), onStatus: setStatus,
      onTyping: (names) => setTypers((current) => current.length === names.length && current.every((name, index) => name === names[index]) ? current : names),
      onAuthExpired: () => { api.get("/auth/me").then(() => { if (mounted) socket.disconnect().connect(); }).catch(() => {}); },
    });
    subscription.current = current;
    return () => { mounted = false; current.close(); subscription.current = null; setTypers([]); };
  }, [itemId, vendor, qcId, topic]);
  const setTyping = useCallback((active) => subscription.current?.setTyping(active), []);
  return { revision, status, typers, setTyping };
}
