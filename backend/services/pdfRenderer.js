const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { fileURLToPath, pathToFileURL } = require("url");

const { buildPdfPrintStyles } = require("./pdfPrintStyles");

let browserPromise = null;

const escapeHeaderHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const findSystemBrowser = () => {
  const candidates = process.platform === "win32"
    ? [
        path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
};

const getLaunchOptions = () => {
  const executablePath = String(
    process.env.PUPPETEER_EXECUTABLE_PATH
      || process.env.CHROME_EXECUTABLE_PATH
      || findSystemBrowser()
      || "",
  ).trim();
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ];

  return {
    headless: true,
    args,
    ...(executablePath ? { executablePath } : {}),
  };
};

const getBrowser = async () => {
  if (!browserPromise) {
    browserPromise = puppeteer.launch(getLaunchOptions()).catch((error) => {
      browserPromise = null;
      throw error;
    });
  }

  const browser = await browserPromise;
  if (!browser.connected) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
};

const waitForAssets = async (page) => {
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    const images = Array.from(document.images || []);
    await Promise.all(
      images.map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }),
    );
  });
};

const renderPdf = async ({
  html,
  styles = "",
  format = "A4",
  landscape = false,
  margin = {},
  printBackground = true,
  width,
  height,
  extraCss = "",
  basePath = "",
  header = null,
} = {}) => {
  if (!String(html || "").trim()) {
    throw new Error("PDF HTML content is required");
  }

  const browser = await getBrowser();
  const page = await browser.newPage();
  const resolvedBasePath = basePath ? path.resolve(basePath) : "";

  try {
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      if (/^(data:|blob:|about:)/i.test(url)) {
        request.continue();
      } else if (/^file:/i.test(url) && resolvedBasePath) {
        try {
          const requestedPath = path.resolve(fileURLToPath(url));
          const relativePath = path.relative(resolvedBasePath, requestedPath);
          if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
            request.continue();
          } else {
            request.abort();
          }
        } catch {
          request.abort();
        }
      } else {
        request.abort();
      }
    });

    const printCss = buildPdfPrintStyles({
      format,
      landscape,
      margin,
      extraCss,
    });
    const headAdditions = `
      ${resolvedBasePath ? `<base href="${pathToFileURL(`${resolvedBasePath}${path.sep}`).href}" />` : ""}
      <style>${styles}</style>
      <style>${printCss}</style>
    `;
    const sourceHtml = String(html || "");
    const isFullDocument = /<html[\s>]/i.test(sourceHtml);
    const documentHtml = isFullDocument
      ? sourceHtml
          .replace(/<head([^>]*)>/i, `<head$1>${headAdditions}`)
          .replace(/<body([^>]*)>/i, (_match, attributes = "") => {
            if (/\bclass\s*=/i.test(attributes)) {
              return `<body${attributes.replace(
                /\bclass\s*=\s*(["'])(.*?)\1/i,
                (_classMatch, quote, classNames) =>
                  `class=${quote}${classNames} pdf-report${quote}`,
              )}>`;
            }
            return `<body${attributes} class="pdf-report">`;
          })
      : `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            ${headAdditions}
          </head>
          <body>
            <main class="pdf-report">${sourceHtml}</main>
          </body>
        </html>`;

    await page.setContent(documentHtml, {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: 45000,
    });
    await page.emulateMediaType("print");
    await waitForAssets(page);

    const pdfBuffer = await page.pdf({
      format: width || height ? undefined : format,
      landscape,
      margin,
      printBackground,
      preferCSSPageSize: true,
      displayHeaderFooter: Boolean(header?.title || header?.subtitle),
      headerTemplate: header?.title || header?.subtitle
        ? `
          <div style="box-sizing:border-box;width:100%;padding:0 8mm;color:#2e2925;font-family:Arial,sans-serif;">
            <div style="font-size:10px;font-weight:700;">${escapeHeaderHtml(header?.title)}</div>
            <div style="margin-top:1px;color:#73685d;font-size:7px;">${escapeHeaderHtml(header?.subtitle)}</div>
          </div>
        `
        : "<span></span>",
      footerTemplate: header?.title || header?.subtitle
        ? `
          <div style="box-sizing:border-box;width:100%;padding:0 8mm;color:#73685d;font-family:Arial,sans-serif;font-size:7px;text-align:right;">
            Page <span class="pageNumber"></span> of <span class="totalPages"></span>
          </div>
        `
        : "<span></span>",
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });

    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error("Chromium generated an empty PDF");
    }

    return Buffer.from(pdfBuffer);
  } finally {
    await page.close().catch(() => {});
  }
};

const closePdfRenderer = async () => {
  const activePromise = browserPromise;
  browserPromise = null;
  if (!activePromise) return;

  try {
    const browser = await activePromise;
    await browser.close();
  } catch (error) {
    console.error("Failed to close PDF Chromium browser:", error);
  }
};

module.exports = {
  closePdfRenderer,
  renderPdf,
};
