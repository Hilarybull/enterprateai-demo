import { useEffect, useState } from "react";
import { useWorkspaceStore, ensureWorkspaceId } from "../store/workspace";
import WorkspacePrompt from "./WorkspacePrompt";
import { ContentSkeleton } from "./Skeleton";

/** `fallback`: the page's own skeleton, so nothing moves when the workspace is ready (the general one otherwise). */
export default function RequireWorkspace({ children, fallback = null }) {
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
    return fallback || <ContentSkeleton />;
  }
  return <>{children}</>;
}
