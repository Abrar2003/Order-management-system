import api from "../../api/axios";

export const documentEndpoint = (chainId, document, action) => `/eudr/${chainId}/stages/${document.stageId}/documents/${document.documentId}/${action}`;

export function createDocumentStore(chainId) {
  const resources = new Map();
  const thumbnails = new Map();
  let disposed = false;
  const destroy = (record) => {
    record.abort.abort();
    record.task?.destroy().catch(() => {});
    if (record.url) URL.revokeObjectURL(record.url);
  };
  const evict = () => {
    const idle = [...resources.entries()].filter(([, record]) => !record.users).sort((a, b) => a[1].used - b[1].used);
    for (const [id, record] of idle.slice(0, Math.max(0, resources.size - 3))) { resources.delete(id); destroy(record); }
  };
  const acquire = (document) => {
    if (disposed) throw new Error("Document workspace closed");
    let record = resources.get(document.id);
    if (!record) {
      record = { users: 0, used: Date.now(), abort: new AbortController() };
      resources.set(document.id, record);
      record.promise = (async () => {
        const path = documentEndpoint(chainId, document, document.previewKind === "office" ? "preview" : "content");
        if (["pdf", "office"].includes(document.previewKind)) {
          const { openPdf } = await import("./pdfRuntime");
          if (disposed || record.abort.signal.aborted) throw new Error("Document workspace closed");
          const source = document.previewKind === "office" ? new Uint8Array((await api.get(path, { responseType: "arraybuffer", signal: record.abort.signal })).data) : new URL(api.getUri({ url: path }), window.location.origin).href;
          if (disposed || record.abort.signal.aborted) throw new Error("Document workspace closed");
          record.task = openPdf(source);
          return { kind: "pdf", pdf: await record.task.promise };
        }
        const response = await api.get(path, { responseType: "blob", signal: record.abort.signal });
        if (disposed || record.abort.signal.aborted) throw new Error("Document workspace closed");
        record.url = URL.createObjectURL(response.data);
        return { kind: "image", url: record.url };
      })().catch((error) => { if (resources.get(document.id) === record) resources.delete(document.id); destroy(record); throw error; });
    }
    record.users += 1;
    record.used = Date.now();
    let released = false;
    return { promise: record.promise, release: () => { if (!released) { released = true; record.users -= 1; record.used = Date.now(); evict(); } } };
  };
  const thumbnail = (document) => {
    if (thumbnails.has(document.id)) return thumbnails.get(document.id).promise;
    const record = {};
    thumbnails.set(document.id, record);
    record.promise = (async () => {
      const lease = acquire(document);
      try {
        const resource = await lease.promise;
        const canvas = window.document.createElement("canvas");
        if (resource.kind === "pdf") {
          const page = await resource.pdf.getPage(1);
          const original = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(480 / original.width, 640 / original.height) });
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        } else {
          const image = new Image(); image.src = resource.url; await image.decode();
          const scale = Math.min(480 / image.naturalWidth, 640 / image.naturalHeight, 1);
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        }
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
        canvas.width = 0; canvas.height = 0;
        if (!blob || disposed) throw new Error("Preview is unavailable");
        record.url = URL.createObjectURL(blob);
        return record.url;
      } finally { lease.release(); }
    })().catch((error) => { thumbnails.delete(document.id); throw error; });
    return record.promise;
  };
  return {
    acquire, thumbnail,
    dispose() { disposed = true; resources.forEach(destroy); resources.clear(); thumbnails.forEach((record) => { if (record.url) URL.revokeObjectURL(record.url); }); thumbnails.clear(); },
  };
}

export async function downloadChainDocument(chainId, document) {
  const response = await api.get(documentEndpoint(chainId, document, "url"), { params: { download: "1" } });
  const link = window.document.createElement("a");
  link.href = response.data.url; link.target = "_blank"; link.rel = "noopener noreferrer";
  link.download = document.originalFilename;
  window.document.body.appendChild(link); link.click(); link.remove();
}
