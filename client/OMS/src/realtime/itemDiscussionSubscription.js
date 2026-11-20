export const subscribeItemDiscussion = ({ socket, itemId, vendor, qcId, topic, onChange, onStatus, onTyping, onAuthExpired }) => {
  const id = crypto.randomUUID();
  const context = { id, itemId, vendor, qcId, topic };
  const typers = new Map();
  const typingSequences = new Map();
  let closed = false, ready = false, userId = "", idleTimer, changeTimer, lastTyping = 0, typing = false, generation = 0;
  const showTypers = () => {
    const users = new Map();
    for (const [source, event] of typers) {
      if (event.expiresAt <= Date.now()) typers.delete(source);
      else if (event.user.id !== userId) users.set(event.user.id, event.user.name);
    }
    onTyping([...users.values()]);
  };
  const changed = (event) => {
    if (event.subscriptionId !== id) return;
    if (!changeTimer) changeTimer = setTimeout(() => { changeTimer = null; onChange(); }, 150);
  };
  const setTyping = (active) => {
    clearTimeout(idleTimer);
    if (!ready || !topic || !socket.connected) return;
    if (!active) {
      if (typing) socket.emit("discussion:typing", { subscriptionId: id, typing: false });
      typing = false;
      return;
    }
    if (!typing || Date.now() - lastTyping >= 1800) {
      socket.volatile.emit("discussion:typing", { subscriptionId: id, typing: true });
      lastTyping = Date.now();
      typing = true;
    }
    idleTimer = setTimeout(() => setTyping(false), 2200);
  };
  const receivedTyping = (event) => {
    if (!ready || event.subscriptionId !== id || event.itemId !== itemId || event.topic !== topic || !event.user?.id) return;
    if (event.sequence <= (typingSequences.get(event.source) || 0)) return;
    typingSequences.set(event.source, event.sequence);
    if (event.expiresAt > Date.now()) typers.set(event.source, event);
    else typers.delete(event.source);
    showTypers();
  };
  const disconnected = () => {
    generation++;
    ready = typing = false;
    clearTimeout(idleTimer);
    typers.clear(); typingSequences.clear(); showTypers(); onStatus("Reconnecting…");
  };
  const revoked = (event) => {
    if (event.subscriptionId !== id) return;
    disconnected(); onStatus("Live access unavailable"); onChange();
    if (event.statusCode === 401) onAuthExpired();
  };
  const connectionFailed = (error) => {
    disconnected();
    if (error?.data?.statusCode === 401) onAuthExpired();
  };
  const subscribe = () => {
    const attempt = ++generation;
    onStatus("Connecting…");
    socket.timeout(10000).emit("discussion:subscribe", context, (error, result) => {
      if (closed || attempt !== generation) return;
      ready = !error && Boolean(result?.ok);
      userId = result?.userId || "";
      onStatus(ready ? "Live" : "Live connection unavailable");
      if (ready) onChange();
    });
  };
  socket.on("connect", subscribe);
  socket.on("disconnect", disconnected);
  socket.on("connect_error", connectionFailed);
  socket.on("discussion:changed", changed);
  socket.on("discussion:resync", changed);
  socket.on("discussion:typing", receivedTyping);
  socket.on("discussion:access_revoked", revoked);
  const expiryTimer = setInterval(showTypers, 1000);
  if (socket.connected) subscribe();
  else onStatus("Connecting…");

  return {
    setTyping,
    close() {
      closed = true;
      setTyping(false);
      if (socket.connected) socket.emit("discussion:unsubscribe", id);
      clearTimeout(idleTimer); clearTimeout(changeTimer); clearInterval(expiryTimer);
      socket.off("connect", subscribe);
      socket.off("disconnect", disconnected);
      socket.off("connect_error", connectionFailed);
      socket.off("discussion:changed", changed);
      socket.off("discussion:resync", changed);
      socket.off("discussion:typing", receivedTyping);
      socket.off("discussion:access_revoked", revoked);
    },
  };
};
