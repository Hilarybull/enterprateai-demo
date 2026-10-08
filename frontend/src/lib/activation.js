import { apiRequest } from "../api/client";

// Product-tip emails: a person's own choice, and the administrator views of the journeys.

const q = (token) => `?token=${encodeURIComponent(token)}`;
export const unsubscribe = (token) => apiRequest(`/email/unsubscribe${q(token)}`, "POST", {});
export const getPreferences = (token) => apiRequest(`/email/preferences${q(token)}`, "GET");
export const savePreferences = (token, productTips) => apiRequest(`/email/preferences${q(token)}`, "PUT", { product_tips: productTips });
export const getMyPreferences = () => apiRequest("/auth/me/email-preferences", "GET");
export const saveMyPreferences = (productTips) => apiRequest("/auth/me/email-preferences", "PUT", { product_tips: productTips });

export const answerTipsPrompt = (productTips) => apiRequest("/auth/me/email-preferences/prompt", "POST", { product_tips: productTips });
/** The server says this feature's tables aren't there yet (migration 033 not run). */
export const notSetUp = (e) => e?.status === 503 && e?.data?.detail?.code === "not_set_up";

export const getActivation = () => apiRequest("/admin/activation", "GET", undefined, { timeoutMs: 60000 });
export const getActivationDryRun = (at) => apiRequest(`/admin/activation/dry-run${at ? `?at=${encodeURIComponent(at)}` : ""}`, "GET", undefined, { timeoutMs: 60000 });
export const getActivationUser = (email) => apiRequest(`/admin/activation/users/${encodeURIComponent(email)}`, "GET");
export const recordPermission = (email, status, source) => apiRequest(`/admin/activation/users/${encodeURIComponent(email)}/permission`, "PUT", { status, source });

export function activationError(e, fallback = "Something went wrong. Please try again.") {
  const detail = e?.data?.detail;
  if (typeof detail === "string" && detail !== "Not found.") return detail;      // the server's own words, when it gave some
  return e?.status === 404 ? "This link isn't valid any more." : fallback;
}

/** The person's timezone as the browser reports it, so emails arrive in their working day. */
export function browserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}
