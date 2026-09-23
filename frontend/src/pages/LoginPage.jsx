import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import InlineAlert from "../components/InlineAlert";
import { useAuthStore } from "../store/auth";
import Spinner from "../components/Spinner";
import GoogleSignInButton from "../components/GoogleSignInButton";
import logoUrl from "../enterprate-logo.png";
import authLogoUrl from "../enterprate-logo-auth.png";
import { apiRequest } from "../api/client";
import "./login.css";

const GROUPS = [
  {
    key: "ess",
    title: "Free Business Essentials",
    sub: "Everything you need to run the basics.",
    items: ["Invoice", "Quotation", "Receipt", "Contract", "Idea Validation"],
  },
  {
    key: "plan",
    title: "Business Planning & Growth Tools",
    sub: "Plan smarter and grow with clarity.",
    items: ["Live Business Plan Generator", "Funding Readiness", "Financial Forecasting", "Proposal Generator", "Growth Planning"],
  },
  {
    key: "dec",
    title: "Business Decision Intelligence Tools",
    sub: "Simulate, assess and decide with confidence.",
    items: ["Viability Engine", "Survival Engine", "Stability Engine", "Growth Engine", "Scenario Simulation"],
  },
];

const TRUST_POINTS = ["Start free", "No credit card required", "Private & secure"];

function GroupIcon({ kind }) {
  if (kind === "ess") {
    return (
      <svg viewBox="0 0 28 28" fill="none" aria-hidden="true" className="lg-tile-icon">
        <path d="M8.5 4.5h7.6L21 9.4V22a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 7 22V6a1.5 1.5 0 0 1 1.5-1.5Z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M15.8 4.8V9.6h4.8M10.5 13.6h7M10.5 17.2h7M10.5 20.6h4.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "plan") {
    return (
      <svg viewBox="0 0 28 28" fill="none" aria-hidden="true" className="lg-tile-icon">
        <rect x="5" y="15" width="4.6" height="8" rx="2.3" fill="#fff" />
        <rect x="11.7" y="10.5" width="4.6" height="12.5" rx="2.3" fill="#fff" />
        <rect x="18.4" y="5" width="4.6" height="18" rx="2.3" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true" className="lg-tile-icon">
      <path d="M12.6 5.2a3.6 3.6 0 0 0-3.5 3 3.7 3.7 0 0 0-2.4 3.4c0 .9.3 1.7.9 2.4a3.8 3.8 0 0 0-.6 2 3.7 3.7 0 0 0 3.4 3.7 3.2 3.2 0 0 0 2.9 1.9c.5 0 .9-.1 1.3-.3V5.5a3.5 3.5 0 0 0-2-.3Z" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M15.4 5.5v16.8c.4.2.8.3 1.3.3a3.2 3.2 0 0 0 2.9-1.9 3.7 3.7 0 0 0 3.4-3.7c0-.7-.2-1.4-.6-2 .6-.7.9-1.5.9-2.4a3.7 3.7 0 0 0-2.4-3.4 3.6 3.6 0 0 0-3.5-3 3.5 3.5 0 0 0-2 .3Z" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10.2 12.6c1 0 1.8.6 2 1.5M18 12.6c-1 0-1.8.6-2 1.5M10.4 17.2c.9-.2 1.6-.9 1.8-1.7M17.8 17.2c-.9-.2-1.6-.9-1.8-1.7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckDot({ tone }) {
  return (
    <span className={`lg-dot lg-dot-${tone}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        <path d="m4.2 8.4 2.6 2.6 5-5.4" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function RingCheck() {
  return (
    <svg viewBox="0 0 26 26" fill="none" aria-hidden="true" className="lg-ring-check">
      <circle cx="13" cy="13" r="11.6" stroke="currentColor" strokeWidth="1.9" />
      <path d="m8.3 13.4 3.3 3.3 6.2-6.7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 20 16" fill="none" aria-hidden="true" className="lg-field-icon">
      <rect x="1" y="1.2" width="18" height="13.6" rx="2.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="m2.2 3.6 7.8 5.6 7.8-5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 18 22" fill="none" aria-hidden="true" className="lg-field-icon lg-field-icon-lock">
      <path d="M4.8 9.5V6.6a4.2 4.2 0 0 1 8.4 0v2.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="1.6" y="9.5" width="14.8" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="15" r="1.3" fill="currentColor" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="lg-field-icon">
      <circle cx="10" cy="6.6" r="3.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 17.2c.7-3.2 3.4-5 7-5s6.3 1.8 7 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon({ open = false }) {
  return open ? (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="lg-eye-icon">
      <path d="M2.5 10s2.5-5 7.5-5 7.5 5 7.5 5-2.5 5-7.5 5-7.5-5-7.5-5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 12.5A2.5 2.5 0 1 0 10 7a2.5 2.5 0 0 0 0 5.5Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="lg-eye-icon">
      <path d="M3 3l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.4 7.4A4.9 4.9 0 0 0 2.5 10s2.5 5 7.5 5c.93 0 1.8-.12 2.6-.34" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12.05 12.05A2.5 2.5 0 0 1 7.95 7.95" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="lg-btn-arrow">
      <path d="M4.5 12h15M13.5 5.8 19.7 12l-6.2 6.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="lg-google-g">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.27-2.09 3.57-5.17 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.09A11.99 11.99 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.63H1.27A11.99 11.99 0 0 0 0 12c0 1.94.46 3.77 1.27 5.37l4-3.09Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.63l4 3.09C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const googleLogin = useAuthStore((s) => s.googleLogin);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const verificationPending = useAuthStore((s) => s.verificationPending);
  const verificationEmail = useAuthStore((s) => s.verificationEmail);
  const clearVerificationPending = useAuthStore((s) => s.clearVerificationPending);

  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState(searchParams.get("signup") ? "signup" : "signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotNotice, setForgotNotice] = useState(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState(null);

  const isSignup = mode === "signup";

  // The two-column desktop layout (>=1024px) is tall enough that a shorter browser
  // window would otherwise force a scrollbar. Scale the whole thing down to whatever
  // vertical space is actually available, the way a print preview shrinks a page to
  // fit - never below a floor where it'd become illegible - and re-measure on resize
  // or when switching between sign-in/create-account (the taller create-account card
  // needs a bit more shrinking to still fit). Below 1024px the layout stacks into a
  // single scrolling column instead (see login.css), where shrinking doesn't apply -
  // the CSS there forces the transform off regardless of what this computes.
  const fitRef = useRef(null);
  const fitNaturalHeight = useRef(0);
  const [fitScale, setFitScale] = useState(1);
  useLayoutEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    function recalc() {
      if (window.innerWidth < 1024) {
        setFitScale(1);
        return;
      }
      const page = el.closest(".lg-page");
      const pageStyle = page ? getComputedStyle(page) : null;
      const vPad = pageStyle ? parseFloat(pageStyle.paddingTop) + parseFloat(pageStyle.paddingBottom) : 0;
      const available = window.innerHeight - vPad;
      const prevTransform = el.style.transform;
      el.style.transform = "none";
      const natural = el.scrollHeight;
      el.style.transform = prevTransform;
      fitNaturalHeight.current = natural;
      const next = natural > 0 ? Math.min(1, available / natural) : 1;
      setFitScale(Math.max(0.75, Number.isFinite(next) ? next : 1));
    }
    recalc();
    window.addEventListener("resize", recalc);
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    return () => {
      window.removeEventListener("resize", recalc);
      ro.disconnect();
    };
  }, [isSignup]);

  const googleEnabled = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.REACT_APP_GOOGLE_CLIENT_ID);

  useEffect(() => {
    const refClickId = searchParams.get("ref_click");
    const refCode = searchParams.get("ref_code");
    const refExpiresAt = searchParams.get("ref_expires_at");
    if (!refClickId && !refCode) return;

    try {
      const existingRaw = localStorage.getItem("ea_referral");
      if (existingRaw) return;
      localStorage.setItem(
        "ea_referral",
        JSON.stringify({
          click_id: refClickId || null,
          code: refCode || null,
          expires_at: refExpiresAt || null,
          stored_at: new Date().toISOString(),
        })
      );
    } catch {
      // Referral capture should never block login/signup.
    }
  }, [searchParams]);

  // New signups leave for their inbox (email verification) and come back to a plain
  // /login, so a ?next= deep link would be lost. Remember it briefly in localStorage.
  useEffect(() => {
    const next = searchParams.get("next");
    if (!next || !/^\/(?!\/)/.test(next)) return;
    try {
      localStorage.setItem("ea_post_auth_next", JSON.stringify({ path: next, at: Date.now() }));
    } catch {
      // Deep-link memory is best-effort only.
    }
  }, [searchParams]);

  async function tryDemo() {
    setDemoLoading(true);
    setDemoError(null);
    try {
      const data = await apiRequest("/auth/demo", "POST");
      const token = data?.access_token ?? data?.token;
      if (!token) throw new Error("no_token");
      localStorage.setItem("ea_token", token);
      localStorage.setItem("ea_email", "demo");
      sessionStorage.setItem("ea_tour_active", "1");
      sessionStorage.setItem("ea_tour_step", "0");
      sessionStorage.removeItem("ea_tour_done");
      await useAuthStore.getState().hydrate();
    } catch {
      setDemoError("Demo account is not available right now.");
    } finally {
      setDemoLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    const pendingJoin = sessionStorage.getItem("ea_pending_join");
    if (pendingJoin) {
      sessionStorage.removeItem("ea_pending_join");
      navigate(`/join/${pendingJoin}`, { replace: true });
      return;
    }
    // Honour ?next= for deep-link flows (e.g. "sign in to submit a proposal").
    // Only same-origin relative paths are accepted.
    const next = searchParams.get("next");
    if (next && /^\/(?!\/)/.test(next)) {
      try { localStorage.removeItem("ea_post_auth_next"); } catch { /* ignore */ }
      navigate(next, { replace: true });
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem("ea_post_auth_next") || "null");
      localStorage.removeItem("ea_post_auth_next");
      const fresh = saved && Date.now() - Number(saved.at) < 2 * 24 * 60 * 60 * 1000;
      if (fresh && typeof saved.path === "string" && /^\/(?!\/)/.test(saved.path)) {
        navigate(saved.path, { replace: true });
        return;
      }
    } catch {
      // Fall through to the default landing page.
    }
    navigate("/dashboard", { replace: true });
  }, [token, navigate, searchParams]);

  async function onSubmit(e) {
    e.preventDefault();
    setForgotNotice(null);
    if (isSignup) {
      const name = fullName.trim();
      if (name) sessionStorage.setItem("ea_signup_name", name);
      return register(email, password, name ? { full_name: name } : {});
    }
    return login(email, password);
  }

  function switchMode(next) {
    setMode(next);
    setForgotNotice(null);
  }

  if (verificationPending) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl">
          <img src={logoUrl} alt="EnterprateAI" className="mx-auto mb-6 h-7 w-auto object-contain" />
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-100">
            <svg className="h-7 w-7 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="mt-4 text-lg font-bold text-slate-900">Check your inbox</h1>
          <p className="mt-2 text-sm text-slate-500">
            We sent a verification link to <strong className="text-slate-700">{verificationEmail}</strong>. Click the link to activate your account.
          </p>
          <p className="mt-3 text-xs text-slate-400">Didn't receive it? Check spam or junk folders.</p>
          <button
            type="button"
            onClick={() => { clearVerificationPending(); setMode("signin"); }}
            className="mt-6 w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={"lg-page" + (isSignup ? " lg-page-signup" : "") + ((error || forgotNotice) ? " lg-page-alert" : "")}>
      <div className="lg-bg-wave" aria-hidden="true" />

      <div
        className="lg-fit-frame"
        style={fitScale < 1 ? { height: fitNaturalHeight.current * fitScale } : undefined}
      >
      <div
        ref={fitRef}
        className="lg-fit"
        style={fitScale < 1 ? { transform: `scale(${fitScale})`, transformOrigin: "top center" } : undefined}
      >
      <div className="lg-grid">
        <section className="lg-left">
          <div className="lg-left-head">
            <img src={authLogoUrl} alt="EnterprateAI" className="lg-left-logo" />
            <div className="lg-pill">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="lg-pill-icon">
                <rect x="2.4" y="10.5" width="3.6" height="7" rx="1.6" fill="currentColor" />
                <rect x="8.2" y="6" width="3.6" height="11.5" rx="1.6" fill="currentColor" />
                <rect x="14" y="2.2" width="3.6" height="15.3" rx="1.6" fill="currentColor" />
              </svg>
              <span>
                Smarter Decisions
                <br />
                Stronger Businesses
              </span>
            </div>
          </div>

          <h1 className="lg-h1">
            <span className="lg-w lg-w-build">Build</span> <span className="lg-w lg-w-a">a</span>{" "}
            <span className="lg-w lg-w-more">More</span> <span className="lg-w lg-w-resilient">Resilient</span>
            <br />
            <span className="lg-w lg-w-business">Business</span> <span className="lg-w lg-w-with">with</span>{" "}
            <span className="lg-w lg-w-intel lg-h1-accent">Intelligence.</span>
          </h1>
          <p className="lg-lead">
            Validate your idea, build your business plan, understand your risks, and simulate decisions before you act, all from one business workspace.
          </p>
          <p className="lg-bold">Get your first business insight in less than 20 minutes.</p>

          <div className="lg-groups">
            {GROUPS.map((g) => (
              <div key={g.key} className={`lg-group lg-group-${g.key}`}>
                <div className={`lg-tile lg-tile-${g.key}`}>
                  <GroupIcon kind={g.key} />
                </div>
                <div className="lg-group-body">
                  <div className={`lg-group-title lg-group-title-${g.key}`}>{g.title}</div>
                  <div className="lg-group-sub">{g.sub}</div>
                  <ul className="lg-chips">
                    {g.items.map((item) => (
                      <li key={item} className="lg-chip">
                        <CheckDot tone={g.key} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>

          <div className="lg-trust">
            {TRUST_POINTS.map((point) => (
              <div key={point} className="lg-trust-item">
                <RingCheck />
                <span>{point}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="lg-right">
          <div className="lg-topline">
            <span>{isSignup ? "Already have an account?" : "New to EnterprateAI?"}</span>
            <button type="button" onClick={() => switchMode(isSignup ? "signin" : "signup")}>
              {isSignup ? "Sign in" : "Create account"}
            </button>
          </div>

          <div className="lg-card">
            <img src={authLogoUrl} alt="EnterprateAI" className="lg-card-logo" />
            <h2 className="lg-welcome">{isSignup ? "Create your account" : "Welcome back"}</h2>
            <p className="lg-signsub">{isSignup ? "Start free. No credit card required." : "Sign in to your EnterprateAI account"}</p>

            <form className="lg-form" onSubmit={onSubmit}>
              {isSignup ? (
                <div className="lg-field">
                  <label htmlFor="lg-name" className="lg-label">Full name</label>
                  <div className="lg-input-wrap">
                    <UserIcon />
                    <input
                      id="lg-name"
                      className="lg-input"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      autoComplete="name"
                      placeholder="Your full name"
                    />
                  </div>
                </div>
              ) : null}

              <div className="lg-field">
                <label htmlFor="lg-email" className="lg-label">Email</label>
                <div className="lg-input-wrap">
                  <MailIcon />
                  <input
                    id="lg-email"
                    className="lg-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              <div className="lg-field">
                <div className="lg-label-row">
                  <label htmlFor="lg-password" className="lg-label">Password</label>
                  {!isSignup ? (
                    <Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`} className="lg-forgot">
                      Forgot password?
                    </Link>
                  ) : null}
                </div>
                <div className="lg-input-wrap">
                  <LockIcon />
                  <input
                    id="lg-password"
                    className="lg-input lg-input-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    placeholder="••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="lg-eye"
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
              </div>

              {forgotNotice ? <InlineAlert kind="warn" message={forgotNotice} /> : null}

              {error ? (
                <div className="lg-error">
                  <InlineAlert kind="error" message={error} />
                  {String(error).includes("Account already exists") ? (
                    <button type="button" className="lg-error-switch" onClick={() => switchMode("signin")}>
                      Switch to sign in
                    </button>
                  ) : null}
                </div>
              ) : null}

              <button type="submit" disabled={isLoading} className="lg-submit">
                {isLoading ? <Spinner size={16} /> : null}
                <span>{isSignup ? "Create My Free Workspace" : "Sign In"}</span>
                <ArrowRight />
              </button>
            </form>

            {googleEnabled ? (
              <>
                <div className="lg-or">
                  <span>OR</span>
                </div>
                <div className="lg-google">
                  <div className="lg-google-face">
                    <GoogleG />
                    <span>Continue with Google</span>
                  </div>
                  <div className="lg-google-hit">
                    <GoogleSignInButton disabled={isLoading} onCredential={(cred) => googleLogin(cred)} />
                  </div>
                </div>
              </>
            ) : null}

            <p className="lg-switch">
              {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
              <button type="button" onClick={() => switchMode(isSignup ? "signin" : "signup")}>
                {isSignup ? "Sign in" : "Create account"}
              </button>
            </p>
            <div className="lg-demo">
              <button type="button" onClick={tryDemo} disabled={demoLoading}>
                {demoLoading ? "Loading demo..." : "Explore the demo"}
              </button>
              {demoError ? <p>{demoError}</p> : null}
            </div>
          </div>

          <div className="lg-secure">
            <svg viewBox="0 0 22 26" fill="none" aria-hidden="true" className="lg-secure-icon">
              <path d="M11 1.6 2.2 4.8v7.3c0 5.1 3.7 9.6 8.8 11.6 5.1-2 8.8-6.5 8.8-11.6V4.8L11 1.6Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
              <path d="m7.2 12.6 2.7 2.7 5-5.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <div>Your data is private and secure.</div>
              <div className="lg-secure-sub">We never share your information.</div>
            </div>
          </div>

          <div className="lg-tagline" aria-hidden="true">
            <span>From ideas</span>
            <span>to a stronger tomorrow.</span>
            <svg viewBox="0 0 200 14" fill="none" className="lg-tagline-line">
              <path d="M4 10.5C48 4.4 118 2.6 196 3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
        </section>
      </div>
      </div>
      </div>
    </div>
  );
}
