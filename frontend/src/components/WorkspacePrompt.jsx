import { useLocation, useNavigate } from "react-router-dom";
import Button from "./Button";

const ACTIONS = [
  {
    key: "business-plan",
    title: "Create My Business Plan",
    desc: "Build a detailed, fundable business plan.",
    buttonLabel: "Start Planning",
    accent: "from-slate-900 to-slate-700",
    icon: (
      <>
        <path d="M6 3h10l4 4v14H6z" />
        <path d="M10 3v5h5" />
        <path d="M9 12h6M9 16h6" />
      </>
    ),
  },
  {
    key: "journey",
    title: "Idea-to-Launch Journey",
    desc: "Guided steps from concept to MVP.",
    buttonLabel: "Go to Journey",
    accent: "from-slate-900 to-slate-700",
    icon: (
      <>
        <path d="M5 19c4.5 0 8-3.5 8-8s-3.5-8-8-8" />
        <path d="M8 8l6 6" />
        <path d="M14 4h6v6" />
      </>
    ),
  },
  {
    key: "validate",
    title: "Validate My Idea",
    desc: "Test assumptions and analyze risk.",
    buttonLabel: "Run Validation",
    accent: "from-slate-900 to-slate-700",
    icon: (
      <>
        <path d="M4 5h4l2 4 3-8 3 8 2-4h2" />
        <path d="M4 19c2-4 5-6 8-6s6 2 8 6" />
      </>
    ),
  },
  {
    key: "scenarios",
    title: "Run Scenarios",
    desc: "Test different market conditions and outcomes.",
    buttonLabel: "Simulate",
    accent: "from-slate-900 to-slate-700",
    icon: (
      <>
        <path d="M4 7h5l3 3 4-4h4" />
        <path d="M7 7v5H2" />
        <path d="M15 17h5v-5" />
        <path d="M7 17l4-4 3 3 5-5" />
      </>
    ),
  },
];

function ActionCard({ action, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full min-h-[232px] flex-col rounded-[24px] border border-[#a55782] bg-gradient-to-br from-[#f8fbff] via-white to-[#fbf0f5] p-5 text-left shadow-[0_8px_24px_rgba(77,56,149,0.08)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(77,56,149,0.14)]"
    >
      <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${action.accent} text-white shadow-sm`}>
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          {action.icon}
        </svg>
      </div>
      <div className="mt-4 text-[1.08rem] font-semibold leading-6 text-slate-950">{action.title}</div>
      <div className="mt-2 max-w-[17rem] text-[0.95rem] leading-6 text-slate-700">{action.desc}</div>
      <div className="mt-auto pt-5">
        <div className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 shadow-sm transition group-hover:border-brand-200 group-hover:text-brand-700">
          {action.buttonLabel}
        </div>
      </div>
    </button>
  );
}

export default function WorkspacePrompt({
  title = "Create your workspace",
  subtitle = "Create a workspace to continue.",
  ctaLabel = "Create workspace",
  ctaTo,
  modal = false,
  workspaceId = null,
  onClose,
  onCtaClick,
  onActionClick,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const hasWorkspace = Boolean(workspaceId);
  const returnTo = encodeURIComponent(location.pathname || "/");
  const defaultCta = `/validation?from=module&return=${returnTo}`;
  const target = ctaTo || defaultCta;
  const actionRoutes = {
    "business-plan": "/blueprint",
    journey: "/validation",
    validate: "/validation",
    scenarios: "/simulation",
  };

  const goToWorkspaceForm = (nextTarget = target) => {
    if (typeof onActionClick === "function") {
      onActionClick(nextTarget);
      return;
    }
    navigate(nextTarget);
  };

  const goToAction = (actionKey) => {
    if (!hasWorkspace) {
      goToWorkspaceForm();
      return;
    }
    const next = actionRoutes[actionKey] || "/dashboard";
    navigate(next);
  };

  const triggerPrimary = () => {
    if (typeof onCtaClick === "function") {
      onCtaClick(target);
      return;
    }
    navigate(target);
  };

  if (modal) {
    return (
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
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
    <div className="mx-auto w-full max-w-[1280px]">
      <div className="rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="px-6 py-6 md:px-8">
          <div className="text-sm font-medium text-slate-900">Launchpad</div>
          <h1 className="mt-1 text-[2rem] font-semibold tracking-tight text-slate-950 md:text-[2.75rem]">
            Your Idea-to-Launch Journey Starts Here
          </h1>
          <p className="mt-2 text-[1.02rem] text-slate-700">
            Select an action to move your business forward.
          </p>
        </div>

        <div className="px-6 pb-6 md:px-8 md:pb-8">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            {ACTIONS.map((action) => (
              <ActionCard
                key={action.key}
                action={action}
                onClick={() => goToAction(action.key)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
