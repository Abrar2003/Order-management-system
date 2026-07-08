import axios from "axios";

const instance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  withCredentials: true,
});

let refreshRequest = null;

const VENDOR_SINGLE_KEYS = new Set(["vendor"]);
const VENDOR_ARRAY_KEYS = new Set(["vendors", "uploaded_vendors", "vendor_options"]);

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isVendorRefObject = (value) =>
  isPlainObject(value) &&
  (
    Object.prototype.hasOwnProperty.call(value, "vendor_id") ||
    Object.prototype.hasOwnProperty.call(value, "vendorId") ||
    Object.prototype.hasOwnProperty.call(value, "country")
  ) &&
  (value.name || value.vendor_name || value.vendorName || value.label || value.value);

const getVendorDisplayName = (value) => {
  if (typeof value === "string") return value.trim();
  if (!isPlainObject(value)) return "";
  return String(
    value.name ||
      value.vendor_name ||
      value.vendorName ||
      value.label ||
      value.value ||
      "",
  ).trim();
};

const normalizeVendorArray = (values = []) => {
  const rawValues = Array.isArray(values) ? values : [values];
  const canFlatten = rawValues.every(
    (entry) => typeof entry === "string" || isVendorRefObject(entry),
  );
  if (!canFlatten) return rawValues.map((entry) => normalizeApiVendorRefs(entry));

  return [
    ...new Set(rawValues.map(getVendorDisplayName).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
};

const normalizeApiVendorRefs = (value, key = "") => {
  if (Array.isArray(value)) {
    if (VENDOR_ARRAY_KEYS.has(key)) return normalizeVendorArray(value);
    return value.map((entry) => normalizeApiVendorRefs(entry));
  }

  if (!isPlainObject(value)) return value;

  if (VENDOR_SINGLE_KEYS.has(key)) {
    const displayName = getVendorDisplayName(value);
    if (displayName) return displayName;
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      normalizeApiVendorRefs(entryValue, entryKey),
    ]),
  );
};

const redirectToSignin = () => {
  if (window.location.pathname !== "/signin") {
    window.location.assign("/signin");
  }
};

instance.interceptors.response.use(
  (res) => {
    if (res?.data) {
      res.data = normalizeApiVendorRefs(res.data);
    }
    return res;
  },
  async (err) => {
    const originalRequest = err.config || {};

    if (
      err.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.skipAuthRefresh
    ) {
      originalRequest._retry = true;
      try {
        refreshRequest =
          refreshRequest ||
          instance.post("/auth/refresh", null, { skipAuthRefresh: true });
        await refreshRequest;
        refreshRequest = null;
        return instance(originalRequest);
      } catch (refreshError) {
        refreshRequest = null;
        redirectToSignin();
        return Promise.reject(refreshError);
      }
    }

    if (err.response?.status === 401 && !originalRequest.skipAuthRefresh) {
      redirectToSignin();
    }
    return Promise.reject(err);
  },
);

export default instance;
