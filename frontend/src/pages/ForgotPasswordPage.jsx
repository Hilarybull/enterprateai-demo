import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import logoUrl from "../enterprate-logo.png";

export default function ForgotPasswordPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const isSetup = searchParams.get("setup") === "1";

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiRequest("/auth/forgot-password", "POST", { email });
      setSent(true);
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex h-[100dvh] items-center justify-center overflow-hidden px-4 py-6">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-50 via-slate-50 to-white" />
      <div className="pointer-events-none absolute -top-28 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-brand-200/40 blur-3xl" />

      <div className="relative w-full max-w-[440px]">
        <div className="text-center">
          <img src={logoUrl} alt="EnterprateAI" className="mx-auto h-10 w-auto object-contain" />
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                <svg className="h-7 w-7 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.42 2 2 0 0 1 3.6 1.25h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z" />
                </svg>
              </div>
              <h2 className="mt-4 text-base font-semibold text-slate-900">Check your inbox</h2>
              <p className="mt-2 text-sm text-slate-500">
                We've sent a {isSetup ? "password setup" : "password reset"} link to <strong>{email}</strong>. Check your spam folder if it doesn't arrive within a few minutes.
              </p>
              <p className="mt-4 text-sm text-slate-500">
                The link expires in <strong>60 minutes</strong>.
              </p>
              <Link
                to="/login"
                className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
              >
                ← Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-base font-semibold text-slate-900">
                {isSetup ? "Set a password" : "Reset your password"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {isSetup
                  ? "We'll send a link to your email so you can create a password for your account."
                  : "Enter your email and we'll send you a link to set a new password."}
              </p>

              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                    Email address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none ring-brand-200 placeholder:text-slate-400 focus:ring-2"
                  />
                </div>

                {error && (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition"
                >
                  {loading ? "Sending…" : isSetup ? "Send setup link" : "Send reset link"}
                </button>
              </form>

              <div className="mt-4 text-center text-sm text-slate-500">
                <Link to="/login" className="font-semibold text-brand-700 hover:underline">
                  ← Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
