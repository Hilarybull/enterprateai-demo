import { create } from "zustand";
import { apiRequest } from "../api/client";

export const PROPOSAL_STATUSES = [
  "DRAFT", "SUBMITTED", "VIEWED", "UNDER_REVIEW",
  "CLARIFICATION_REQUESTED", "REVISION_REQUESTED", "SHORTLISTED",
  "PREFERRED", "NEGOTIATION", "AWARDED", "CONTRACT_DRAFTED",
  "CONTRACTED", "DECLINED", "WITHDRAWN", "EXPIRED", "ARCHIVED",
];

export const ACTIVE_STATUSES = [
  "SUBMITTED", "VIEWED", "UNDER_REVIEW",
  "CLARIFICATION_REQUESTED", "REVISION_REQUESTED", "SHORTLISTED",
  "PREFERRED", "NEGOTIATION",
];

export const TERMINAL_STATUSES = [
  "AWARDED", "CONTRACT_DRAFTED", "CONTRACTED",
  "DECLINED", "WITHDRAWN", "EXPIRED", "ARCHIVED",
];

export const STATUS_LABELS = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  VIEWED: "Viewed",
  UNDER_REVIEW: "Under Review",
  CLARIFICATION_REQUESTED: "Clarification Requested",
  REVISION_REQUESTED: "Revision Requested",
  SHORTLISTED: "Shortlisted",
  PREFERRED: "Preferred",
  NEGOTIATION: "In Negotiation",
  AWARDED: "Awarded",
  CONTRACT_DRAFTED: "Contract Drafted",
  CONTRACTED: "Contracted",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
  EXPIRED: "Expired",
  ARCHIVED: "Archived",
};

export const STATUS_COLORS = {
  DRAFT: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  SUBMITTED: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  VIEWED: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  UNDER_REVIEW: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  CLARIFICATION_REQUESTED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  REVISION_REQUESTED: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  SHORTLISTED: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  PREFERRED: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  NEGOTIATION: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
  AWARDED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  CONTRACT_DRAFTED: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  CONTRACTED: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  DECLINED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  WITHDRAWN: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  EXPIRED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  ARCHIVED: "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
};

// Entitlement check — Starter Insight or higher required to submit/generate
export function hasPaidAccess(planKey) {
  return ["starter_insight", "growth", "scale", "enterprise"].includes(planKey);
}

export const useProposalStore = create((set, get) => ({
  // Preferences
  preferences: null,
  preferencesLoading: false,
  preferencesError: null,

  // Proposal requests (Procurement side — requests I created)
  requests: [],
  requestsLoading: false,
  requestsError: null,

  // Inbox (recipient — proposals I received)
  inbox: [],
  inboxLoading: false,
  inboxError: null,
  inboxUnread: 0,

  // Activity (proposer — proposals I submitted)
  activity: [],
  activityLoading: false,
  activityError: null,

  // Upload session for anonymous/paid upload flow
  uploadSession: null,
  uploadSessionLoading: false,
  uploadSessionError: null,

  // ── Preferences ──────────────────────────────────────────────────────────────

  fetchPreferences: async () => {
    set({ preferencesLoading: true, preferencesError: null });
    try {
      const data = await apiRequest("/proposals/preferences", "GET");
      set({ preferences: data ?? null });
    } catch (e) {
      set({ preferencesError: e instanceof Error ? e.message : "Failed to load preferences." });
    } finally {
      set({ preferencesLoading: false });
    }
  },

  savePreferences: async (prefs) => {
    set({ preferencesLoading: true, preferencesError: null });
    try {
      const data = await apiRequest("/proposals/preferences", "PUT", prefs);
      set({ preferences: data ?? prefs });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save preferences.";
      set({ preferencesError: msg });
      return { ok: false, error: msg };
    } finally {
      set({ preferencesLoading: false });
    }
  },

  // ── Requests (Procurement) ────────────────────────────────────────────────────

  fetchRequests: async () => {
    set({ requestsLoading: true, requestsError: null });
    try {
      const data = await apiRequest("/proposals/requests", "GET");
      set({ requests: Array.isArray(data) ? data : [] });
    } catch (e) {
      set({ requestsError: e instanceof Error ? e.message : "Failed to load requests." });
    } finally {
      set({ requestsLoading: false });
    }
  },

  createRequest: async (payload) => {
    try {
      const data = await apiRequest("/proposals/requests", "POST", payload);
      set((s) => ({ requests: [data, ...s.requests] }));
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to create request." };
    }
  },

  updateRequest: async (id, payload) => {
    try {
      const data = await apiRequest(`/proposals/requests/${id}`, "PATCH", payload);
      set((s) => ({ requests: s.requests.map((r) => (r.id === id ? { ...r, ...data } : r)) }));
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to update request." };
    }
  },

  publishRequest: async (id) => {
    try {
      const data = await apiRequest(`/proposals/requests/${id}/publish`, "POST");
      set((s) => ({ requests: s.requests.map((r) => (r.id === id ? { ...r, status: "PUBLISHED", ...data } : r)) }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to publish request." };
    }
  },

  closeRequest: async (id) => {
    try {
      const data = await apiRequest(`/proposals/requests/${id}/close`, "POST");
      set((s) => ({ requests: s.requests.map((r) => (r.id === id ? { ...r, status: "CLOSED", ...data } : r)) }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to close request." };
    }
  },

  reopenRequest: async (id) => {
    try {
      const data = await apiRequest(`/proposals/requests/${id}/reopen`, "POST");
      set((s) => ({ requests: s.requests.map((r) => (r.id === id ? { ...r, status: "PUBLISHED", ...data } : r)) }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to reopen request." };
    }
  },

  deleteRequest: async (id) => {
    const prev = get().requests;
    set((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));
    try {
      await apiRequest(`/proposals/requests/${id}`, "DELETE");
      return { ok: true };
    } catch (e) {
      set({ requests: prev });
      return { ok: false, error: e instanceof Error ? e.message : "Failed to delete request." };
    }
  },

  // ── Inbox ─────────────────────────────────────────────────────────────────────

  fetchInbox: async () => {
    set({ inboxLoading: true, inboxError: null });
    try {
      const data = await apiRequest("/proposals/inbox", "GET");
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      const unread = items.filter((p) => p.status === "SUBMITTED" && !p.viewed_at).length;
      set({ inbox: items, inboxUnread: unread });
    } catch (e) {
      set({ inboxError: e instanceof Error ? e.message : "Failed to load inbox." });
    } finally {
      set({ inboxLoading: false });
    }
  },

  // ── Activity ──────────────────────────────────────────────────────────────────

  fetchActivity: async () => {
    set({ activityLoading: true, activityError: null });
    try {
      const data = await apiRequest("/proposals/activity", "GET");
      set({ activity: Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [] });
    } catch (e) {
      set({ activityError: e instanceof Error ? e.message : "Failed to load activity." });
    } finally {
      set({ activityLoading: false });
    }
  },

  // ── Status transition ─────────────────────────────────────────────────────────

  transitionStatus: async (proposalId, newStatus, reason) => {
    try {
      const data = await apiRequest(`/proposals/${proposalId}/status`, "POST", { status: newStatus, reason });
      // Update in both inbox and activity
      const patch = (list) => list.map((p) => (p.id === proposalId ? { ...p, status: newStatus, ...data } : p));
      set((s) => ({ inbox: patch(s.inbox), activity: patch(s.activity) }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to update status." };
    }
  },

  deleteFromInbox: async (proposalId) => {
    try {
      await apiRequest(`/proposals/inbox/${proposalId}`, "DELETE");
      set((s) => ({ inbox: s.inbox.filter((p) => p.id !== proposalId) }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to delete proposal." };
    }
  },

  linkToRequest: async (proposalId, requestId) => {
    try {
      const data = await apiRequest(`/proposals/inbox/${proposalId}/link`, "PATCH", { request_id: requestId });
      set((s) => ({ inbox: s.inbox.map((p) => p.id === proposalId ? { ...p, request_id: requestId, ...data } : p) }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to link proposal." };
    }
  },

  // ── Upload session ────────────────────────────────────────────────────────────

  submitProposal: async (payload) => {
    try {
      const data = await apiRequest("/proposals/submit", "POST", payload);
      // Append to activity list
      set((s) => ({ activity: [data, ...s.activity] }));
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to submit proposal." };
    }
  },

  createUploadSession: async (requestId) => {
    set({ uploadSessionLoading: true, uploadSessionError: null });
    try {
      const data = await apiRequest("/proposals/upload-session", "POST", { request_id: requestId });
      set({ uploadSession: data });
      return { ok: true, data };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create upload session.";
      set({ uploadSessionError: msg });
      return { ok: false, error: msg };
    } finally {
      set({ uploadSessionLoading: false });
    }
  },

  clearUploadSession: () => set({ uploadSession: null, uploadSessionError: null }),
}));
