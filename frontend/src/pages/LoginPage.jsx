import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button";
import Input from "../components/Input";
import InlineAlert from "../components/InlineAlert";
import { useAuthStore } from "../store/auth";
import Spinner from "../components/Spinner";
import GoogleSignInButton from "../components/GoogleSignInButton";
import SegmentedTabs from "../components/SegmentedTabs";
import logoUrl from "../logo.png";

export default function LoginPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const googleLogin = useAuthStore((s) => s.googleLogin);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);

  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgotNotice, setForgotNotice] = useState(null);

  useEffect(() => {
    if (token) navigate("/dashboard");
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
          <div className="mx-auto inline-flex items-center justify-center rounded-3xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-slate-200">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <img src={logoUrl} alt="EnterprateAI" className="h-10 w-10 object-contain drop-shadow-sm" />
            </div>
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
                  <button
                    type="button"
                    className="text-xs font-semibold text-brand-700 hover:underline"
                    onClick={() => setForgotNotice("Password reset is not enabled yet.")}
                  >
                    Forgot password?
                  </button>
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

        <div className="pointer-events-none fixed bottom-4 left-0 right-0 text-center text-xs text-slate-500">
          © 2026 Enterprate. All rights reserved.
        </div>
      </div>
    </div>
  );
}
