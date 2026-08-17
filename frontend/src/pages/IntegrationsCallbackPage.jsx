import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import logoUrl from "../enterprate-logo.png";

const PROVIDER_META = {
  quickbooks: { label: "QuickBooks", dest: "/financials" },
  xero:       { label: "Xero",       dest: "/financials" },
  zoho_crm:   { label: "Zoho CRM",   dest: "/catalogue" },
};

export default function IntegrationsCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [done, setDone] = useState(false);

  const provider = params.get("provider") || "";
  const status   = params.get("status") || "";
  const reason   = params.get("reason") || "";
  const detail   = params.get("detail") || "";
  const meta     = PROVIDER_META[provider] || { label: provider, dest: "/dashboard" };
  const isError  = status === "error";

  useEffect(() => {
    if (isError) return;
    const t = setTimeout(() => {
      setDone(true);
      navigate(meta.dest);
    }, 2500);
    return () => clearTimeout(t);
  }, [isError, meta.dest, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <img src={logoUrl} alt="EnterprateAI" className="mx-auto mb-6 h-7 w-auto object-contain" />

        {isError ? (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
              <svg className="h-7 w-7 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </div>
            <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">Connection failed</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Could not connect <strong>{meta.label}</strong>.
              {reason && <> ({reason.replace(/_/g, " ")})</>}
            </p>
            {detail && (
              <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-left text-xs text-rose-700 font-mono break-all">
                {decodeURIComponent(detail)}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <svg className="h-7 w-7 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">
              {meta.label} connected!
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Redirecting you back…
            </p>
          </>
        )}

        <button
          type="button"
          onClick={() => navigate(meta.dest)}
          className="mt-6 w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
        >
          {isError ? "Back" : "Continue"}
        </button>
      </div>
    </div>
  );
}
