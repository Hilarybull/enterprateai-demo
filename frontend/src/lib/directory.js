import { apiRequest, getApiBaseUrl } from "../api/client";

// Marketplace Business Index and Claim: the public directory, the claim journey and a
// business's own Marketplace profile and opportunity settings.

export const searchBusinesses = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined));
  return apiRequest(`/marketplace/businesses?${q}`, "GET");
};
// An unclaimed profile may not be public. `via` is what the visitor holds that opens it: an
// invitation link's token, an exact-match lookup's grant, or the claim they started.
const viaQuery = (via) => {
  const q = new URLSearchParams(Object.entries(via || {}).filter(([, v]) => v));
  return q.toString() ? `?${q}` : "";
};
export const getBusinessProfile = (slug, via) => apiRequest(`/marketplace/businesses/${encodeURIComponent(slug)}${viaQuery(via)}`, "GET");
export const recordProfileView = (slug, via) => apiRequest(`/marketplace/businesses/${encodeURIComponent(slug)}/view${viaQuery(via)}`, "POST", {}).catch(() => {});
export const reportBusiness = (slug, body, via) => apiRequest(`/marketplace/businesses/${encodeURIComponent(slug)}/reports${viaQuery(via)}`, "POST", body);
export const claimLookup = (body) => apiRequest("/marketplace/claim-lookup", "POST", body);

/** What opens this profile for this visitor: taken from the address, and remembered for the tab so
 *  it survives sign-in and moving between the profile and the claim pages. */
export function profileAccess(slug, params) {
  const key = `ea:claim:access:${slug}`;
  let kept = {};
  try { kept = JSON.parse(sessionStorage.getItem(key) || "{}") || {}; } catch { kept = {}; }
  const via = { invite: params?.get("invite") || kept.invite || null, access: params?.get("access") || kept.access || null, intent: params?.get("intent") || kept.intent || null };
  try { if (via.invite || via.access || via.intent) sessionStorage.setItem(key, JSON.stringify(via)); } catch { /* the address still carries it */ }
  return via;
}
export const createClaimIntent = (slug, body) => apiRequest(`/marketplace/directory-profiles/${encodeURIComponent(slug)}/claim-intents`, "POST", body || {});
export const startClaim = (slug, body) => apiRequest(`/marketplace/directory-profiles/${encodeURIComponent(slug)}/claims`, "POST", body || {});
export const getClaim = (id) => apiRequest(`/business-claims/${id}`, "GET");
export const myClaims = () => apiRequest("/business-claims", "GET");
export const confirmMatch = (id, businessId) => apiRequest(`/business-claims/${id}/match`, "POST", { business_id: businessId });
export const startVerification = (id, body) => apiRequest(`/business-claims/${id}/verification`, "POST", body);
export const completeVerification = (id, verificationId, code) => apiRequest(`/business-claims/${id}/verification/${verificationId}/complete`, "POST", { code });
export const cancelClaim = (id) => apiRequest(`/business-claims/${id}/cancel`, "POST", {});
export const completeHandoff = (id) => apiRequest(`/business-claims/${id}/handoff`, "POST", {});
export function attachClaimEvidence(id, verificationId, file) {
  const form = new FormData();
  form.append("file", file);
  return apiRequest(`/business-claims/${id}/verification/${verificationId}/evidence`, "POST", form, { timeoutMs: 120000 });
}
export const claimableBusinesses = (params) => apiRequest(`/marketplace/claimable-businesses?${new URLSearchParams(params)}`, "GET");

export const getMarketplaceProfile = (businessId) => apiRequest(`/businesses/${businessId}/marketplace-profile`, "GET");
export const updateMarketplaceProfile = (businessId, changes, revision, claimId) =>
  apiRequest(`/businesses/${businessId}/marketplace-profile`, "PATCH", { changes, revision, claim_id: claimId || null });
export const updateOpportunityPreferences = (businessId, changes, claimId) =>
  apiRequest(`/businesses/${businessId}/marketplace-opportunity-preferences`, "PATCH", { changes, claim_id: claimId || null });
export const answerPossibleDuplicate = (businessId, profileId) => apiRequest(`/businesses/${businessId}/marketplace-profile/duplicate-answers`, "POST", { profile_id: profileId, answer: "not_mine" });
/** AI fill: a public description written from what the business has on record. Nothing is saved; it goes into the form. */
export const suggestMarketplaceDescription = (businessId, draft) => apiRequest(`/businesses/${businessId}/marketplace-profile/suggest-description`, "POST", draft);
export const suggestMarketplaceServices = (businessId, draft) => apiRequest(`/businesses/${businessId}/marketplace-profile/suggest-services`, "POST", draft);
export const activateMarketplaceProfile = (businessId, publish = true) => apiRequest(`/businesses/${businessId}/marketplace-profile/activate`, "POST", { publish });

// EnterprateAI staff
export const getClaimQueue = (status = "pending") => apiRequest(`/admin/marketplace/claims?status=${status}`, "GET");
export const decideClaim = (id, decision, reason) => apiRequest(`/business-claims/${id}/review-decision`, "POST", { decision, reason });
export const resolveReport = (id, action, reason) => apiRequest(`/admin/marketplace/reports/${id}/resolve`, "POST", { action, reason });
export const indexRecords = (records) => apiRequest("/admin/marketplace/directory/index", "POST", { records });
export const createInvitation = (ref, body) => apiRequest(`/admin/marketplace/directory-profiles/${ref}/invitations`, "POST", body);
export const getFunnel = () => apiRequest("/admin/marketplace/funnel", "GET");
export const normaliseLocations = () => apiRequest("/admin/marketplace/directory/normalise-locations", "POST", {});
export const getVisibility = () => apiRequest("/admin/marketplace/settings", "GET");
export const setVisibility = (level) => apiRequest("/admin/marketplace/settings", "PUT", { unclaimed_visibility: level });
export const getUnclaimedProfiles = () => apiRequest("/admin/marketplace/directory/unclaimed", "GET");
export const verifyOwnBusiness = (businessId) => apiRequest(`/businesses/${businessId}/marketplace-profile/verification`, "POST", {});
export const reviewListing = (ref, decision, reason) => apiRequest(`/admin/marketplace/listings/${encodeURIComponent(ref)}/review`, "POST", { decision, reason: reason || "" });
export const setProfileVisibility = (profiles, visibility, reason) => apiRequest("/admin/marketplace/directory/visibility", "POST", { profiles, visibility, reason: reason || "" });
export const checkBusiness = (record) => apiRequest("/admin/marketplace/directory/check", "POST", { record });
export const addBusiness = (record, allowDuplicate = false) => apiRequest("/admin/marketplace/directory/businesses", "POST", { record, allow_duplicate: allowDuplicate });
export const importBusinesses = (records, commit = false) => apiRequest("/admin/marketplace/directory/import", "POST", { records, commit }, { timeoutMs: 120000 });
export const editDirectoryProfile = (ref, changes, reason) => apiRequest(`/admin/marketplace/directory-profiles/${encodeURIComponent(ref)}`, "PATCH", { changes, reason: reason || "" });
export const getProfileSources = (ref) => apiRequest(`/admin/marketplace/directory-profiles/${encodeURIComponent(ref)}/sources`, "GET");
export const moderateProfile = (ref, action, reason) => apiRequest(`/admin/marketplace/directory-profiles/${encodeURIComponent(ref)}/moderation`, "POST", { action, reason });
export const moderatorAccess = () => apiRequest("/admin/marketplace/access", "GET");
export async function downloadClaimEvidence(verificationId, index, name) {
  const token = localStorage.getItem("ea_token");
  const res = await fetch(`${getApiBaseUrl()}/admin/marketplace/verifications/${verificationId}/files/${index}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error("The file couldn't be downloaded.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "evidence";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** What went wrong, in one shape: { message, errors, code, status, ...detail }. */
export function directoryError(e, fallback = "Something went wrong. Please try again.") {
  if (e?.code === "NETWORK_ERROR") return { message: "Can't reach EnterprateAI right now. Nothing was changed, so it's safe to try again.", errors: {}, code: "network" };
  if (e?.code === "TIMEOUT") return { message: "That's taking longer than expected. Please try again.", errors: {}, code: "timeout" };
  const detail = e?.data?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) return { ...detail, message: detail.message || fallback, errors: detail.errors || {}, status: e.status };
  if (e?.status === 404) return { message: "This can't be found. It may have been removed, or you may not have access.", errors: {}, code: "not_found", status: 404 };
  if (e?.status === 401) return { message: "Sign in to continue.", errors: {}, code: "signed_out", status: 401 };
  if (typeof detail === "string") return { message: detail, errors: {}, status: e.status };
  return { message: fallback, errors: {}, status: e?.status };
}

export const TRUST_TONE = { unclaimed: "slate", created: "slate", verified: "emerald", disputed: "amber" };
export const TRUST_MARK = { unclaimed: "", created: "", verified: "✓", disputed: "!" };
export const OPPORTUNITY_LABEL = { enquiries: "Enquiries", rfqs: "Quote requests", proposals: "Proposals", partnerships: "Partnerships", subcontracting: "Subcontracting" };

// The claim a person started before signing in is remembered for this tab, so the sign-in
// page can say what they are claiming and they come back to the same place.
const CLAIM_CONTEXT = "ea:claim:context";
export function rememberClaimContext(context) {
  try { sessionStorage.setItem(CLAIM_CONTEXT, JSON.stringify({ ...context, at: Date.now() })); } catch { /* the address still carries it */ }
}
export function claimContext() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CLAIM_CONTEXT) || "null");
    return c && Date.now() - c.at < 7 * 24 * 3600 * 1000 ? c : null;
  } catch { return null; }
}
export function forgetClaimContext() {
  try { sessionStorage.removeItem(CLAIM_CONTEXT); } catch { /* nothing to forget */ }
}
