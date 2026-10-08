const API_URL =
  import.meta.env.VITE_API_URL ??
  import.meta.env.REACT_APP_BACKEND_URL ??
  "http://localhost:8000";

// ── Shared GET requests ──────────────────────────────────────────────────────
// Callers that ask for the same thing at the same moment share one network call,
// and the answer is reused for a short while so a page mounting right after
// another doesn't ask again. Every write (any non-GET request) empties both
// caches, so nothing stale is ever shown after a change.
const WORKSPACE_KEEP_MS = 5000;   // workspace document and agent summary
const SESSION_KEEP_MS = 30000;    // who the user is, their plan, grants and restrictions
const _workspace = new Map();     // path -> { promise, done, at }
const _session = new Map();       // `${token}|${path}` -> { promise, done, at }

function shared(map, key, keepMs, start, force) {
  const hit = map.get(key);
  if (hit && !force && (!hit.done || Date.now() - hit.at < keepMs)) return hit.promise;
  const entry = { done: false, at: Date.now() };
  entry.promise = start().then(
    (value) => {
      entry.done = true;
      entry.at = Date.now();
      return value;
    },
    (error) => {
      if (map.get(key) === entry) map.delete(key);
      throw error;
    },
  );
  map.set(key, entry);
  return entry.promise;
}

export function invalidateWorkspaceCache() {
  _workspace.clear();
}

export function clearSessionCache() {
  _session.clear();
}

const isWorkspaceRead = (path) => path.startsWith("/validation") || /^\/businesses\/[^/]+\/agent\/summary$/.test(path);

export async function apiRequestCached(path, options) {
  if (!isWorkspaceRead(path)) return apiRequest(path, "GET", undefined, options);
  return shared(_workspace, path, WORKSPACE_KEEP_MS, () =>
    apiRequest(path, "GET", undefined, options).then((value) => {
      // "/validation/me" and "/validation/<id>" are the same document: remember it under
      // its id too, so a page asking by id straight afterwards doesn't fetch it again.
      if (path === "/validation/me" && value?.id) {
        _workspace.set(`/validation/${value.id}`, { promise: Promise.resolve(value), done: true, at: Date.now() });
      }
      return value;
    }));
}

// The signed-in user's own details (/auth/me, /auth/grants, /auth/restrictions, /plans/my).
// Fetched once and shared; pass { force: true } after something is known to have changed.
export function sessionGet(path, { force = false, timeoutMs } = {}) {
  const token = localStorage.getItem("ea_token") || "";
  return shared(_session, `${token}|${path}`, SESSION_KEEP_MS,
    () => apiRequest(path, "GET", undefined, timeoutMs ? { timeoutMs } : undefined), force);
}

export function getApiBaseUrl() {
  return API_URL;
}

// The session is over: the server said so for this exact token. Never called for a
// timeout, a network error or a 5xx, and never for a token another tab has since replaced.
function endSession(token) {
  if (localStorage.getItem("ea_token") !== token) return;
  localStorage.removeItem("ea_token");
  localStorage.removeItem("ea_email");
  clearSessionCache();
  invalidateWorkspaceCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ea:unauthorized", { detail: { path: "/auth/me" } }));
  }
}

// A 401 from some other endpoint doesn't end the session by itself (it may be about
// that resource, or a blip while the server is busy). Ask /auth/me; only its 401 does.
let _confirming = null;
function confirmSession() {
  if (_confirming) return;
  _confirming = sessionGet("/auth/me", { force: true })
    .catch(() => {})
    .finally(() => { _confirming = null; });
}

// Identical GETs made at the same moment (two components mounting together, or React's
// development double-mount) share one network call. Nothing is kept once it completes,
// and each caller gets its own copy of the result.
const _sameMoment = new Map();

export async function apiRequest(path, method, body, options) {
  if (method !== "GET" || body) return send(path, method, body, options);
  const key = `${localStorage.getItem("ea_token") || ""}|${path}`;
  let pending = _sameMoment.get(key);
  if (!pending) {
    pending = send(path, method, body, options, true).finally(() => _sameMoment.delete(key));
    _sameMoment.set(key, pending);
  }
  const text = await pending;
  return text ? JSON.parse(text) : null;
}

async function send(path, method, body, options, asText = false) {
  const token = localStorage.getItem("ea_token");
  const isFormData = body instanceof FormData;
  const headers = isFormData ? {} : { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method && method !== "GET") {
    invalidateWorkspaceCache();
    if (/^\/(auth|plans|admin)\b/.test(path)) clearSessionCache();
  }

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
      const err = new Error("Request timed out. Please try again.");
      err.code = "TIMEOUT";
      throw err;
    }
    // Network error (backend down, wrong port, CORS, etc.)
    const err = new Error("NETWORK_ERROR");
    err.code = "NETWORK_ERROR";
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    if (res.status === 401 && token) {
      if (path === "/auth/me" && (!method || method === "GET")) endSession(token);
      else confirmSession();
    }

    let message = `Request failed`;
    let data = null;
    try {
      data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
      else if (Array.isArray(data?.detail) && data.detail[0]?.msg) message = data.detail[0].msg;
      else if (typeof data?.message === "string") message = data.message;
      else message = JSON.stringify(data);
    } catch {
      const text = await res.text().catch(() => "");
      if (text) message = text;
    }
    const err = new Error(`HTTP ${res.status}: ${message}`);
    err.status = res.status;
    err.data = data;          // parsed error body, e.g. { detail, code }
    throw err;
  }

  // Some endpoints might return empty body
  const text = await res.text();
  if (asText) return text;
  return text ? JSON.parse(text) : null;
}
