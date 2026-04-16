import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useWorkspaceStore = create(
  persist(
    (set) => ({
      workspaceId: null,
      workspaceName: null,
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
      setWorkspaceId: (workspaceId) => set({ workspaceId: workspaceId ?? null }),
      setWorkspaceName: (workspaceName) => set({ workspaceName: workspaceName || null }),
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
      resetForUser: (email) =>
        set((state) => {
          if (!email) {
            return {
              workspaceId: null,
              workspaceName: null,
              workspaceOwnerEmail: null,
              decisionStatus: null,
              serviceDecisionStatus: null,
              workspaceLoadedAt: null,
              inputs: null,
              ideaValidation: null,
              draftIdeaValidation: null,
              draftServiceIdea: null,
              validation: null,
              currency: "GBP"
            };
          }
          if (state.workspaceOwnerEmail && state.workspaceOwnerEmail !== email) {
            return {
              workspaceId: null,
              workspaceName: null,
              workspaceOwnerEmail: email,
              decisionStatus: null,
              serviceDecisionStatus: null,
              workspaceLoadedAt: null,
              inputs: null,
              ideaValidation: null,
              draftIdeaValidation: null,
              draftServiceIdea: null,
              validation: null,
              currency: "GBP"
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
        workspaceOwnerEmail: state.workspaceOwnerEmail,
        decisionStatus: state.decisionStatus,
        serviceDecisionStatus: state.serviceDecisionStatus,
        workspaceLoadedAt: state.workspaceLoadedAt,
        inputs: state.inputs,
        ideaValidation: state.ideaValidation,
        draftIdeaValidation: state.draftIdeaValidation,
        draftServiceIdea: state.draftServiceIdea,
        validation: state.validation,
        currency: state.currency || "GBP"
      })
    }
  )
);
