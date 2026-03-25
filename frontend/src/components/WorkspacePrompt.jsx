import { useNavigate } from "react-router-dom";
import SectionCard from "./SectionCard";
import Button from "./Button";

export default function WorkspacePrompt({
  title = "Create your workspace",
  subtitle = "Start with Idea Validation to save your workspace and unlock this module.",
  ctaLabel = "Create workspace",
  ctaTo = "/validation?from=module"
}) {
  const navigate = useNavigate();

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="mt-3 flex justify-end">
        <Button onClick={() => navigate(ctaTo)}>{ctaLabel}</Button>
      </div>
    </SectionCard>
  );
}
