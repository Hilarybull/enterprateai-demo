import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDemoTour } from "../context/DemoTourContext";
import { useAuthStore } from "../store/auth";
import logoUrl from "../enterprate-logo.png";

const PUBLIC_PATHS = new Set(["/", "/login", "/home", "/pricing", "/pricing/success", "/book-demo", "/blog", "/research", "/legal/privacy", "/legal/terms", "/legal/disclaimer", "/forgot-password", "/reset-password"]);

const CARD_W = 296;
const PAD = 10;
const SIDEBAR_W = 280;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

const ICONS = {
  workspace: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  ),
  dashboard: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  ),
  validation: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 0 0-4 12c.6.5 1 1.2 1.1 2h5.8c.1-.8.5-1.5 1.1-2A7 7 0 0 0 12 2Z"/>
      <path d="M9 18h6"/><path d="M10 22h4"/>
    </svg>
  ),
  simulation: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h12"/><path d="M10 2v6l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V2"/>
      <path d="M8 14h8"/>
    </svg>
  ),
  blueprint: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19a2 2 0 0 0 2 2h14"/><path d="M6 2h14v17H6a2 2 0 0 0-2 2V4a2 2 0 0 1 2-2Z"/>
    </svg>
  ),
  registration: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/>
      <path d="M14 2v5h5"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/>
    </svg>
  ),
  catalogue: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
      <polyline points="3.3 7.3 12 12 20.7 7.3"/><line x1="12" y1="22" x2="12" y2="12"/>
    </svg>
  ),
  financials: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
  integrations: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  ),
  marketplace: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
  ),
  referrals: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
      <polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  ),
  account: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
};

export default function DemoTour() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const tour = useDemoTour();
  const [spotRect, setSpotRect] = useState(null);
  const cardRef = useRef(null);
  const [cardPos, setCardPos] = useState(null);

  const updateSpot = useCallback(() => {
    if (!tour?.active || !tour.currentStep) return;
    const sel = tour.currentStep.selector;
    if (!sel) { setSpotRect(null); return; }
    const el = document.querySelector(sel);
    if (!el) { setSpotRect(null); return; }
    const r = el.getBoundingClientRect();
    setSpotRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, w: r.width, h: r.height });
  }, [tour?.active, tour?.step]);

  useEffect(() => {
    updateSpot();
    const t1 = setTimeout(updateSpot, 200);
    const t2 = setTimeout(updateSpot, 600);
    window.addEventListener("resize", updateSpot);
    window.addEventListener("scroll", updateSpot, true);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", updateSpot);
      window.removeEventListener("scroll", updateSpot, true);
    };
  }, [updateSpot]);

  // Auto-click tab buttons when the step requires it (so the tab opens showing sample data)
  useEffect(() => {
    if (!tour?.active || !tour.currentStep?.clickOnArrival) return;
    const sel = tour.currentStep.selector;
    if (!sel) return;
    const t = setTimeout(() => {
      const el = document.querySelector(sel);
      if (el) {
        el.click();
        setTimeout(updateSpot, 150);
      }
    }, 380);
    return () => clearTimeout(t);
  }, [tour?.step, tour?.active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Block clicks in content area during tour (but allow scrolling)
  const isPublicForBlocker = PUBLIC_PATHS.has(pathname) || pathname.startsWith("/share/") || pathname.startsWith("/join/") || pathname.startsWith("/r/") || pathname.startsWith("/blog/");
  useEffect(() => {
    if (!tour?.active || isPublicForBlocker) return;
    const block = (e) => {
      if (cardRef.current?.contains(e.target)) return;
      if (e.clientX <= SIDEBAR_W) return; // let sidebar clicks through
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    document.addEventListener("mousedown", block, true);
    document.addEventListener("click", block, true);
    return () => {
      document.removeEventListener("mousedown", block, true);
      document.removeEventListener("click", block, true);
    };
  }, [tour?.active, isPublicForBlocker]);

  useEffect(() => {
    const cardEl = cardRef.current;
    if (!cardEl) return;
    const cardH = cardEl.offsetHeight || 260;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!spotRect) {
      setCardPos({ bottom: 24, right: 24 });
      return;
    }

    const { top, left, right, bottom, w, h } = spotRect;
    const gap = PAD + 16;

    // Large spotlight (e.g. the whole content area) — pin away from the spotlight center
    const spotArea = w * h;
    const screenArea = vw * vh;
    if (spotArea > screenArea * 0.25) {
      const centerY = (top + bottom) / 2;
      setCardPos(centerY > vh / 2 ? { top: 80, right: 24 } : { bottom: 24, right: 24 });
      return;
    }

    // Narrow element — prefer right of spotlight
    if (right + gap + CARD_W + 8 <= vw && w < 300) {
      setCardPos({
        top: clamp(Math.round(top + h / 2 - cardH / 2), 12, vh - cardH - 12),
        left: Math.round(right + gap),
      });
      return;
    }

    // Below the spotlight
    if (bottom + gap + cardH + 8 <= vh) {
      setCardPos({
        top: Math.round(bottom + gap),
        left: clamp(Math.round(left + w / 2 - CARD_W / 2), 8, vw - CARD_W - 8),
      });
      return;
    }

    // Above the spotlight
    if (top - gap - cardH >= 8) {
      setCardPos({
        top: Math.round(top - gap - cardH),
        left: clamp(Math.round(left + w / 2 - CARD_W / 2), 8, vw - CARD_W - 8),
      });
      return;
    }

    // Fallback: right edge of screen, vertically centered
    setCardPos({ top: clamp(Math.round(vh / 2 - cardH / 2), 12, vh - cardH - 12), left: vw - CARD_W - 16 });
  }, [spotRect]);

  const isPublic = PUBLIC_PATHS.has(pathname) || pathname.startsWith("/share/") || pathname.startsWith("/join/") || pathname.startsWith("/r/") || pathname.startsWith("/blog/");
  const isBookDemoTour = pathname === "/book-demo" && tour?.active;

  // Post-tour "Create Account" prompt
  if (tour?.showPostTour && !isPublic) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 10010, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }}>
        <div className="pointer-events-auto mx-4 max-w-sm rounded-2xl bg-white shadow-2xl ring-1 ring-slate-100 overflow-hidden">
          <div className="bg-brand-600 px-5 py-4 text-center">
            <img src={logoUrl} alt="EnterprateAI" className="mx-auto h-5 w-auto brightness-0 invert" />
            <p className="mt-2 text-sm font-semibold text-white">Tour complete!</p>
          </div>
          <div className="px-6 py-5 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <h2 className="text-[15px] font-bold text-slate-900">Create your free account</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">
              You are currently in sandbox mode. To save your work, generate blueprints, send invoices, list on the marketplace, and use the AI assistant, you need a real account.
            </p>
            <div className="mt-4 space-y-2">
              <button
                onClick={() => { tour.dismissPostTour(); logout(); navigate("/login?signup=1"); }}
                className="w-full rounded-xl bg-brand-600 py-2.5 text-[13px] font-semibold text-white transition hover:bg-brand-700"
              >
                Create free account
              </button>
              <button
                onClick={() => { tour.dismissPostTour(); logout(); navigate("/login"); }}
                className="w-full rounded-xl border border-slate-200 py-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Sign in to existing account
              </button>
              <button
                onClick={tour.dismissPostTour}
                className="w-full py-2 text-[11.5px] text-slate-400 transition hover:text-slate-600"
              >
                Keep exploring the sandbox
              </button>
            </div>
            <p className="mt-3 text-[10.5px] text-slate-400">
              In sandbox mode: marketplace listing, blueprint generation, invoice sending, idea validation, and AI assistant are view-only.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Demo gate modal — shown when a demo user tries a restricted action
  if (tour?.demoGate && !isPublic) {
    const gateLabels = {
      marketplace: "list your business on the marketplace",
      blueprint: "generate blueprints",
      validation: "run idea validation",
      send: "send or download documents",
      ai: "use the AI assistant",
    };
    const featureLabel = gateLabels[tour.demoGate.feature] || "use this feature";
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 10010, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)" }}>
        <div className="pointer-events-auto mx-4 max-w-sm rounded-2xl bg-white shadow-2xl ring-1 ring-slate-100 overflow-hidden">
          <div className="bg-amber-50 px-5 py-4 text-center border-b border-amber-100">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
          </div>
          <div className="px-6 py-5 text-center">
            <h2 className="text-[14.5px] font-bold text-slate-900">Account required</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">
              You need a real account to {featureLabel}. In the sandbox you can explore all features, but actions that affect real data or external services require an account.
            </p>
            <div className="mt-4 space-y-2">
              <button
                onClick={() => { tour.closeDemoGate(); logout(); navigate("/login?signup=1"); }}
                className="w-full rounded-xl bg-brand-600 py-2.5 text-[13px] font-semibold text-white transition hover:bg-brand-700"
              >
                Create free account
              </button>
              <button
                onClick={() => { tour.closeDemoGate(); logout(); navigate("/login"); }}
                className="w-full rounded-xl border border-slate-200 py-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Sign in
              </button>
              <button onClick={tour.closeDemoGate} className="w-full py-2 text-[11.5px] text-slate-400 transition hover:text-slate-600">
                Continue exploring sandbox
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!tour?.active) return null;
  if (isPublic && !isBookDemoTour) return null;

  const { currentStep, step, totalSteps, next, prev, skip, goToStep } = tour;
  const isFirst = step === 0;
  const isLast = step === totalSteps - 1;

  const sp = spotRect;
  const fogColor = "rgba(71, 85, 105, 0.38)";
  const fogBlur = "blur(3.5px)";
  const fogBase = {
    position: "fixed",
    zIndex: 9997,
    pointerEvents: "none",
    background: fogColor,
    backdropFilter: fogBlur,
    WebkitBackdropFilter: fogBlur,
    transition: "top 0.28s ease, left 0.28s ease, right 0.28s ease, bottom 0.28s ease, height 0.28s ease, width 0.28s ease",
  };

  const t = sp ? Math.max(0, sp.top - PAD) : 0;
  const l = sp ? Math.max(0, sp.left - PAD) : 0;
  const r = sp ? sp.right + PAD : 0;
  const b = sp ? sp.bottom + PAD : 0;

  const cardStyle = {
    position: "fixed",
    zIndex: 10000,
    width: CARD_W,
    ...(cardPos || { bottom: 24, right: 24 }),
  };

  return (
    <>

      {/* Fog + spotlight */}
      {sp ? (
        <>
          {/* 4-panel fog around the spotlighted element */}
          <div style={{ ...fogBase, top: 0, left: 0, right: 0, height: t }} />
          <div style={{ ...fogBase, top: b, left: 0, right: 0, bottom: 0 }} />
          <div style={{ ...fogBase, top: t, left: 0, width: l, height: b - t }} />
          <div style={{ ...fogBase, top: t, left: r, right: 0, height: b - t }} />
          {/* Spotlight ring */}
          <div
            style={{
              position: "fixed",
              zIndex: 9998,
              top: t,
              left: l,
              width: r - l,
              height: b - t,
              borderRadius: 10,
              outline: "2px solid rgba(79, 70, 229, 0.55)",
              boxShadow: "0 0 0 4px rgba(79,70,229,0.10), 0 8px 32px rgba(79,70,229,0.12)",
              pointerEvents: "none",
              transition: "all 0.28s ease",
            }}
          />
        </>
      ) : (
        /* Null-selector steps: fog only the sidebar so the active nav item stands out */
        <div style={{ ...fogBase, top: 0, left: 0, width: SIDEBAR_W, bottom: 0 }} />
      )}

      {/* Tour card */}
      <div
        ref={cardRef}
        style={cardStyle}
        className="pointer-events-auto overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 bg-brand-600 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <img src={logoUrl} alt="EnterprateAI" className="h-[17px] w-auto brightness-0 invert" />
            <div className="h-3.5 w-px bg-white/25" />
            <span className="text-[10.5px] font-semibold tracking-widest text-white/75 uppercase">
              {step + 1} of {totalSteps}
            </span>
          </div>
          <button
            onClick={skip}
            className="rounded px-2 py-0.5 text-[10.5px] font-medium text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            Skip tour
          </button>
        </div>

        {/* Feature icon + content */}
        <div className="flex items-start gap-3 px-4 pt-4 pb-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
            {ICONS[currentStep.icon] || ICONS.dashboard}
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold leading-snug text-slate-900">
              {currentStep.title}
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">
              {currentStep.description}
            </p>
          </div>
        </div>

        {/* Action hint */}
        {currentStep.hint && (
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-indigo-50 px-2.5 py-2">
            <svg className="mt-0.5 h-3 w-3 shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
            <span className="text-[11px] leading-relaxed text-indigo-600">{currentStep.hint}</span>
          </div>
        )}

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 py-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <button
              key={i}
              onClick={() => goToStep(i)}
              aria-label={`Step ${i + 1}`}
              className={`rounded-full transition-all duration-200 ${
                i === step ? "h-1.5 w-4 bg-brand-500" : "h-1.5 w-1.5 bg-slate-200 hover:bg-slate-300"
              }`}
            />
          ))}
        </div>

        {/* Nav buttons */}
        <div className="flex gap-2 px-4 pb-4 pt-0.5">
          <button
            onClick={prev}
            disabled={isFirst}
            className="flex-1 rounded-xl border border-slate-200 py-2 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-25"
          >
            Back
          </button>
          <button
            onClick={next}
            className="flex-[2] rounded-xl bg-brand-600 py-2 text-[12px] font-semibold text-white transition hover:bg-brand-700 active:scale-95"
          >
            {isLast ? "Done, explore freely" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
