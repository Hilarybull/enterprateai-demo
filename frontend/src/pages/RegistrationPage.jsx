import PageHeader from "../components/PageHeader";
import RegistrationWizard from "../modules/registration/RegistrationWizard";
import WorkspacePrompt from "../components/WorkspacePrompt";
import { useWorkspaceStore } from "../store/workspace";

export default function RegistrationPage() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  if (!workspaceId) {
    return <WorkspacePrompt />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Business Registration Companion"
        description="Prepare everything you need to register your company on Companies House."
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        This is a preparation guide, not a formation agent. We help you gather the information you need to register yourself on the official Companies House website.
      </div>

      <RegistrationWizard />
    </div>
  );
}
