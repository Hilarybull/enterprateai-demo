import { useLocation, useNavigate } from "react-router-dom";
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
    <div className="ea-card flex flex-col items-center gap-4 px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 dark:bg-slate-800">
        <svg className="h-7 w-7 text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
        </svg>
      </div>
      <div>
        <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <Button onClick={() => navigate(target)}>{ctaLabel}</Button>
    </div>
  );
}
