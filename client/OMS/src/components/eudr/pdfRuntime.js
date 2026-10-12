import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?worker&url";

GlobalWorkerOptions.workerSrc = workerUrl;
const assets = import.meta.glob(["/node_modules/pdfjs-dist/cmaps/*.bcmap", "/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}", "/node_modules/pdfjs-dist/wasm/{openjpeg,jbig2,qcms_bg}.wasm", "/node_modules/pdfjs-dist/wasm/*_fallback.js"], { eager: true, query: "?url", import: "default" });
class BinaryDataFactory {
  async fetch({ kind, filename }) {
    const folder = { cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" }[kind];
    const url = assets[`/node_modules/pdfjs-dist/${folder}/${filename}`];
    if (!url) throw new Error("PDF rendering resource is unavailable");
    const response = await fetch(url);
    if (!response.ok) throw new Error("PDF rendering resource could not be loaded");
    return new Uint8Array(await response.arrayBuffer());
  }
}
export const openPdf = (source) => getDocument({ ...(typeof source === "string" ? { url: source } : { data: source }), withCredentials: true, disableStream: true, disableAutoFetch: true, rangeChunkSize: 65536, isEvalSupported: false, useWorkerFetch: false, BinaryDataFactory });
