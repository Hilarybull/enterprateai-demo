import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";
import logoUrl from "../enterprate-logo.png";

export default function MarketplaceTeamInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tokenLogin = useAuthStore((s) => s.tokenLogin);
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get("token") || "";
    if (!token) { setError("This invitation link is missing or invalid."); return; }
    apiRequest("/auth/accept-marketplace-team-invite", "POST", { token })
      .then(async (result) => {
        await tokenLogin(result.access_token, result.email);
        navigate("/ent-admin?tab=marketplace-queue", { replace: true });
      })
      .catch((e) => setError(String(e?.message || "This invitation link is invalid or has expired.").replace(/^HTTP \d+:\s*/, "")));
  }, [navigate, params, tokenLogin]);

  return <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900">
      <img src={logoUrl} alt="EnterprateAI" className="mx-auto mb-6 h-7 w-auto" />
      {!error ? <><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">Verifying your email</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Your secure invitation link verifies your email and opens Marketplace Claims.</p></>
        : <><h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Invitation link unavailable</h1>
          <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Ask the EnterprateAI administrator to send you a new invitation.</p></>}
    </section>
  </main>;
}
