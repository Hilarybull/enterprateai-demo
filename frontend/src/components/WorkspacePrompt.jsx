import { useLocation, useNavigate } from "react-router-dom";
import SectionCard from "./SectionCard";
import Button from "./Button";

export default function WorkspacePrompt({
  title = "Create your workspace",
  subtitle = "Create a workspace to continue.",
  ctaLabel = "Create workspace",
  ctaTo
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = encodeURIComponent(location.pathname || "/");
  const defaultCta = `/validation?from=module&return=${returnTo}`;
  const target = ctaTo || defaultCta;

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="mt-3 flex justify-end">
        <Button onClick={() => navigate(target)}>{ctaLabel}</Button>
      </div>
    </SectionCard>
  );
}
