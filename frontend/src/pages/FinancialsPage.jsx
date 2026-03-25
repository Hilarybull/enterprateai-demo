import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import WorkspacePrompt from "../components/WorkspacePrompt";
import { useWorkspaceStore } from "../store/workspace";

export default function FinancialsPage() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  if (!workspaceId) {
    return <WorkspacePrompt />;
  }

  return (
    <div>
      <PageHeader
        title="Financials"
        description="Track your metrics and assumptions over time."
        badge={{ text: "Next", tone: "slate" }}
      />

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <SectionCard title="Assumptions" subtitle="Store and version assumptions by workspace.">
          <div className="ea-muted">Coming next: workspace list, history, and comparison across versions.</div>
        </SectionCard>
        <SectionCard title="Reports" subtitle="Export reports for stakeholders.">
          <div className="ea-muted">Coming next: export metrics and simulations to CSV/PDF.</div>
        </SectionCard>
      </div>
    </div>
  );
}
