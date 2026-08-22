import { useSearchParams } from "react-router-dom";
import { useWorkspaceStore } from "../store/workspace";
import IntegrationPanel from "../components/IntegrationPanel";

export default function IntegrationsPage() {
  const refreshWorkspaceData = useWorkspaceStore((s) => s.refreshWorkspaceData);
  const [params] = useSearchParams();
  const panelKey = params.toString() || "integrations";
  const connectedProvider = params.get("connected") || "";

  return (
    <div className="px-4 py-8 sm:px-8">
      {/* Header */}
      <div className="mb-8 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-slate-600 dark:text-slate-300" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22v-5" />
            <path d="M9 7V2" />
            <path d="M15 7V2" />
            <path d="M6 13a6 6 0 0 0 12 0v-2H6v2Z" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Integrations</h1>
          <p className="mt-0.5 max-w-md text-sm text-slate-500 dark:text-slate-400">
            Connect your existing tools and pull data directly into EnterprateAI. One-click import, no manual entry.
          </p>
        </div>
      </div>

      {/* Section label */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Available connectors</span>
        <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
      </div>

      <IntegrationPanel
        key={panelKey}
        providers={["stripe", "zoho_crm", "quickbooks", "xero"]}
        onWorkspaceRefresh={refreshWorkspaceData}
        refreshHint={connectedProvider}
      />
    </div>
  );
}
