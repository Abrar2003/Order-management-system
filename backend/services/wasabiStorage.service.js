const crypto = require("crypto");
const { Upload } = require("@aws-sdk/lib-storage");
const {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const normalizeValue = (value) => String(value || "").trim();

const pickFirstDefinedEnvValue = (...keys) => {
  for (const key of keys) {
    const value = normalizeValue(process.env[key]);
    if (value) return value;
  }
  return "";
};

const normalizeEndpoint = (value = "", region = "us-east-1") => {
  const normalizedValue = normalizeValue(value);
  const rawEndpoint = normalizedValue || `s3.${region}.wasabisys.com`;
  const endpointWithProtocol = /^https?:\/\//i.test(rawEndpoint)
    ? rawEndpoint
    : `https://${rawEndpoint}`;

  return endpointWithProtocol.replace(/\/+$/g, "");
};

const normalizeOptionalEndpoint = (value = "", region = "us-east-1") => {
  const normalizedValue = normalizeValue(value);
  if (!normalizedValue) return "";
  return normalizeEndpoint(normalizedValue, region);
};

const getConfig = () => {
  const region = pickFirstDefinedEnvValue("WASABI_REGION") || "us-east-1";
  const endpoint = normalizeEndpoint(
    pickFirstDefinedEnvValue("WASABI_ENDPOINT"),
    region,
  );

  return {
    accessKeyId: pickFirstDefinedEnvValue(
      "WASABI_ACCESS_KEY_ID",
      "WASABI_ACCESS_KEY",
    ),
    secretAccessKey: pickFirstDefinedEnvValue(
      "WASABI_SECRET_ACCESS_KEY",
      "WASABI_ACCESS_SECRET_KEY",
    ),
    bucket: pickFirstDefinedEnvValue("WASABI_BUCKET", "WASABI_BUCKET_NAME"),
    region,
    endpoint,
    publicBaseUrl: normalizeOptionalEndpoint(
      pickFirstDefinedEnvValue("WASABI_PUBLIC_BASE_URL"),
      region,
    ),
    signedUrlExpiresIn: Number(
      pickFirstDefinedEnvValue("WASABI_SIGNED_URL_EXPIRES_IN") || 86400,
    ),
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

const createStorageKey = ({
  folder = "uploads",
  originalName = "",
  extension = "",
} = {}) => {
  const safeFolder = normalizeValue(folder).replace(/^\/+|\/+$/g, "") || "uploads";
  const original = normalizeValue(originalName);
  const inferredExtension =
    extension || (original.includes(".") ? `.${original.split(".").pop()}` : "");
  const safeExtension = inferredExtension.replace(/[^a-zA-Z0-9.]/g, "");
  const baseName = original
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";

  return `${safeFolder}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${baseName}${safeExtension}`;
};

let cachedClient = null;
let cachedClientKey = "";
const DEFAULT_UPLOAD_QUEUE_SIZE = 4;
const DEFAULT_UPLOAD_PART_SIZE = 8 * 1024 * 1024;

const getClient = () => {
  if (!isConfigured()) {
    throw new Error("Wasabi storage is not configured");
  }

  const config = getConfig();
  const clientKey = JSON.stringify({
    accessKeyId: config.accessKeyId,
    bucket: config.bucket,
    endpoint: config.endpoint,
    region: config.region,
  });

  if (cachedClient && cachedClientKey === clientKey) {
    return cachedClient;
  }

  cachedClient = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedClientKey = clientKey;

  return cachedClient;
};

const getObjectUrl = (key) => {
  const config = getConfig();
  const encodedKey = encodeKey(key);

  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/+$/g, "")}/${encodedKey}`;
  }

  return `${config.endpoint}/${config.bucket}/${encodedKey}`;
};

const getSignedObjectUrl = async (
  key,
  {
    expiresIn,
    download = false,
    filename = "",
  } = {},
) => {
  if (!normalizeValue(key)) {
    throw new Error("Object key is required for signed URL");
  }

  const client = getClient();
  const config = getConfig();

  const safeExpiresIn =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn
      : config.signedUrlExpiresIn;

  const safeFilename = normalizeValue(filename);
  const responseContentDisposition = safeFilename
    ? `${download ? "attachment" : "inline"}; filename="${safeFilename.replace(/"/g, "")}"`
    : undefined;

  try {
    const signedUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ...(responseContentDisposition
          ? { ResponseContentDisposition: responseContentDisposition }
          : {}),
      }),
      { expiresIn: safeExpiresIn },
    );

    return signedUrl;
  } catch (error) {
    throw new Error(
      `Wasabi signed URL generation failed: ${error?.message || String(error)}`,
    );
  }
};

const uploadBuffer = async ({
  buffer,
  key,
  originalName = "",
  contentType = "application/octet-stream",
  queueSize = DEFAULT_UPLOAD_QUEUE_SIZE,
  partSize = DEFAULT_UPLOAD_PART_SIZE,
}) => {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("uploadBuffer requires buffer to be a Buffer");
  }

  if (!normalizeValue(key)) {
    throw new Error("uploadBuffer requires a storage key");
  }

  const client = getClient();
  const config = getConfig();
  const safeQueueSize = Math.max(1, Number(queueSize) || DEFAULT_UPLOAD_QUEUE_SIZE);
  const safePartSize = Math.max(
    5 * 1024 * 1024,
    Number(partSize) || DEFAULT_UPLOAD_PART_SIZE,
  );

  try {
    const uploader = new Upload({
      client,
      queueSize: safeQueueSize,
      partSize: safePartSize,
      leavePartsOnError: false,
      params: {
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      },
    });

    await uploader.done();
  } catch (error) {
    throw new Error(
      `Wasabi upload failed: ${error?.message || String(error)}`,
    );
  }

  return {
    key,
    originalName: normalizeValue(originalName),
    contentType,
    size: Buffer.byteLength(buffer),
  };
};

const deleteObject = async (key) => {
  if (!normalizeValue(key) || !isConfigured()) return;

  const client = getClient();
  const config = getConfig();

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );
  } catch (error) {
    throw new Error(
      `Wasabi delete failed: ${error?.message || String(error)}`,
    );
  }
};

module.exports = {
  isConfigured,
  createStorageKey,
  getObjectUrl,
  getSignedObjectUrl,
  uploadBuffer,
  deleteObject,
};
