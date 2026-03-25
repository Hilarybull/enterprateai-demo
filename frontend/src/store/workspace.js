import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useWorkspaceStore = create(
  persist(
    (set) => ({
      workspaceId: null,
      workspaceName: null,
      workspaceOwnerEmail: null,
      decisionStatus: null, // accepted | rejected | null
      inputs: null,
      ideaValidation: null,
      validation: null,
      currency: "USD",
      setWorkspaceId: (workspaceId) => set({ workspaceId }),
      setWorkspaceName: (workspaceName) => set({ workspaceName: workspaceName || null }),
      setWorkspaceOwnerEmail: (workspaceOwnerEmail) => set({ workspaceOwnerEmail: workspaceOwnerEmail || null }),
      setDecisionStatus: (decisionStatus) => set({ decisionStatus: decisionStatus || null }),
      setInputs: (inputs) => set({ inputs }),
      setIdeaValidation: (ideaValidation) => set({ ideaValidation }),
      setValidation: (validation) => set({ validation }),
      setCurrency: (currency) => set({ currency: currency || "USD" }),
      resetForUser: (email) =>
        set((state) => {
          if (!email) {
            return {
              workspaceId: null,
              workspaceName: null,
              workspaceOwnerEmail: null,
              decisionStatus: null,
              inputs: null,
              ideaValidation: null,
              validation: null,
              currency: "USD"
            };
          }
          if (state.workspaceOwnerEmail && state.workspaceOwnerEmail !== email) {
            return {
              workspaceId: null,
              workspaceName: null,
              workspaceOwnerEmail: email,
              decisionStatus: null,
              inputs: null,
              ideaValidation: null,
              validation: null,
              currency: "USD"
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
        inputs: state.inputs,
        ideaValidation: state.ideaValidation,
        validation: state.validation,
        currency: state.currency
      })
    }
  )
);
