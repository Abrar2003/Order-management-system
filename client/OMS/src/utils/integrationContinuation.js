export function integrationContinuation(search, apiBase = import.meta.env?.VITE_API_BASE_URL || "/api") {
  const params = new URLSearchParams(search), state = params.get("state");
  if (params.get("continue") !== "eudr-v2" || !/^[a-f0-9]{64}$/.test(state || "")) return null;
  return { query: "?continue=eudr-v2&state=" + state,
    url: apiBase.replace(/\/$/, "") + "/integrations/eudr/v2/auth/launch?state=" + state };
}
