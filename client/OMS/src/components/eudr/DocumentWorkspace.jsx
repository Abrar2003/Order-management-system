import { useEffect, useRef, useState } from "react";
import { stageFields, incomingInvoice, STAGE_LABELS, filterChainDocuments, formatCft, formatDate, requestError } from "../../utils/eudrDocuments";
import { downloadChainDocument } from "./documentStore";
import EudrDialog from "./EudrDialog";

function useVisible(ref, rootRef, once = false) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!window.IntersectionObserver) { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (once && entry.isIntersecting) observer.disconnect();
    }, { root: rootRef?.current || null, rootMargin: "400px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, rootRef, once]);
  return visible;
}

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function StageMetadata({ stage, chain }) {
  if(stage.kind==="inventory")return <p className="small">This private file is shared documentary evidence. Review its owning records and evidence revisions; viewing it does not approve them.</p>;
  const incoming = incomingInvoice(chain, stage);
  return <div className="eudr-metadata">
    <dl>{stageFields(stage, chain).map(([field, label, type]) => <div key={field}>
      <dt>{label.replace(/ \([^)]*optional\)/, "")}</dt>
      <dd>{stage.fields?.[field] == null || stage.fields[field] === "" ? <span className="text-muted">Not provided</span> : type === "date" ? formatDate(stage.fields[field]) : type === "number" ? `${formatCft(stage.fields[field])} CFT` : type === "coordinate" ? `${stage.fields[field]}°` : stage.fields[field]}</dd>
    </div>)}</dl>
    {incoming && <section className="border rounded p-3 mb-3"><strong>Incoming sale invoice (linked)</strong><dl><div><dt>Seller</dt><dd>{incoming.seller.fields.name}</dd></div><div><dt>Invoice number / date</dt><dd>{incoming.seller.fields.invoice_number} · {formatDate(incoming.seller.fields.invoice_date)}</dd></div><div><dt>Issuer GST / PAN</dt><dd>{incoming.seller.fields.gst} · {incoming.seller.fields.pan}</dd></div></dl><a href={`#eudr-stage-${incoming.seller._id}`}>{incoming.document?.name || "View the preceding sale"}</a><p className="small text-muted mb-0">Original evidence is stored once in the seller's stage.</p></section>}
    {stage.kind === "declaration" && <dl><div><dt>Container</dt><dd>{chain.container}</dd></div><div><dt>Shipping vendor</dt><dd>{chain.vendor?.name || "—"}</dd></div><div><dt>Total declared timber</dt><dd>{formatCft(chain.declared_milli_cft / 1000)} CFT</dd></div><div><dt>This chain's contribution</dt><dd>{formatCft((chain.contribution_milli_cft ?? chain.declared_milli_cft) / 1000)} CFT</dd></div><div><dt>Calculated stuffed timber</dt><dd>{formatCft(chain.stuffed_cft)} CFT</dd></div></dl>}
    <div className="eudr-verification-record"><strong>{stage.verified_at ? "Stage verification recorded" : "Awaiting manual review"}</strong>
      {stage.verified_at ? <><span>By {stage.verified_by_name || "User"}</span><span>{formatDate(stage.verified_at, true)}</span><span>Method: {stage.verification_method || "manual"}</span></> : <span>Viewing a document does not change its approval status.</span>}
    </div>
  </div>;
}

export function DocumentPreviewCard({ document, chainId, store, onPreview }) {
  const ref = useRef(null);
  const visible = useVisible(ref, null, true);
  const [preview, setPreview] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    if (!visible || document.previewKind === "other") return;
    let active = true; setFailed(false);
    store.thumbnail(document).then((url) => { if (active) setPreview(url); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [visible, document, store, retry]);
  const download = async () => {
    try { setDownloading(true); setDownloadError(""); await downloadChainDocument(chainId, document); }
    catch (error) { setDownloadError(requestError(error)); }
    finally { setDownloading(false); }
  };
  return <article ref={ref} className="eudr-document-card">
    <button type="button" className="eudr-thumbnail" onClick={() => onPreview(document)} aria-label={`Preview ${document.displayName}: ${document.originalFilename}`}>
      {preview ? <img src={preview} alt={`${document.previewKind === "pdf" ? "First page of" : "Uploaded document"} ${document.originalFilename}`} loading="lazy" /> : <span className="eudr-preview-placeholder">{document.previewKind === "other" ? `${document.format || "File"} preview unavailable. Download to inspect.` : failed ? "Preview could not be loaded" : <><span className="spinner-border spinner-border-sm" aria-hidden="true" /> Loading preview…</>}</span>}
      <span className="eudr-format-tag">{document.format || "FILE"}{document.previewKind === "pdf" && " · Page 1"}{document.previewKind === "office" && " · Converted preview"}</span>
    </button>
    <div className="eudr-document-caption"><h4>{document.displayName}</h4><p title={document.originalFilename}>{document.originalFilename}</p><span className={`eudr-status ${document.stage.verified_at ? "is-verified" : "is-pending"}`}>{document.verificationStatus}</span>
      <div className="eudr-document-actions"><button type="button" className="btn btn-sm btn-dark" onClick={() => onPreview(document)}>Preview</button><button type="button" className="btn btn-sm btn-outline-secondary" disabled={downloading} onClick={download}>{downloading ? "Preparing…" : "Download"}</button>{failed && <button type="button" className="btn btn-link btn-sm" onClick={() => setRetry((value) => value + 1)}>Retry preview</button>}</div>
      {downloadError && <p className="text-danger small mt-2" role="alert">{downloadError}</p>}
    </div>
  </article>;
}

export function DocumentGallery({ documents, chainId, store, onPreview }) {
  if (!documents.length) return <div className="eudr-empty">No uploaded documents in this selection.</div>;
  return <div className="eudr-document-grid">{documents.map((document) => <DocumentPreviewCard key={document.id} document={document} chainId={chainId} store={store} onPreview={(selected) => onPreview(selected, documents)} />)}</div>;
}

export function AllDocumentsGallery({ chain, documents, store, onPreview, onClose }) {
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const filtered = filterChainDocuments(documents, filter, search);
  const verified = chain.stages.filter((stage) => stage.verified_at).length;
  return <EudrDialog titleId="eudr-all-documents-title" className="eudr-gallery-dialog" onClose={onClose}>
    <header className="eudr-dialog-header"><div><span className="eudr-eyebrow">Container {chain.container} · {chain.vendor?.name || "Unknown vendor"}</span><h2 id="eudr-all-documents-title">All Chain Documents</h2><p>Total documents: {documents.length} <span aria-hidden="true">·</span> Verified stages: {verified}/{chain.stages.length}</p></div><button type="button" className="btn btn-outline-secondary" onClick={onClose}>Close gallery</button></header>
    <div className="eudr-gallery-controls"><div className="eudr-filter-tabs" aria-label="Filter documents by stage">{[["", "All Documents"], ...Object.entries(STAGE_LABELS)].map(([kind, label]) => <button type="button" key={kind} className={`btn btn-sm ${filter === kind ? "btn-dark" : "btn-outline-secondary"}`} aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{label} ({kind ? documents.filter((document) => document.stageKind === kind).length : documents.length})</button>)}</div><label className="eudr-document-search"><span>Search documents</span><input type="search" className="form-control" placeholder="Filename, document type or stage" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
    <div className="eudr-dialog-body eudr-gallery-body">
      {!filtered.length && <div className="eudr-empty"><h3 className="h5">{documents.length ? "No matching documents" : "No documents uploaded yet"}</h3><p>{documents.length ? "Try another search or stage filter." : "Uploaded stage documents will appear here as the chain progresses."}</p></div>}
      {chain.stages.map((stage, index) => {
        const group = filtered.filter((document) => document.stageId === String(stage._id));
        if (!group.length) return null;
        return <section className="eudr-document-group" key={stage._id}><div className="eudr-section-heading"><h3>{index + 1}. {STAGE_LABELS[stage.kind]}</h3><span>{group.length} document{group.length === 1 ? "" : "s"}</span></div><DocumentGallery documents={group} chainId={chain._id} store={store} onPreview={(document) => onPreview(document, filtered)} /></section>;
      })}
      {[...new Set(filtered.filter(d=>d.inventoryDocumentId).map(d=>d.contextLabel))].map(label=><section className="eudr-document-group" key={label}><div className="eudr-section-heading"><h3>{label}</h3></div><DocumentGallery documents={filtered.filter(d=>d.inventoryDocumentId&&d.contextLabel===label)} chainId={chain._id} store={store} onPreview={document=>onPreview(document,filtered)} /></section>)}
    </div>
  </EudrDialog>;
}

function PdfPage({ pdf, number, rootRef, size, fit, zoom }) {
  const ref = useRef(null);
  const canvasRef = useRef(null);
  const visible = useVisible(ref, rootRef);
  const [dimensions, setDimensions] = useState({ width: 612, height: 792 });
  const [error, setError] = useState(false);
  const fitScale = fit === "page" ? Math.min((size.width - 48) / dimensions.width, (size.height - 40) / dimensions.height) : (size.width - 48) / dimensions.width;
  const scale = Math.max(0.1, fitScale * zoom);
  useEffect(() => {
    const canvas = canvasRef.current;
    let cancelled = false; let task;
    if (visible && size.width) {
      setError(false);
      pdf.getPage(number).then(async (page) => {
        if (cancelled) return;
        const original = page.getViewport({ scale: 1 });
        setDimensions((previous) => previous.width === original.width && previous.height === original.height ? previous : { width: original.width, height: original.height });
        const viewport = page.getViewport({ scale });
        const pixels = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
        canvas.width = Math.ceil(viewport.width * pixels); canvas.height = Math.ceil(viewport.height * pixels);
        task = page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: [pixels, 0, 0, pixels, 0, 0] });
        await task.promise;
      }).catch((reason) => { if (!cancelled && reason?.name !== "RenderingCancelledException") setError(true); });
    }
    return () => { cancelled = true; task?.cancel(); canvas.width = 0; canvas.height = 0; };
  }, [pdf, number, visible, scale, size.width]);
  return <div ref={ref} data-page-number={number} className="eudr-pdf-page" style={{ width: dimensions.width * scale, height: dimensions.height * scale }}>
    <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} role="img" aria-label={`PDF page ${number}`} />{error && <span className="eudr-page-error" role="alert">Page {number} could not be rendered. Download the original to inspect it.</span>}
    <span className="eudr-page-number">Page {number}</span>
  </div>;
}

function PdfDocument({ pdf, fit, zoom }) {
  const ref = useRef(null);
  const size = useElementSize(ref);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("1");
  const activePage = useRef(1);
  useEffect(() => {
    ref.current.querySelector(`[data-page-number="${activePage.current}"]`)?.scrollIntoView({ block: "start" });
  }, [fit, zoom, size.width, size.height]);
  const goToPage = (value) => {
    const target = Math.min(pdf.numPages, Math.max(1, Number.parseInt(value, 10) || 1));
    activePage.current = target;
    setPage(target); setDraft(String(target));
    ref.current.querySelector(`[data-page-number="${target}"]`)?.scrollIntoView({ block: "start" });
  };
  const onScroll = () => {
    const boundary = ref.current.getBoundingClientRect().top + Math.min(100, size.height / 3);
    const active = [...ref.current.querySelectorAll("[data-page-number]")].find((element) => element.getBoundingClientRect().bottom >= boundary);
    if (active && Number(active.dataset.pageNumber) !== page) { activePage.current = Number(active.dataset.pageNumber); setPage(activePage.current); setDraft(active.dataset.pageNumber); }
  };
  return <div className="eudr-pdf-document"><div className="eudr-page-controls"><button type="button" className="btn btn-sm btn-outline-secondary" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous page</button><label>Page <input aria-label="PDF page number" type="number" min="1" max={pdf.numPages} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => goToPage(draft)} onKeyDown={(event) => { if (event.key === "Enter") goToPage(draft); }} /> of {pdf.numPages}</label><button type="button" className="btn btn-sm btn-outline-secondary" disabled={page >= pdf.numPages} onClick={() => goToPage(page + 1)}>Next page</button></div><div ref={ref} className="eudr-document-scroll" onScroll={onScroll}>{Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={index} pdf={pdf} number={index + 1} rootRef={ref} size={size} fit={fit} zoom={zoom} />)}</div></div>;
}

function ImageDocument({ url, name, fit, zoom }) {
  const ref = useRef(null);
  const size = useElementSize(ref);
  const [dimensions, setDimensions] = useState(null);
  const [error, setError] = useState(false);
  const ratio = dimensions ? fit === "page" ? Math.min((size.width - 48) / dimensions.width, (size.height - 48) / dimensions.height) : (size.width - 48) / dimensions.width : 1;
  return <div ref={ref} className="eudr-document-scroll eudr-image-document">{error ? <p className="eudr-preview-placeholder" role="alert">Image could not be displayed. Download the original to inspect it.</p> : <img src={url} alt={name} style={{ width: dimensions ? Math.max(1, dimensions.width * ratio * zoom) : "auto", maxWidth: "none" }} onLoad={(event) => setDimensions({ width: event.target.naturalWidth, height: event.target.naturalHeight })} onError={() => setError(true)} />}</div>;
}

function DocumentContent({ document, store, fit, zoom }) {
  const [resource, setResource] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (document.previewKind === "other") return;
    let active = true;
    const lease = store.acquire(document);
    lease.promise.then((value) => { if (active) setResource(value); }).catch((reason) => { if (active) setError(`This document could not be previewed: ${requestError(reason)}. Try reopening it, or download the original.`); });
    return () => { active = false; lease.release(); };
  }, [document, store]);
  if (document.previewKind === "other") return <div className="eudr-viewer-message">This {document.format || "file"} format has no built-in preview. Use Download to inspect the original.</div>;
  if (error) return <div className="eudr-viewer-message" role="alert">{error}</div>;
  if (!resource) return <div className="eudr-viewer-message" role="status"><span className="spinner-border" aria-hidden="true" /> {document.previewKind === "office" ? "Preparing private converted preview…" : "Loading document…"}</div>;
  return <>{document.previewKind === "office" && <p className="small text-muted px-3 py-2 mb-0">Converted preview · Formatting can differ from the original. Download the original for authoritative data and layout.</p>}{resource.kind === "pdf" ? <PdfDocument pdf={resource.pdf} fit={fit} zoom={zoom} /> : <ImageDocument url={resource.url} name={document.originalFilename} fit={fit} zoom={zoom} />}</>;
}

export function FullDocumentViewer({ chain, documents, initialId, store, onClose }) {
  const [index, setIndex] = useState(Math.max(0, documents.findIndex((document) => document.id === initialId)));
  const [fit, setFit] = useState("page");
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const document = documents[index];
  const navigate = (direction) => { setIndex((previous) => Math.min(documents.length - 1, Math.max(0, previous + direction))); setZoom(1); setError(""); };
  const onKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); navigate(event.key === "ArrowLeft" ? -1 : 1); }
  };
  const download = async () => {
    try { setDownloading(true); setError(""); await downloadChainDocument(chain._id, document); }
    catch (reason) { setError(requestError(reason)); }
    finally { setDownloading(false); }
  };
  return <EudrDialog titleId="eudr-viewer-title" className="eudr-viewer-dialog" onClose={onClose} onKeyDown={onKeyDown}>
    <header className="eudr-dialog-header"><div><span className="eudr-eyebrow">{document.stageIndex + 1}. {document.stageName} · Document {index + 1} of {documents.length}</span><h2 id="eudr-viewer-title">{document.displayName}</h2><p>{document.originalFilename}</p></div><button type="button" className="btn btn-outline-secondary" onClick={onClose}>Close viewer</button></header>
    <div className="eudr-viewer-toolbar"><div className="eudr-toolbar-group"><button type="button" className="btn btn-sm btn-outline-secondary" disabled={index === 0} onClick={() => navigate(-1)}>Previous document</button><button type="button" className="btn btn-sm btn-outline-secondary" disabled={index === documents.length - 1} onClick={() => navigate(1)}>Next document</button></div><div className="eudr-toolbar-group"><button type="button" className="btn btn-sm btn-outline-secondary" aria-label="Zoom out" disabled={zoom <= 0.25} onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}>−</button><output aria-label="Zoom level">{Math.round(zoom * 100)}%</output><button type="button" className="btn btn-sm btn-outline-secondary" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>+</button><button type="button" className={`btn btn-sm ${fit === "page" ? "btn-dark" : "btn-outline-secondary"}`} onClick={() => { setFit("page"); setZoom(1); }}>Fit page</button><button type="button" className={`btn btn-sm ${fit === "width" ? "btn-dark" : "btn-outline-secondary"}`} onClick={() => { setFit("width"); setZoom(1); }}>Fit width</button></div><button type="button" className="btn btn-sm btn-dark" disabled={downloading} onClick={download}>{downloading ? "Preparing…" : "Download"}</button></div>
    {error && <div className="alert alert-danger m-2" role="alert">{error}</div>}
    <div className="eudr-viewer-layout"><div className="eudr-viewer-preview"><DocumentContent key={document.id} document={document} store={store} fit={fit} zoom={zoom} /></div>
      <aside className="eudr-viewer-metadata"><span className="eudr-eyebrow">Compare with saved information</span><h3>{document.stageName}</h3><StageMetadata stage={document.stage} chain={chain} />
        {document.inventoryContexts?.map(c=><section key={c.resource+":"+c.id} className="mb-3"><strong>{c.label}</strong><p className="small">Evidence revision {c.revision} · Documentary review {c.verification} · Origin review {c.origin_status}</p></section>)}
        {document.uploadedAt && <p className="small text-muted mt-3">Uploaded {formatDate(document.uploadedAt, true)}</p>}
      </aside>
    </div>
  </EudrDialog>;
}
