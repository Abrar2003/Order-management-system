import { useCallback, useEffect, useId, useRef, useState } from "react";
import api from "../api/axios";
import { usePermissions } from "../auth/PermissionContext";
import { isStrictAdminRole } from "../auth/permissions";
import FilePreviewModal from "./FilePreviewModal";
import { APP_DATE_TIMEZONE } from "../utils/date";
import { DISCUSSION_FILE_ACCEPT, DISCUSSION_MAX_TEXT, ITEM_DISCUSSION_TOPICS, getDiscussionFileError, mergeDiscussionReplies } from "../utils/itemDiscussions";
import "./ItemDiscussions.css";

const time = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: APP_DATE_TIMEZONE });
const failureMessage = (error, fallback) => error?.response?.data?.message || fallback;

function DiscussionMessage({ message, isRoot, openFile, canDelete, removeMessage, deletingId, busy }) {
  return <article className={`item-discussion-message${isRoot ? " item-discussion-root" : ""}`}>
    <div className="item-discussion-avatar" aria-hidden="true">{(message.author?.name || "?").slice(0, 1).toUpperCase()}</div>
    <div className="item-discussion-message-body">
      <div className="item-discussion-author"><strong>{message.author?.name || "Unknown"}</strong>
        <time dateTime={message.created_at}>{time.format(new Date(message.created_at))}</time>
        {canDelete && !message.deleted_at && <button type="button" className="btn btn-link btn-sm text-danger ms-auto p-0" disabled={busy}
          aria-label={`Delete message by ${message.author?.name || "Unknown"}`} onClick={() => removeMessage(message)}>{deletingId === message._id ? "Deleting…" : "Delete"}</button>}
      </div>
      {message.deleted_at ? <div className="small text-secondary fst-italic mt-1">Message deleted by an admin.</div> : message.text && <div className="item-discussion-text">{message.text}</div>}
      {!message.deleted_at && message.attachments?.length > 0 && <div className="item-discussion-attachments">
        {message.attachments.map((file) => <div className="item-discussion-attachment" key={file._id}>
          {file.content_type.startsWith("image/") && <button type="button" className="item-discussion-image" onClick={() => openFile(message, file)} aria-label={`Preview ${file.name}`}>
            <img src={file.url} alt={file.name} loading="lazy" />
          </button>}
          {file.content_type.startsWith("video/") && <video controls preload="none" src={file.url} aria-label={file.name} />}
          <div className="item-discussion-file-meta">
            <button type="button" className="btn btn-link p-0 text-start text-break" onClick={() => openFile(message, file)}>{file.name}</button>
            <small className="text-secondary">{(file.size / (1024 * 1024)).toFixed(1)} MB</small>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => openFile(message, file, true)} aria-label={`Download ${file.name}`}>Download</button>
          </div>
        </div>)}
      </div>}
    </div>
  </article>;
}

function DiscussionThread({ itemId, topic, vendor, qcId, onClose, onPosted }) {
  const { role } = usePermissions();
  const canDelete = isStrictAdminRole(role);
  const [thread, setThread] = useState({ root: null, replies: [], before: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const busy = saving || Boolean(deletingId);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [fileBusy, setFileBusy] = useState(false);
  const panelRef = useRef(null);
  const endRef = useRef(null);
  const uploadRef = useRef(null);
  const requestIdRef = useRef(crypto.randomUUID());
  const draftId = useId();
  const base = `/items/${encodeURIComponent(itemId)}/discussions/${topic.key}/messages`;
  const context = qcId ? { qc_id: qcId } : vendor ? { vendor } : {};

  const load = useCallback(async (before = "") => {
    setLoading(true); setError("");
    try {
      const response = await api.get(base, { params: { ...(qcId ? { qc_id: qcId } : vendor ? { vendor } : {}), ...(before ? { before } : {}) } });
      const data = response.data.data;
      setThread((current) => before ? { ...data, replies: mergeDiscussionReplies(data.replies, current.replies) } : data);
    } catch (error) {
      if ([403, 404].includes(error?.response?.status)) setThread({ root: null, replies: [], before: null });
      setError(failureMessage(error, "Could not load this discussion."));
    } finally { setLoading(false); }
  }, [base, qcId, vendor]);
  useEffect(() => { load(); }, [load]);
  const latestMessageId = thread.replies.at(-1)?._id || thread.root?._id;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [latestMessageId]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector("button:not(:disabled)")?.focus();
    const keydown = (event) => {
      if (document.querySelector("[data-file-preview]")) return;
      if (event.key === "Escape" && panelRef.current?.dataset.saving !== "true") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const controls = [...panelRef.current.querySelectorAll("button:not(:disabled),textarea:not(:disabled),video[controls]")];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  const openFile = async (message, file, download = false) => {
    if (fileBusy) return;
    setFileBusy(true); setError("");
    const downloadFile = download || file.content_type.includes("sheet") || file.content_type === "application/vnd.ms-excel";
    try {
      const response = await api.get(`${base}/${message._id}/files/${file._id}`, { params: { ...context, download: downloadFile } });
      const url = response.data.data.url;
      if (downloadFile) window.location.assign(url);
      else if (file.content_type.startsWith("video/")) window.open(url, "_blank", "noopener,noreferrer");
      else setPreview({ url, originalName: file.name, previewMode: file.content_type.startsWith("image/") ? "image" : "pdf" });
    } catch (error) { setError(failureMessage(error, "Could not open this attachment.")); }
    finally { setFileBusy(false); }
  };

  const send = async (event) => {
    event.preventDefault();
    if (busy || (!draft.trim() && !files.length)) return;
    const fileError = getDiscussionFileError(files);
    if (fileError) { setError(fileError); return; }
    setSaving(true); setError("");
    const form = new FormData();
    form.append("text", draft.trim()); form.append("client_message_id", requestIdRef.current);
    files.forEach((file) => form.append("files", file));
    try {
      const response = await api.post(base, form, { params: context });
      const message = response.data.data;
      setThread((current) => current.root
        ? { ...current, replies: mergeDiscussionReplies(current.replies, [message]) }
        : { root: message, replies: [], before: null });
      setDraft(""); setFiles([]); requestIdRef.current = crypto.randomUUID();
      if (uploadRef.current) uploadRef.current.value = "";
      await load(); onPosted();
    } catch (error) { setError(failureMessage(error, "Message was not confirmed. Retry to send it safely.")); }
    finally { setSaving(false); }
  };
  const selectFiles = (event) => {
    const next = [...files, ...Array.from(event.target.files || [])];
    const fileError = getDiscussionFileError(next);
    if (fileError) setError(fileError);
    else { setFiles(next); setError(""); requestIdRef.current = crypto.randomUUID(); }
    event.target.value = "";
  };

  const removeMessage = async (message) => {
    if (!canDelete || busy || !window.confirm("Delete this message and its attachments? Other messages in the thread will remain.")) return;
    setDeletingId(message._id); setError("");
    try {
      await api.delete(`${base}/${message._id}`, { params: context });
      const deleted = { ...message, text: "", attachments: [], deleted_at: new Date().toISOString() };
      setThread((current) => ({
        ...current,
        root: current.root?._id === message._id ? deleted : current.root,
        replies: current.replies.map((reply) => reply._id === message._id ? deleted : reply),
      }));
      onPosted();
    } catch (error) { setError(failureMessage(error, "Could not delete this message.")); }
    finally { setDeletingId(""); }
  };
  const messageActions = { openFile, canDelete, removeMessage, deletingId, busy: busy || loading };

  return <div className="item-discussion-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <aside className="item-discussion-panel" role="dialog" aria-modal="true" aria-labelledby={`${draftId}-heading`} data-saving={busy} ref={panelRef}>
      <header className="item-discussion-header">
        <div><div className="small text-secondary">Item discussion</div><h3 id={`${draftId}-heading`}>{topic.label}</h3></div>
        <div className="d-flex gap-2"><button type="button" className="btn btn-outline-secondary btn-sm" disabled={loading || busy} onClick={() => load()}>Refresh</button>
          <button type="button" className="btn-close" aria-label="Close discussion" disabled={busy} onClick={onClose} /></div>
      </header>
      <div className="item-discussion-stream" aria-busy={loading}>
        {loading && <div className="small text-secondary" role="status">Loading messages…</div>}
        {thread.root ? <>
          <DiscussionMessage message={thread.root} isRoot {...messageActions} />
          <div className="item-discussion-replies-label">Replies</div>
          {thread.before && <button type="button" className="btn btn-link btn-sm mb-2" disabled={loading || busy} onClick={() => load(thread.before)}>Load earlier replies</button>}
          {thread.replies.map((message) => <DiscussionMessage key={message._id} message={message} {...messageActions} />)}
          {!thread.replies.length && <p className="small text-secondary">No replies yet.</p>}
        </> : !loading && <div className="item-discussion-empty"><strong>Start the {topic.label} discussion</strong><p>Messages and files for this item stay in this thread.</p></div>}
        <div ref={endRef} />
      </div>
      <form className="item-discussion-composer" onSubmit={send}>
        {error && <div className="alert alert-danger py-2 small" role="alert">{error}</div>}
        <label htmlFor={draftId} className="visually-hidden">{thread.root ? "Reply to thread" : "Start discussion"}</label>
        <textarea id={draftId} className="form-control" rows={3} maxLength={DISCUSSION_MAX_TEXT} disabled={busy} value={draft}
          onChange={(event) => { setDraft(event.target.value); requestIdRef.current = crypto.randomUUID(); }} placeholder={thread.root ? "Reply to thread…" : "Write the first message…"} />
        {files.length > 0 && <ul className="item-discussion-pending-files">{files.map((file, index) => <li key={`${file.name}-${index}`}>
          <span className="text-truncate">{file.name}</span><button type="button" className="btn-close" disabled={busy} aria-label={`Remove ${file.name}`}
            onClick={() => { setFiles(files.filter((_, i) => i !== index)); requestIdRef.current = crypto.randomUUID(); }} />
        </li>)}</ul>}
        <div className="d-flex justify-content-between gap-2 align-items-center mt-2">
          <div><input ref={uploadRef} tabIndex={-1} className="visually-hidden" aria-label="Discussion attachments" type="file" accept={DISCUSSION_FILE_ACCEPT} multiple disabled={busy} onChange={selectFiles} />
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => uploadRef.current?.click()}>Attach files</button></div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || loading || (!draft.trim() && !files.length)}>{saving ? "Sending…" : thread.root ? "Send reply" : "Send message"}</button>
        </div>
        <div className="small text-secondary mt-2">PDF, photos, videos and Excel · Up to 10 files, 50 MB each, 100 MB total</div>
      </form>
    </aside>
    {preview && <FilePreviewModal {...preview} title="Discussion attachment" onClose={() => setPreview(null)} />}
  </div>;
}

export default function ItemDiscussions({ itemId, vendor = "", qcId = "" }) {
  const [topics, setTopics] = useState(ITEM_DISCUSSION_TOPICS);
  const [active, setActive] = useState(null);
  const [error, setError] = useState("");
  const loadTopics = useCallback(async () => {
    if (!itemId) return;
    try {
      const response = await api.get(`/items/${encodeURIComponent(itemId)}/discussions`, { params: qcId ? { qc_id: qcId } : vendor ? { vendor } : {} });
      setTopics(response.data.data); setError("");
    } catch (error) { setError(failureMessage(error, "Could not load item discussions.")); }
  }, [itemId, vendor, qcId]);
  useEffect(() => { loadTopics(); }, [loadTopics]);
  const close = useCallback(() => { setActive(null); }, []);
  if (!itemId) return null;
  return <section className="item-discussions">
    <div className="d-flex justify-content-between align-items-center gap-2 mb-2"><h3 className="h6 mb-0">Discussions</h3>
      <span className="small text-secondary">One shared thread per topic</span></div>
    {error && <div className="alert alert-danger py-2 small" role="alert">{error} <button className="btn btn-link btn-sm" type="button" onClick={loadTopics}>Retry</button></div>}
    <div className="item-discussion-topics">{topics.map((topic) => <button type="button" className="item-discussion-topic" key={topic.key} onClick={() => setActive(topic)}>
      <span className="item-discussion-topic-heading"><strong>{topic.label}</strong><span className="badge text-bg-light border">{Math.max(0, (topic.message_count || 0) - 1)} {(topic.message_count || 0) === 2 ? "reply" : "replies"}</span></span>
      <span className="item-discussion-topic-preview">{topic.latest?.deleted_at ? "Message deleted by an admin" : topic.latest ? `${topic.latest.author?.name || "Unknown"}: ${topic.latest.text || "Shared an attachment"}` : "Start the discussion"}</span>
      <span className="small text-secondary">Open thread →</span>
    </button>)}</div>
    {active && <DiscussionThread key={`${itemId}:${active.key}:${vendor}:${qcId}`} itemId={itemId} topic={active} vendor={vendor} qcId={qcId} onClose={close} onPosted={loadTopics} />}
  </section>;
}
