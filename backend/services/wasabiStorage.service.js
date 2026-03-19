const crypto = require("crypto");
const https = require("https");

const normalizeValue = (value) => String(value || "").trim();

const getConfig = () => {
  const region = normalizeValue(process.env.WASABI_REGION) || "us-east-1";
  const endpoint = normalizeValue(process.env.WASABI_ENDPOINT)
    || `s3.${region}.wasabisys.com`;

  return {
    accessKeyId: normalizeValue(process.env.WASABI_ACCESS_KEY_ID),
    secretAccessKey: normalizeValue(process.env.WASABI_SECRET_ACCESS_KEY),
    bucket: normalizeValue(process.env.WASABI_BUCKET),
    region,
    endpoint,
    publicBaseUrl: normalizeValue(process.env.WASABI_PUBLIC_BASE_URL),
  };
};

const isConfigured = () => {
  const config = getConfig();
  return Boolean(
    config.accessKeyId
      && config.secretAccessKey
      && config.bucket
      && config.region
      && config.endpoint,
  );
};

const encodeKey = (key) =>
  String(key || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const createStorageKey = ({ folder = "uploads", originalName = "", extension = "" } = {}) => {
  const safeFolder = normalizeValue(folder).replace(/^\/+|\/+$/g, "") || "uploads";
  const original = normalizeValue(originalName);
  const inferredExtension = extension
    || (original.includes(".") ? `.${original.split(".").pop()}` : "");
  const safeExtension = inferredExtension.replace(/[^a-zA-Z0-9.]/g, "");
  const baseName = original
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";

  return `${safeFolder}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${baseName}${safeExtension}`;
};

const sha256Hex = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const hmac = (key, value, encoding) =>
  crypto.createHmac("sha256", key).update(value).digest(encoding);

const getSigningKey = ({ secretAccessKey, dateStamp, region }) => {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
};

const createSignedHeaders = ({
  method,
  key,
  body = Buffer.alloc(0),
  contentType = "application/octet-stream",
}) => {
  const config = getConfig();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = config.endpoint;
  const canonicalUri = `/${config.bucket}/${encodeKey(key)}`;
  const payloadHash = sha256Hex(body);

  const canonicalHeaders =
    `content-type:${contentType}\n`
    + `host:${host}\n`
    + `x-amz-content-sha256:${payloadHash}\n`
    + `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = hmac(
    getSigningKey({
      secretAccessKey: config.secretAccessKey,
      dateStamp,
      region: config.region,
    }),
    stringToSign,
    "hex",
  );

  return {
    host,
    path: canonicalUri,
    headers: {
      "content-type": contentType,
      "content-length": Buffer.byteLength(body),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, `
        + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
};

const sendRequest = ({ method, key, body, contentType }) =>
  new Promise((resolve, reject) => {
    const signed = createSignedHeaders({ method, key, body, contentType });

    const req = https.request(
      {
        hostname: signed.host,
        method,
        path: signed.path,
        headers: signed.headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            return resolve({
              statusCode: res.statusCode,
              body: responseBody,
            });
          }

          return reject(
            new Error(
              `Wasabi request failed with status ${res.statusCode}: ${responseBody || "unknown error"}`,
            ),
          );
        });
      },
    );

    req.on("error", reject);
    if (body?.length) {
      req.write(body);
    }
    req.end();
  });

const getObjectUrl = (key) => {
  const config = getConfig();
  const encodedKey = encodeKey(key);
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/+$/g, "")}/${encodedKey}`;
  }
  return `https://${config.endpoint}/${config.bucket}/${encodedKey}`;
};

const uploadBuffer = async ({
  buffer,
  key,
  contentType = "application/octet-stream",
}) => {
  if (!isConfigured()) {
    throw new Error("Wasabi storage is not configured");
  }

  await sendRequest({
    method: "PUT",
    key,
    body: buffer,
    contentType,
  });

  return {
    key,
    url: getObjectUrl(key),
    bucket: getConfig().bucket,
    endpoint: getConfig().endpoint,
    contentType,
    size: Buffer.byteLength(buffer),
  };
};

const deleteObject = async (key) => {
  if (!isConfigured() || !normalizeValue(key)) return;
  await sendRequest({
    method: "DELETE",
    key,
    body: Buffer.alloc(0),
    contentType: "application/octet-stream",
  });
};

module.exports = {
  isConfigured,
  createStorageKey,
  getObjectUrl,
  uploadBuffer,
  deleteObject,
};
