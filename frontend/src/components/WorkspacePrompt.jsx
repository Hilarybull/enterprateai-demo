import { useLocation, useNavigate } from "react-router-dom";
import Button from "./Button";

export default function WorkspacePrompt({
  title = "Create your workspace",
  subtitle = "Create a workspace to continue.",
  ctaLabel = "Create workspace",
  ctaTo,
  modal = false,
  onClose,
  onCtaClick,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = encodeURIComponent(location.pathname || "/");
  const defaultCta = `/validation?from=module&return=${returnTo}`;
  const target = ctaTo || defaultCta;

  const triggerPrimary = () => {
    if (typeof onCtaClick === "function") {
      onCtaClick(target);
      return;
    }
    navigate(target);
  };

  if (modal) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
        <div className="relative w-full max-w-md">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="absolute -right-1 -top-1 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-700"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ) : null}
          <div className="overflow-hidden rounded-[28px] bg-white shadow-2xl ring-1 ring-slate-200">
            <div className="bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 px-6 py-6 text-white">
              <div className="text-sm font-semibold uppercase tracking-[0.22em] text-white/80">
                Workspace gate
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Create your workspace</h2>
              <p className="mt-2 text-sm leading-6 text-white/82">
                You need a workspace before you can open that section.
              </p>
            </div>
            <div className="px-6 py-6">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-5 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-sm ring-1 ring-slate-200">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6" />
                  </svg>
                </div>
                <div className="mt-4 text-sm font-medium text-slate-500">{title}</div>
                <div className="mt-1 text-base font-semibold text-slate-900">{subtitle}</div>
              </div>
              <div className="mt-5">
                <Button onClick={triggerPrimary} className="w-full">
                  {ctaLabel}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6" />
          </svg>
        </div>
        <h2 className="mt-4 text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>
        <Button onClick={triggerPrimary} className="mt-5 w-full">
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
}
