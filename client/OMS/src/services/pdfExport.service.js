import api from "../api/axios";

const normalizeText = (value) => String(value ?? "").trim();

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const inlineCloneImages = async (source, clone) => {
  const sourceImages = Array.from(source.querySelectorAll("img"));
  const cloneImages = Array.from(clone.querySelectorAll("img"));

  await Promise.all(
    cloneImages.map(async (image, index) => {
      const sourceImage = sourceImages[index];
      const sourceUrl = sourceImage?.currentSrc || sourceImage?.src || image.src;
      if (!sourceUrl || /^data:/i.test(sourceUrl)) return;

      try {
        const response = await fetch(sourceUrl, { credentials: "include" });
        if (!response.ok) return;
        image.src = await blobToDataUrl(await response.blob());
      } catch {
        image.removeAttribute("src");
      }
    }),
  );
};

const collectDocumentStyles = () => {
  const chunks = [];

  Array.from(document.styleSheets || []).forEach((sheet) => {
    try {
      chunks.push(
        Array.from(sheet.cssRules || [])
          .map((rule) => rule.cssText)
          .join("\n"),
      );
    } catch {
      const inlineCss = sheet.ownerNode?.textContent;
      if (inlineCss) chunks.push(inlineCss);
    }
  });

  return chunks.join("\n");
};

const injectRepeatingHeader = (clone, { title = "", subtitle = "" } = {}) => {
  const table = clone.matches("table") ? clone : clone.querySelector("table");
  const thead = table?.querySelector("thead");
  if (!table || !thead || (!normalizeText(title) && !normalizeText(subtitle))) return;

  const columnCount = Math.max(
    1,
    ...Array.from(table.querySelectorAll("tr")).map((row) =>
      Array.from(row.children).reduce(
        (sum, cell) => sum + (Number(cell.getAttribute("colspan")) || 1),
        0,
      ),
    ),
  );
  const row = document.createElement("tr");
  row.className = "pdf-report-meta-row";
  const cell = document.createElement("th");
  cell.colSpan = columnCount;
  const titleNode = document.createElement("div");
  titleNode.className = "pdf-report-title";
  titleNode.textContent = normalizeText(title);
  cell.appendChild(titleNode);
  if (normalizeText(subtitle)) {
    const subtitleNode = document.createElement("div");
    subtitleNode.className = "pdf-report-subtitle";
    subtitleNode.textContent = normalizeText(subtitle);
    cell.appendChild(subtitleNode);
  }
  row.appendChild(cell);
  thead.insertBefore(row, thead.firstChild);
};

const parseFilename = (disposition, fallback) => {
  const source = normalizeText(disposition);
  const utf8Match = source.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/['"]/g, "").trim());
    } catch {
      return fallback;
    }
  }
  const basicMatch = source.match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1]?.trim() || fallback;
};

export const downloadPdfResponse = (response, fallbackFilename) => {
  const filename = parseFilename(
    response?.headers?.["content-disposition"],
    fallbackFilename,
  );
  const blob = new Blob([response.data], { type: "application/pdf" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

export const exportElementToPdf = async ({
  element,
  endpoint = "/reports/pdf/render",
  reportKey,
  filename,
  landscape = true,
  format = "A4",
  margin = {
    top: "10mm",
    right: "8mm",
    bottom: "10mm",
    left: "8mm",
  },
  repeatHeader,
  extraCss = "",
} = {}) => {
  if (!element) throw new Error("PDF report element is not available");

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const clone = element.cloneNode(true);
  clone.removeAttribute("aria-hidden");
  clone.classList.add("pdf-report");
  clone.querySelectorAll("[aria-hidden='true']").forEach((node) => {
    node.removeAttribute("aria-hidden");
  });
  if (repeatHeader?.inTable) {
    injectRepeatingHeader(clone, repeatHeader);
  }
  await inlineCloneImages(element, clone);

  const response = await api.post(
    endpoint,
    {
      reportKey,
      filename,
      html: clone.outerHTML,
      styles: collectDocumentStyles(),
      landscape,
      format,
      margin,
      printBackground: true,
      extraCss: `
        .pdf-report-meta-row > th {
          padding: 0 0 4mm !important;
          border: 0 !important;
          background: #ffffff !important;
          text-align: left !important;
        }
        .pdf-report-title {
          color: #2e2925;
          font-size: 18px;
          font-weight: 700;
          line-height: 1.2;
        }
        .pdf-report-subtitle {
          margin-top: 3px;
          color: #73685d;
          font-size: 10px;
          font-weight: 500;
        }
        ${extraCss}
      `,
      header: repeatHeader?.inTable
        ? null
        : {
            title: normalizeText(repeatHeader?.title),
            subtitle: normalizeText(repeatHeader?.subtitle),
          },
    },
    { responseType: "blob" },
  );

  downloadPdfResponse(response, filename);
};

export const exportHtmlToPdf = async ({
  html,
  className = "",
  ...options
} = {}) => {
  const container = document.createElement("div");
  container.className = className;
  container.style.position = "fixed";
  container.style.left = "-20000px";
  container.style.top = "0";
  container.style.width = "1120px";
  container.innerHTML = String(html || "");
  document.body.appendChild(container);

  try {
    await exportElementToPdf({
      ...options,
      element: container,
    });
  } finally {
    container.remove();
  }
};
