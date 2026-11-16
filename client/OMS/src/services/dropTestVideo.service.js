import api from "../api/axios.js";
import { uploadFileToPresignedWasabiUrl } from "./qcImages.service.js";

export const MAX_DROP_TEST_VIDEO_SIZE = 900_000_000;
const FINGERPRINT_CHUNK_SIZE = 5 * 1024 * 1024;
const RETRY_DELAYS = [1000, 3000, 7000];
const STALL_TIMEOUT = 90_000;
const fingerprints = new WeakMap();

const fingerprintVideo = async (file) => {
  if (fingerprints.has(file)) return fingerprints.get(file);
  // Hash each slice to keep memory bounded on phones.
  const digests = new Uint8Array(Math.ceil(file.size / FINGERPRINT_CHUNK_SIZE) * 32);
  for (let start = 0; start < file.size; start += FINGERPRINT_CHUNK_SIZE) {
    const bytes = await file.slice(start, start + FINGERPRINT_CHUNK_SIZE).arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    digests.set(new Uint8Array(digest), 32 * (start / FINGERPRINT_CHUNK_SIZE));
  }
  const digest = await crypto.subtle.digest("SHA-256", digests);
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  fingerprints.set(file, fingerprint);
  return fingerprint;
};

const retry = async (action, { refreshOnForbidden = false, onRetry } = {}) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      const status = error.response?.status;
      const transient = !status || status >= 500 || status === 408 || status === 429 ||
        (refreshOnForbidden && status === 403);
      if (!transient || attempt === RETRY_DELAYS.length) throw error;
      onRetry?.();
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
};

const uploadPart = async (uploadUrl, file, onProgress) => {
  const controller = new AbortController();
  let timer;
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), STALL_TIMEOUT);
  };
  resetTimer();
  try {
    await uploadFileToPresignedWasabiUrl({
      uploadUrl, file, signal: controller.signal, timeout: 0,
      onUploadProgress: ({ loaded }) => { resetTimer(); onProgress(loaded); },
    });
  } finally {
    clearTimeout(timer);
  }
};

export const uploadDropTestVideo = async ({ endpoint, scope, file, onProgress }) => {
  onProgress("Checking video…");
  const fingerprint = await fingerprintVideo(file);
  const config = { timeout: 45_000 };
  const onRetry = () => onProgress("Connection interrupted. Retrying…");
  const response = await retry(() => api.post(`${endpoint}/video-uploads`, {
    ...scope, name: file.name, size: file.size, fingerprint,
  }, config), { onRetry });
  const { upload_id, part_size, uploaded_parts, complete } = response.data.data;
  if (complete) return upload_id;

  const uploaded = new Set(uploaded_parts);
  const parts = Math.ceil(file.size / part_size);
  const sizeOf = (part) => Math.min(part_size, file.size - (part - 1) * part_size);
  let confirmed = uploaded_parts.reduce((total, part) => total + sizeOf(part), 0);
  const report = (inFlight = 0) => onProgress(`${Math.floor((confirmed + inFlight) / file.size * 100)}% uploaded`);

  report();
  for (let part = 1; part <= parts; part += 1) {
    if (uploaded.has(part)) continue;
    const start = (part - 1) * part_size;
    const chunk = file.slice(start, start + sizeOf(part));
    await retry(async () => {
      const { data } = await api.post(`${endpoint}/video-uploads/${upload_id}/parts/${part}`, scope, config);
      await uploadPart(data.data.upload_url, chunk, report);
    }, { refreshOnForbidden: true, onRetry });
    confirmed += chunk.size;
    report();
  }
  return upload_id;
};
