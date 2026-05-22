import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import logoUrl from "../enterprate-logo.png";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="relative flex h-[100dvh] items-center justify-center px-4">
        <div className="w-full max-w-[440px] rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-slate-600">This reset link is invalid or missing. Please request a new one.</p>
          <Link to="/forgot-password" className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      await apiRequest("/auth/reset-password", "POST", { token, new_password: newPassword });
      setDone(true);
    } catch (err) {
      const msg = err?.message || "";
      if (msg.includes("expired")) {
        setError("This reset link has expired. Please request a new one.");
      } else if (msg.includes("Invalid")) {
        setError("This reset link is invalid. Please request a new one.");
      } else {
        setError("Something went wrong. Please try again.");
      }
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
          {done ? (
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                <svg className="h-7 w-7 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <path d="m9 11 3 3L22 4" />
                </svg>
              </div>
              <h2 className="mt-4 text-base font-semibold text-slate-900">Password updated</h2>
              <p className="mt-2 text-sm text-slate-500">
                Your password has been changed successfully. You can now sign in with your new password.
              </p>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="mt-5 w-full rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
              >
                Go to sign in
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-base font-semibold text-slate-900">Set a new password</h2>
              <p className="mt-1 text-sm text-slate-500">Choose a strong password for your account.</p>

              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                    New password
                  </label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none ring-brand-200 placeholder:text-slate-400 focus:ring-2"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none ring-brand-200 placeholder:text-slate-400 focus:ring-2"
                  />
                </div>

                {error && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                    {error}
                    {(error.includes("expired") || error.includes("invalid")) && (
                      <Link to="/forgot-password" className="ml-2 font-semibold underline">
                        Request a new link
                      </Link>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition"
                >
                  {loading ? "Saving…" : "Set new password"}
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
