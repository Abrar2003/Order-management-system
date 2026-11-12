import { useEffect, useId, useState } from "react";
import OrderReferenceFileInput from "./OrderReferenceFileInput";
import useOrderReferenceUpload from "../hooks/useOrderReferenceUpload";
import {
  addOrderReferenceComment,
  commitOrderReferenceUpload,
  getOrderReferenceFileLink,
  listOrderReferenceDocuments,
} from "../services/orders.service";
import { APP_DATE_TIMEZONE } from "../utils/date";

const timestamp = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium", timeStyle: "short", timeZone: APP_DATE_TIMEZONE,
});
const formatTimestamp = (value) => timestamp.format(new Date(value));
const messageFor = (error, fallback) => error?.response?.data?.message || fallback;

function ReferenceFile({ orderRowId, file, canComment }) {
  const [comments, setComments] = useState(file.comments);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();

  const submitComment = async (event) => {
    event.preventDefault();
    if (!draft.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const comment = await addOrderReferenceComment(orderRowId, file._id, draft.trim());
      setComments((current) => [...current, comment]);
      setDraft("");
    } catch (failure) {
      setError(messageFor(failure, "Could not add the comment."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="list-group-item">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <strong className="text-break">{file.name}</strong>
        <div className="d-flex gap-2">
          {file.can_preview && (
            <a className="btn btn-outline-secondary btn-sm" target="_blank" rel="noreferrer"
              href={getOrderReferenceFileLink(orderRowId, file._id)}
              aria-label={`Open ${file.name}`}>Open</a>
          )}
          <a className="btn btn-outline-secondary btn-sm" target="_blank" rel="noreferrer"
            href={getOrderReferenceFileLink(orderRowId, file._id, true)}
            aria-label={`Download ${file.name}`}>Download</a>
        </div>
      </div>
      {comments.length > 0 && (
        <ul className="list-unstyled mt-2 mb-0">
          {comments.map((comment) => (
            <li key={comment._id} className="mb-2">
              <div className="small text-muted">
                {comment.author.name || "Unknown user"} · {formatTimestamp(comment.created_at)}
              </div>
              <div className="text-break" style={{ whiteSpace: "pre-wrap" }}>{comment.text}</div>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <form onSubmit={submitComment} className="d-flex flex-wrap align-items-end gap-2 mt-2">
          <div className="flex-grow-1">
            <label className="form-label small mb-1" htmlFor={inputId}>Comment</label>
            <textarea id={inputId} className="form-control form-control-sm" rows={2} maxLength={2000}
              value={draft} onChange={(event) => setDraft(event.target.value)} disabled={saving} />
          </div>
          <button type="submit" className="btn btn-outline-primary btn-sm" disabled={saving || !draft.trim()}>
            {saving ? "Posting…" : "Add comment"}
          </button>
        </form>
      )}
      {error && <div className="text-danger small mt-1" role="alert">{error}</div>}
    </li>
  );
}

function ReferenceBatches({ orderRowId, canEdit }) {
  const [batches, setBatches] = useState(null);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [listError, setListError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const referenceUpload = useOrderReferenceUpload();

  useEffect(() => {
    let active = true;
    listOrderReferenceDocuments(orderRowId)
      .then((result) => {
        if (active) {
          setBatches(result);
          setListError("");
        }
      })
      .catch((error) => {
        if (active) setListError(messageFor(error, "Could not load the documents."));
      });
    return () => { active = false; };
  }, [orderRowId, refreshCount]);

  const upload = async () => {
    if (uploading || !files.length) return;
    setUploading(true);
    setUploadError("");
    try {
      await referenceUpload.submit({ order_row_id: orderRowId }, files,
        (uploadId) => commitOrderReferenceUpload(orderRowId, uploadId));
      setFiles([]);
      setRefreshCount((value) => value + 1);
    } catch (error) {
      setUploadError(messageFor(error, error.message || "Could not save the documents."));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="d-grid gap-3">
      {canEdit && (
        <div className="border rounded p-3">
          <OrderReferenceFileInput files={files} onChange={setFiles} disabled={uploading} />
          <button className="btn btn-primary btn-sm mt-2" type="button" onClick={upload}
            disabled={uploading || !files.length}>Upload documents</button>
          {referenceUpload.progress && <div role="status" className="small mt-2">{referenceUpload.progress}</div>}
          {uploadError && <div role="alert" className="text-danger small mt-2">{uploadError}</div>}
        </div>
      )}
      {listError ? (
        <div role="alert" className="alert alert-danger mb-0">
          {listError} <button type="button" className="btn btn-link btn-sm" onClick={() => {
            setListError("");
            setRefreshCount((value) => value + 1);
          }}>Retry</button>
        </div>
      ) : batches === null ? (
        <div role="status">Loading documents…</div>
      ) : batches.length === 0 ? (
        <div className="text-muted">No reference documents have been uploaded.</div>
      ) : (
        <div className="d-grid gap-2">
          {batches.map((batch) => (
            <details key={batch._id} className="border rounded p-2">
              <summary className="p-1">
                {formatTimestamp(batch.uploaded_at)} · {batch.uploader || "Unknown user"} · {batch.files.length} {batch.files.length === 1 ? "file" : "files"}
              </summary>
              <ul className="list-group mt-2">
                {batch.files.map((file) => (
                  <ReferenceFile key={file._id} file={file} orderRowId={orderRowId} canComment={batch.can_comment} />
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrderReferenceDocuments({ id, orders, canEdit }) {
  const [selectedId, setSelectedId] = useState("");
  const selectId = useId();
  const groups = new Map();
  for (const order of orders) {
    const key = JSON.stringify([order.brand?.trim().toLowerCase(), String(order.vendor || "").trim().toLowerCase()]);
    if (!groups.has(key)) groups.set(key, order);
  }
  const choices = [...groups.values()];
  const current = choices.find((order) => order._id === selectedId) || choices[0];
  if (!current) return null;

  return (
    <section id={id} aria-label="Order Reference Documents" className="border-top p-3 d-grid gap-3">
      {choices.length > 1 && (
        <div>
          <label className="form-label" htmlFor={selectId}>Brand and vendor</label>
          <select id={selectId} className="form-select" value={current._id} onChange={(event) => setSelectedId(event.target.value)}>
            {choices.map((order) => <option key={order._id} value={order._id}>{order.brand} · {order.vendor}</option>)}
          </select>
        </div>
      )}
      <ReferenceBatches key={JSON.stringify([current._id, current.brand, current.vendor])} orderRowId={current._id} canEdit={canEdit} />
    </section>
  );
}
