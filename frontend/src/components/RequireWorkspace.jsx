import { useWorkspaceStore } from "../store/workspace";
import WorkspacePrompt from "./WorkspacePrompt";

export default function RequireWorkspace({ children }) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  if (!workspaceId) {
    return (
      <WorkspacePrompt
        modal
        title="Workspace required"
        subtitle="Set up your workspace to access this feature."
        ctaLabel="Set up workspace"
      />
    );
  }
  return <>{children}</>;
}
