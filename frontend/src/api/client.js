const API_URL =
  import.meta.env.VITE_API_URL ??
  import.meta.env.REACT_APP_BACKEND_URL ??
  "http://localhost:8000";

// ── In-flight deduplication for workspace GET requests ───────────────────────
// If two components request the same path at the same moment, they share one
// network call. The result is NOT stored — every new request goes to the server.
const _inflight = new Map();

export function invalidateWorkspaceCache() {
  _inflight.clear();
}

export async function apiRequestCached(path, options) {
  if (!path.startsWith("/validation")) return apiRequest(path, "GET", undefined, options);
  if (_inflight.has(path)) return _inflight.get(path);
  const p = apiRequest(path, "GET", undefined, options)
    .finally(() => _inflight.delete(path));
  _inflight.set(path, p);
  return p;
}

export function getApiBaseUrl() {
  return API_URL;
}

export async function apiRequest(path, method, body, options) {
  const token = localStorage.getItem("ea_token");
  const isFormData = body instanceof FormData;
  const headers = isFormData ? {} : { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  const controller = new AbortController();
  const timeoutMs = typeof options?.timeoutMs === "number" ? options.timeoutMs : 30000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e && typeof e === "object" && e.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    // Network error (backend down, wrong port, CORS, etc.)
    throw new Error("NETWORK_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    // Clear invalid token on 401
    if (res.status === 401) {
      localStorage.removeItem("ea_token");
      localStorage.removeItem("ea_email");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ea:unauthorized", { detail: { path, method } }));
      }
    }
    
    let message = `Request failed`;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
      else if (Array.isArray(data?.detail) && data.detail[0]?.msg) message = data.detail[0].msg;
      else if (typeof data?.message === "string") message = data.message;
      else message = JSON.stringify(data);
    } catch {
      const text = await res.text().catch(() => "");
      if (text) message = text;
    }
    throw new Error(`HTTP ${res.status}: ${message}`);
  }

  // Some endpoints might return empty body
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
