import { useEffect, useState } from "react";
import { useWorkspaceStore, ensureWorkspaceId } from "../store/workspace";
import WorkspacePrompt from "./WorkspacePrompt";
import Spinner from "./Spinner";

export default function RequireWorkspace({ children }) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (workspaceId) return;
    setFailed(false);
    ensureWorkspaceId().catch(() => setFailed(true));
  }, [workspaceId]);

  if (!workspaceId) {
    if (failed) {
      return (
        <WorkspacePrompt
          modal
          title="Couldn't set up your workspace"
          subtitle="Something went wrong preparing your workspace. Check your connection and try again."
          ctaLabel="Retry"
          onCtaClick={() => {
            setFailed(false);
            ensureWorkspaceId().catch(() => setFailed(true));
          }}
        />
      );
    }
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }
  return <>{children}</>;
}
