import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useWorkspaceStore = create(
  persist(
    (set) => ({
      workspaceId: null,
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
      currency: "GBP",

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
      setCurrency: (currency) => set({ currency: currency || "GBP" }),

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
        set((state) => {
          if (!email) {
            return {
              workspaceId: null,
              workspaceName: null,
              workspaceLogo: null,
              workspaceCompanyName: null,
              workspaceOwnerEmail: null,
              decisionStatus: null,
              serviceDecisionStatus: null,
              workspaceLoadedAt: null,
              inputs: null,
              ideaValidation: null,
              draftIdeaValidation: null,
              draftServiceIdea: null,
              validation: null,
              currency: "GBP",
              isMemberMode: false,
              membershipId: null,
              memberPermissionType: null,
              memberPermissions: null,
              memberWorkspaceName: null,
            };
          }
          if (state.workspaceOwnerEmail && state.workspaceOwnerEmail !== email) {
            return {
              workspaceId: null,
              workspaceName: null,
              workspaceLogo: null,
              workspaceOwnerEmail: email,
              decisionStatus: null,
              serviceDecisionStatus: null,
              workspaceLoadedAt: null,
              inputs: null,
              ideaValidation: null,
              draftIdeaValidation: null,
              draftServiceIdea: null,
              validation: null,
              currency: "GBP",
              isMemberMode: false,
              membershipId: null,
              memberPermissionType: null,
              memberPermissions: null,
              memberWorkspaceName: null,
            };
          }
          return { workspaceOwnerEmail: email };
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
        inputs: state.inputs,
        ideaValidation: state.ideaValidation,
        draftIdeaValidation: state.draftIdeaValidation,
        draftServiceIdea: state.draftServiceIdea,
        validation: state.validation,
        currency: state.currency || "GBP",
        isMemberMode: state.isMemberMode,
        membershipId: state.membershipId,
        memberPermissionType: state.memberPermissionType,
        memberPermissions: state.memberPermissions,
        memberWorkspaceName: state.memberWorkspaceName,
      })
    }
  )
);
