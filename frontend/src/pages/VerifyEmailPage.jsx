import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import logoUrl from "../enterprate-logo.png";

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";

  const [status, setStatus] = useState("verifying"); // verifying | success | error
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("No verification token found in the link.");
      return;
    }
    apiRequest(`/auth/verify-email?token=${encodeURIComponent(token)}`, "GET")
      .then((res) => {
        setEmail(res?.email || "");
        setStatus("success");
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err || "");
        setErrorMsg(msg.replace(/^HTTP \d+:\s*/, "") || "This verification link is invalid or has expired.");
        setStatus("error");
      });
  }, [token]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <img src={logoUrl} alt="EnterprateAI" className="mx-auto mb-6 h-7 w-auto object-contain" />

        {status === "verifying" && (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Verifying your email…</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <svg className="h-7 w-7 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">Email verified!</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {email ? (
                <><strong className="text-slate-700 dark:text-slate-300">{email}</strong> is now verified.</>
              ) : (
                "Your email has been verified."
              )}
            </p>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="mt-6 w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
            >
              Sign In
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
              <svg className="h-7 w-7 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </div>
            <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">Verification failed</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{errorMsg}</p>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="mt-6 w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
            >
              Back to Sign In
            </button>
          </>
        )}
      </div>
    </div>
  );
}
