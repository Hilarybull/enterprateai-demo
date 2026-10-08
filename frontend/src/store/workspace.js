import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiRequest, apiRequestCached } from "../api/client";

// Dedupes concurrent callers (e.g. StrictMode's double effect, or two gated
// pages mounting together) so one navigation never creates two workspaces.
let ensureInFlight = null;

// Creates a default workspace for the current user if they don't have one yet
// and makes it active, so feature pages work immediately instead of forcing a
// "set up your workspace" step first.
export async function ensureWorkspaceId() {
  const state = useWorkspaceStore.getState();
  if (state.workspaceId) return state.workspaceId;
  if (ensureInFlight) return ensureInFlight;
  ensureInFlight = (async () => {
    // Usually the workspace already exists and simply hasn't been loaded yet (e.g. straight
    // after sign-in). Use it, quietly. Only create one, and say so, when there is none.
    const existing = await apiRequestCached("/validation/me").catch(() => null);
    if (existing?.id) {
      useWorkspaceStore.getState().setWorkspaceId(existing.id);
      useWorkspaceStore.getState().setWorkspaceName(existing.name || null);
      return existing.id;
    }
    return apiRequest("/validation/me", "PATCH", { name: "My workspace", data: {} }).then((ws) => {
      useWorkspaceStore.getState().setWorkspaceId(ws.id);
      useWorkspaceStore.getState().setWorkspaceName(ws.name || "My workspace");
      try {
        window.dispatchEvent(new CustomEvent("ea:toast", {
          detail: {
            kind: "info",
            title: "Workspace created",
            message: "We set up a workspace so this is saved. Rename it anytime from the sidebar.",
          },
        }));
      } catch {
        // Toast is a nicety, never block on it.
      }
      return ws.id;
    });
  })().finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

export const useWorkspaceStore = create(
  persist(
    (set) => ({
      workspaceId: null,
      // Whether the workspace is still being confirmed with the server (never persisted).
      // Pages that depend on the business wait for this instead of guessing: see workspaceStatusOf.
      workspaceChecks: 0,
      workspaceCheckedOnce: false,
      beginWorkspaceCheck: () => set((s) => ({ workspaceChecks: s.workspaceChecks + 1 })),
      endWorkspaceCheck: () => set((s) => ({ workspaceChecks: Math.max(0, s.workspaceChecks - 1), workspaceCheckedOnce: true })),
      workspaceName: null,
      workspaceLogo: null,
      workspaceCompanyName: null,
      workspaceOwnerEmail: null,
      decisionStatus: null, // accepted | rejected | null
      serviceDecisionStatus: null, // accepted | rejected | null
      workspaceLoadedAt: null,
      inputs: null,
      ideaValidation: null,
      draftIdeaValidation: null,
      draftServiceIdea: null,
      validation: null,
      validationEntryId: null,
      currency: "GBP",
      workspaceDataRefreshTrigger: 0,

      // Session-only workspace document data — set by Layout after fetch, never persisted.
      // Cleared on every page reload and after any save, so data is always fresh.
      wsDoc: null,
      setWsDoc: (doc) => set({ wsDoc: doc }),
      clearWsDoc: () => set({ wsDoc: null }),

      // Member mode — set when the user is accessing someone else's workspace via invite
      isMemberMode: false,
      membershipId: null,
      memberPermissionType: null,  // "module" | "feature"
      memberPermissions: null,     // { modules: [...] } or { features: {...} }
      memberWorkspaceName: null,

      setWorkspaceId: (workspaceId) => set({ workspaceId: workspaceId ?? null }),
      setWorkspaceName: (workspaceName) => set({ workspaceName: workspaceName || null }),
      setWorkspaceLogo: (workspaceLogo) => set({ workspaceLogo: workspaceLogo || null }),
      setWorkspaceCompanyName: (workspaceCompanyName) => set({ workspaceCompanyName: workspaceCompanyName || null }),
      setWorkspaceOwnerEmail: (workspaceOwnerEmail) => set({ workspaceOwnerEmail: workspaceOwnerEmail || null }),
      setDecisionStatus: (decisionStatus) => set({ decisionStatus: decisionStatus || null }),
      setServiceDecisionStatus: (serviceDecisionStatus) => set({ serviceDecisionStatus: serviceDecisionStatus || null }),
      setWorkspaceLoadedAt: (workspaceLoadedAt) => set({ workspaceLoadedAt: workspaceLoadedAt || null }),
      setInputs: (inputs) => set({ inputs: inputs ?? null }),
      setIdeaValidation: (ideaValidation) => set({ ideaValidation: ideaValidation ?? null }),
      setDraftIdeaValidation: (draftIdeaValidation) => set({ draftIdeaValidation: draftIdeaValidation ?? null }),
      setDraftServiceIdea: (draftServiceIdea) => set({ draftServiceIdea: draftServiceIdea ?? null }),
      setValidation: (validation) => set({ validation: validation ?? null }),
      setValidationEntryId: (validationEntryId) => set({ validationEntryId: validationEntryId ?? null }),
      setCurrency: (currency) => set({ currency: currency || "GBP" }),      refreshWorkspaceData: () => set((state) => ({ workspaceDataRefreshTrigger: state.workspaceDataRefreshTrigger + 1 })),
      setMemberMode: (membershipId, permType, perms, workspaceName) =>
        set({
          isMemberMode: true,
          membershipId: membershipId || null,
          memberPermissionType: permType || null,
          memberPermissions: perms || null,
          memberWorkspaceName: workspaceName || null,
        }),

      clearMemberMode: () =>
        set({
          isMemberMode: false,
          membershipId: null,
          memberPermissionType: null,
          memberPermissions: null,
          memberWorkspaceName: null,
        }),

      resetForUser: (email) =>
        set((s) => {
          // The same user as last time (a refresh, a new tab): keep the workspace they had
          // while the server confirms it, so pages never pass through a moment with no
          // business. Anyone else starts clean: a previous user's workspace is never reused.
          const same = Boolean(email) && s.workspaceOwnerEmail === email && Boolean(s.workspaceId);
          return {
          workspaceId: same ? s.workspaceId : null,
          workspaceName: same ? s.workspaceName : null,
          workspaceLogo: same ? s.workspaceLogo : null,
          workspaceCompanyName: same ? s.workspaceCompanyName : null,
          workspaceOwnerEmail: email || null,
          decisionStatus: null,
          serviceDecisionStatus: null,
          workspaceLoadedAt: null,
          inputs: null,
          ideaValidation: null,
          draftIdeaValidation: null,
          draftServiceIdea: null,
          validation: null,
          validationEntryId: null,
          currency: "GBP",
          isMemberMode: false,
          membershipId: null,
          memberPermissionType: null,
          memberPermissions: null,
          memberWorkspaceName: null,
          };
        })
    }),
    {
      name: "ea_workspace",
      partialize: (state) => ({
        workspaceId: state.workspaceId,
        workspaceName: state.workspaceName,
        workspaceLogo: state.workspaceLogo,
        workspaceCompanyName: state.workspaceCompanyName,
        workspaceOwnerEmail: state.workspaceOwnerEmail,
        decisionStatus: state.decisionStatus,
        serviceDecisionStatus: state.serviceDecisionStatus,
        workspaceLoadedAt: state.workspaceLoadedAt,
        currency: state.currency || "GBP",
        isMemberMode: state.isMemberMode,
        membershipId: state.membershipId,
        memberPermissionType: state.memberPermissionType,
        memberPermissions: state.memberPermissions,
        memberWorkspaceName: state.memberWorkspaceName,
        // inputs, ideaValidation, draftIdeaValidation, draftServiceIdea, validation,
        // validationEntryId intentionally NOT persisted — always fetched fresh from API.
      })
    }
  )
);

/** "ready" (a business is selected), "checking" (still being confirmed) or "none" (confirmed: there isn't one). */
export function workspaceStatusOf(state) {
  if (state.workspaceId) return "ready";
  return !state.workspaceCheckedOnce || state.workspaceChecks > 0 ? "checking" : "none";
}
