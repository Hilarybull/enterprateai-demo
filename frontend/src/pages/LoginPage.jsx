import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Button from "../components/Button";
import Input from "../components/Input";
import InlineAlert from "../components/InlineAlert";
import { useAuthStore } from "../store/auth";
import Spinner from "../components/Spinner";
import GoogleSignInButton from "../components/GoogleSignInButton";
import SegmentedTabs from "../components/SegmentedTabs";
import logoUrl from "../enterprate-logo.png";
import { apiRequest } from "../api/client";

export default function LoginPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const googleLogin = useAuthStore((s) => s.googleLogin);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);

  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState(searchParams.get("signup") ? "signup" : "signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgotNotice, setForgotNotice] = useState(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState(null);

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
    } else {
      navigate("/dashboard", { replace: true });
    }
  }, [token, navigate]);

  async function onSubmit(e) {
    e.preventDefault();
    setForgotNotice(null);
    if (mode === "signup") return register(email, password);
    return login(email, password);
  }

  return (
    <div className="relative flex h-[100dvh] items-center justify-center overflow-hidden px-4 py-6 sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-50 via-slate-50 to-white" />
      <div className="pointer-events-none absolute -top-28 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-brand-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-brand-300/20 blur-3xl" />

      <div className="relative w-full max-w-[520px] pb-10">
        <div className="text-center">
          <div className="mx-auto inline-flex items-center gap-2">
            <img src={logoUrl} alt="EnterprateAI" className="h-10 w-auto object-contain sm:h-12" />
            <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">Beta</span>
          </div>
          <div className="mt-3 text-[28px] font-semibold tracking-tight text-brand-700 sm:text-3xl [@media(max-height:760px)]:mt-2 [@media(max-height:760px)]:text-2xl">
            Welcome to EnterprateAI
          </div>
          <div className="mt-1 text-sm text-slate-600 [@media(max-height:760px)]:hidden">Your AI operating system for business</div>
        </div>

        <div className="mt-4 ea-card p-5 shadow-sm [@media(max-height:760px)]:mt-3 [@media(max-height:760px)]:p-4">
          <div className="text-sm font-semibold text-slate-900">{mode === "signup" ? "Create account" : "Sign in"}</div>
          <div className="mt-1 text-xs text-slate-500 [@media(max-height:760px)]:hidden">Choose your preferred login method</div>

          <div className="mt-4 [@media(max-height:760px)]:mt-3">
            <SegmentedTabs
              ariaLabel="Authentication mode"
              value={mode}
              onChange={(v) => {
                setMode(v);
                setForgotNotice(null);
              }}
              options={[
                { value: "signin", label: "Sign in" },
                { value: "signup", label: "Create account" }
              ]}
            />
          </div>

          <div className="mt-4 space-y-3 [@media(max-height:760px)]:mt-3">
            <GoogleSignInButton disabled={isLoading} onCredential={(cred) => googleLogin(cred)} />
            <div className="flex items-center gap-3 [@media(max-height:760px)]:hidden">
              <div className="h-px flex-1 bg-slate-200" />
              <div className="text-xs font-medium text-slate-500">or continue with</div>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <form className="space-y-3 [@media(max-height:760px)]:space-y-2.5" onSubmit={onSubmit}>
              <div>
                <div className="ea-label">Email</div>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="ea-label mb-0">Password</div>
                  <Link
                    to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`}
                    className="text-xs font-semibold text-brand-700 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                />
              </div>

              {forgotNotice ? <InlineAlert kind="warn" message={forgotNotice} /> : null}

              {error ? (
                <div className="space-y-2">
                  <InlineAlert kind="error" message={error} />
                  {String(error).includes("Account already exists") ? (
                    <button type="button" className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => setMode("signin")}>
                      Switch to sign in
                    </button>
                  ) : null}
                </div>
              ) : null}

              <Button disabled={isLoading} type="submit" className="w-full">
                {isLoading ? <Spinner size={16} /> : null}
                {mode === "signup" ? "Create account" : "Sign in"}
              </Button>
            </form>

            <div className="text-center text-sm text-slate-600">
              {mode === "signup" ? (
                <>
                  Already have an account?{" "}
                  <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setMode("signin")}>
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  Don't have an account?{" "}
                  <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setMode("signup")}>
                    Create one
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mt-4 text-xs text-slate-500 [@media(max-height:760px)]:hidden">By continuing, you agree to keep your credentials secure.</div>
        </div>

        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={tryDemo}
            disabled={demoLoading}
            className="text-sm font-medium text-slate-500 hover:text-brand-600 transition disabled:opacity-60"
          >
            {demoLoading ? "Loading demo…" : "Explore demo account →"}
          </button>
          {demoError && <p className="mt-1 text-xs text-rose-500">{demoError}</p>}
        </div>

        <div className="pointer-events-none fixed bottom-4 left-0 right-0 text-center text-xs text-slate-500">
          © 2026 Enterprate. All rights reserved.
        </div>
      </div>
    </div>
  );
}
