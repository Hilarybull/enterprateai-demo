import { apiRequest } from "../api/client";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export async function saveSourcingDraft(requestId, workspaceId, payload) {
  const path = "/proposals/sourcing/drafts/" + encodeURIComponent(requestId)
    + "?workspace_id=" + encodeURIComponent(workspaceId);
  const fields = { ...payload, description: payload.description || "" };
  try {
    return await apiRequest(path, "PUT", fields, { timeoutMs: 120000 });
  } catch (error) {
    if (error.code !== "TIMEOUT" && error.code !== "NETWORK_ERROR" && !(error.status >= 500)) throw error;
    // A disconnected response can follow a committed write. Check the same record before reporting failure.
    try {
      const { record } = await apiRequest(path, "GET", undefined, { timeoutMs: 30000 });
      if (record && Object.entries(fields).every(([key, value]) =>
        JSON.stringify(stable(record[key === "kind" ? "sourcing_kind" : key])) === JSON.stringify(stable(value)))) {
        return record;
      }
    } catch { /* Preserve the original failure if confirmation is unavailable. */ }
    throw error;
  }
}
