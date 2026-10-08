import { apiRequest, getApiBaseUrl } from "../api/client";
import { shortDate } from "./format";

// Funding Readiness and Launch Readiness share one service and one set of screens.
// `FEATURES` holds everything that differs between them.
export const FEATURES = {
  funding: {
    key: "funding", segment: "funding-cases", base: "/funding", title: "Funding Readiness", noun: "funding case", nounPlural: "funding cases",
    newLabel: "New funding case", nameField: "title", namePlaceholder: "For example: Seed round",
    intro: "See how prepared you are to approach funders, what evidence is missing and what to do next.",
    caveat: "Readiness measures preparation against the checklist. It is not the likelihood of securing investment.",
    gatesTitle: "Gates", documentsTitle: "Materials",
  },
  launch: {
    key: "launch", segment: "launch-initiatives", base: "/launch", title: "Launch Readiness", noun: "launch", nounPlural: "launches",
    newLabel: "New launch", nameField: "name", namePlaceholder: "For example: Bookkeeping service launch",
    intro: "Work out what must be in place before you launch, what is blocking you and what to do next.",
    caveat: "Readiness measures preparation for the launch you define. It does not guarantee demand, profit or compliance, and nothing launches automatically.",
    gatesTitle: "Blockers", documentsTitle: "Report and checklist",
  },
};

export const CLASSIFICATION = {
  ready: { label: "Ready", tone: "emerald", mark: "✓" },
  conditionally_ready: { label: "Conditionally ready", tone: "amber", mark: "~" },
  not_ready: { label: "Not ready", tone: "rose", mark: "!" },
  insufficient_evidence: { label: "Not enough evidence yet", tone: "slate", mark: "?" },
};
export const CHECK_STATE = {
  passed: { label: "In place", mark: "✓", tone: "emerald" },
  failed: { label: "Not in place", mark: "✕", tone: "rose" },
  unknown: { label: "Not known yet", mark: "?", tone: "slate" },
};
export const ACTION_STATE = { open: "Open", in_progress: "In progress", awaiting_evidence: "Awaiting evidence", completed: "Completed", dismissed: "Dismissed" };
export const LIFECYCLE = { draft: "Draft", active: "Active", preparing: "Preparing", launched: "Launched", cancelled: "Cancelled", archived: "Archived" };
export const TONE = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  amber: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  rose: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
  slate: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

const root = (businessId, feature) => `/businesses/${businessId}/${FEATURES[feature].segment}`;
const q = (feature) => `?feature=${feature}`;

export const getProfiles = () => apiRequest("/readiness/profiles", "GET");
export const listSubjects = (businessId, feature) => apiRequest(root(businessId, feature), "GET");
export const createSubject = (businessId, feature, data) => apiRequest(root(businessId, feature), "POST", { data });
export const getSubject = (businessId, feature, id) => apiRequest(`${root(businessId, feature)}/${id}`, "GET");
export const updateSubject = (businessId, feature, id, revision, changes, confirm = []) =>
  apiRequest(`${root(businessId, feature)}/${id}`, "PATCH", { revision, changes, confirm });
export const setSubjectStatus = (businessId, feature, id, action, reason) => apiRequest(`${root(businessId, feature)}/${id}/status`, "POST", { action, reason: reason || null });
export const saveForecast = (businessId, feature, id, forecast, revision) => apiRequest(`${root(businessId, feature)}/${id}/forecast`, "PUT", { forecast, revision: revision ?? null });
export const linkForecast = (businessId, feature, id, forecastId) => apiRequest(`${root(businessId, feature)}/${id}/forecast/link`, "POST", { forecast_id: forecastId });
export const listForecasts = (businessId) => apiRequest(`/businesses/${businessId}/forecasts`, "GET");
export const attest = (businessId, feature, id, body) => apiRequest(`${root(businessId, feature)}/${id}/attestations`, "POST", body);
export const runAssessment = (businessId, feature, id, revision, key) =>
  apiRequest(`${root(businessId, feature)}/${id}/assessments`, "POST", { revision, idempotency_key: key }, { timeoutMs: 60000 });
export const getHistory = (businessId, feature, id) => apiRequest(`${root(businessId, feature)}/${id}/assessments`, "GET");
export const getAssessment = (businessId, feature, id, assessmentId) => apiRequest(`${root(businessId, feature)}/${id}/assessments/${assessmentId}`, "GET");
export const updateAction = (businessId, feature, id, actionId, changes) => apiRequest(`${root(businessId, feature)}/${id}/actions/${actionId}`, "PATCH", changes);
export const runScenario = (businessId, feature, id, change) => apiRequest(`${root(businessId, feature)}/${id}/scenarios`, "POST", change);
export const listMaterials = (businessId, feature, id) => apiRequest(`${root(businessId, feature)}/${id}/materials`, "GET");
export const generateMaterial = (businessId, feature, id, kind, key) =>
  apiRequest(`${root(businessId, feature)}/${id}/materials`, "POST", { kind, idempotency_key: key }, { timeoutMs: 60000 });
export const getMaterial = (businessId, feature, id, materialId) => apiRequest(`${root(businessId, feature)}/${id}/materials/${materialId}`, "GET");
export const updateMaterial = (businessId, feature, id, materialId, body) => apiRequest(`${root(businessId, feature)}/${id}/materials/${materialId}`, "PATCH", body);
export const reviewDocument = (businessId, id, key, body) => apiRequest(`/businesses/${businessId}/funding-cases/${id}/documents/${key}`, "POST", body);
export const contradiction = (businessId, id, body) => apiRequest(`/businesses/${businessId}/funding-cases/${id}/contradictions`, "POST", body);
export const recordDecision = (businessId, id, body) => apiRequest(`/businesses/${businessId}/launch-initiatives/${id}/decisions`, "POST", body);
export const recordLaunch = (businessId, id, body) => apiRequest(`/businesses/${businessId}/launch-initiatives/${id}/launch`, "POST", body);

export const addEvidence = (businessId, feature, data) => apiRequest(`/businesses/${businessId}/evidence${q(feature)}`, "POST", { data });
export const updateEvidence = (businessId, feature, evidenceId, data) => apiRequest(`/businesses/${businessId}/evidence/${evidenceId}${q(feature)}`, "PATCH", { data });
export const reviewEvidence = (businessId, feature, evidenceId, body) => apiRequest(`/businesses/${businessId}/evidence/${evidenceId}/review${q(feature)}`, "POST", body);
export function attachEvidenceFile(businessId, feature, evidenceId, file) {
  const form = new FormData();
  form.append("file", file);
  return apiRequest(`/businesses/${businessId}/evidence/${evidenceId}/file${q(feature)}`, "POST", form, { timeoutMs: 120000 });
}

// Downloads go through the API so access is checked at the moment of download.
async function download(path, fallbackName) {
  const token = localStorage.getItem("ea_token");
  const res = await fetch(`${getApiBaseUrl()}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const err = new Error(res.status === 403 ? "Your role doesn't allow this download." : "The file couldn't be downloaded. Please try again.");
    err.status = res.status;
    throw err;
  }
  const name = /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const downloadMaterial = (businessId, feature, id, materialId, format) =>
  download(`${root(businessId, feature)}/${id}/materials/${materialId}/download?format=${format}`, `readiness.${format}`);
export const downloadEvidenceFile = (businessId, evidenceId, name) => download(`/businesses/${businessId}/evidence/${evidenceId}/file`, name || "evidence");

/** What went wrong, in the shape the screens use: { message, errors, code, current, status }. */
export function readinessError(e, fallback = "Something went wrong. Please try again.") {
  if (e?.code === "NETWORK_ERROR") return { message: "Can't reach EnterprateAI right now. Nothing was changed, so it's safe to try again.", errors: {}, code: "network" };
  if (e?.code === "TIMEOUT") return { message: "That's taking longer than expected. Please try again.", errors: {}, code: "timeout" };
  const detail = e?.data?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return { message: detail.message || fallback, errors: detail.errors || {}, code: detail.code, current: detail.current, status: e.status };
  }
  if (e?.status === 404) return { message: "This can't be found. It may have been removed, or you may not have access.", errors: {}, code: "not_found", status: 404 };
  if (typeof detail === "string") return { message: detail, errors: {}, status: e.status };
  return { message: fallback, errors: {}, status: e?.status };
}

export const getPath = (obj, path) => path.split(".").reduce((cur, k) => (cur && typeof cur === "object" ? cur[k] : undefined), obj);
export function setPath(obj, path, value) {
  const keys = path.split(".");
  const out = { ...(obj || {}) };
  let cur = out;
  keys.slice(0, -1).forEach((k) => {
    cur[k] = cur[k] && typeof cur[k] === "object" && !Array.isArray(cur[k]) ? { ...cur[k] } : {};
    cur = cur[k];
  });
  cur[keys[keys.length - 1]] = value;
  return out;
}

export function monthLabel(key) {
  if (!/^\d{4}-\d{2}$/.test(key || "")) return key || "";
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
export const dateLabel = shortDate;

/** Why a result is out of date, without telling the person to run the check: it is re-run for them. */
export const staleReason = (reason) => String(reason || "").replace(/\s*Run the check again[^.]*\./g, "").trim();
export function moneyLabel(value, currency) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP", maximumFractionDigits: 2 }).format(n); } catch { return `${currency || ""} ${n.toFixed(2)}`.trim(); }
}
export const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`);
