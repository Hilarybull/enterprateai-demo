import { apiRequest } from "../api/client";

// Adaptive Dashboard (PRD-AD-001). One composed view per business: context, financial
// summary, priority insights, the Agent summary, approvals, freshness and entitlement.

// Build-time switch for rollback. The server has its own (ADAPTIVE_DASHBOARD_ENABLED) and
// answers { enabled: false } when it is off; either one returns the dashboard to its
// previous behaviour. No data is migrated in either direction.
export const ADAPTIVE_DASHBOARD = String(import.meta.env?.VITE_ADAPTIVE_DASHBOARD ?? "true") !== "false";

// `previewPathway` ("startup" | "small_business") is for QA: the server composes the other
// pathway's priorities without changing the business, and ignores it in production.
// For QA, `preview` = { stage: "idea" | "pre_launch" | "operating" | "growth" } (or { pathway }):
// the server composes that stage's dashboard without changing the business, and ignores it in production.
export function getDashboard(businessId, preview) {
  const q = new URLSearchParams();
  if (preview?.stage) q.set("preview_stage", preview.stage);
  else if (preview?.pathway) q.set("preview_pathway", preview.pathway);
  const qs = q.toString();
  return apiRequest(`/businesses/${businessId}/dashboard${qs ? `?${qs}` : ""}`, "GET");
}

// "Not right? Change it": the stage the dashboard is composed for. `null` = read it from the records.
export const saveDashboardStage = (businessId, stage) =>
  apiRequest(`/businesses/${businessId}/dashboard/stage`, "PUT", { stage: stage || null });

export const saveDashboardPreferences = (businessId, patch) =>
  apiRequest(`/businesses/${businessId}/dashboard/preferences`, "PUT", patch);

// Usage signals for the dashboard's metrics (card opens, actions taken, tools opened).
// Fire-and-forget: a lost signal must never disturb the page.
export function trackDashboard(businessId, type, widgetId, detail) {
  if (!businessId || !type) return;
  try {
    apiRequest(`/businesses/${businessId}/dashboard/events`, "POST", { type, widget_id: widgetId || null, detail: detail || null }).catch(() => {});
  } catch {
    // ignored
  }
}

export const PATHWAY_LABEL = { startup: "Startup pathway", small_business: "Small Business pathway", multi_entity: "Multi-Entity pathway" };
export const STAGE_LABEL = { idea: "Idea", pre_launch: "Pre-launch", startup: "Startup", operating: "Operating", growth: "Growth" };
export const PRIORITY_LABEL = { 1: "Needs attention", 2: "Time-sensitive", 3: "Your goal", 4: "Next step", 5: "Insight" };

// The last composition for a business, kept for this browser tab only. On the next visit it
// is shown at once (marked "Updating…") while the fresh one loads, so the page never has to
// guess a stage. A QA preview of another stage is never remembered.
const lastKey = (businessId) => `ea:dashboard:last:${businessId}`;
export function rememberDashboard(businessId, dashboard) {
  try {
    if (businessId && dashboard?.enabled && !dashboard.context?.preview) sessionStorage.setItem(lastKey(businessId), JSON.stringify(dashboard));
  } catch { /* storage full or unavailable: the page simply shows its skeleton next time */ }
}
export function recallDashboard(businessId) {
  try {
    const d = JSON.parse(sessionStorage.getItem(lastKey(businessId)) || "null");
    return d?.enabled && d.business_id === businessId ? d : null;
  } catch { return null; }
}
export function forgetDashboard(businessId) {
  try { sessionStorage.removeItem(lastKey(businessId)); } catch { /* nothing to forget */ }
}
