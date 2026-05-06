import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { apiRequest } from "../api/client";
import { MODULES, hasModuleAccess } from "../lib/permissions";
import logoUrl from "../enterprate-logo.png";

const MODULE_ICONS = {
  dashboard: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M2 4a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2V4zm0 9a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2v-3zm9-9a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V4zm0 9a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2v-3z" />
    </svg>
  ),
  validation: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ),
  blueprint: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
    </svg>
  ),
  simulation: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7zm-3 1a1 1 0 10-2 0v3a1 1 0 102 0V8zM8 9a1 1 0 00-2 0v2a1 1 0 102 0V9z" clipRule="evenodd" />
    </svg>
  ),
  catalogue: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4zM3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
    </svg>
  ),
  financials: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.028 2.353 1.118V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.028-2.354-1.118V5z" clipRule="evenodd" />
    </svg>
  ),
};

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path fillRule="evenodd" d="M8 1a3.5 3.5 0 00-3.5 3.5V6H4a2 2 0 00-2 2v5a2 2 0 002 2h8a2 2 0 002-2V8a2 2 0 00-2-2h-.5V4.5A3.5 3.5 0 008 1zm2 5V4.5a2 2 0 00-4 0V6h4z" clipRule="evenodd" />
    </svg>
  );
}

export default function JoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const authToken = useAuthStore((s) => s.token);
  const hydrated = useAuthStore((s) => s.hydrated);

  const [status, setStatus] = useState("idle"); // idle | loading | success | already_member | error
  const [error, setError] = useState(null);
  const [member, setMember] = useState(null);

  useEffect(() => {
    if (!hydrated) return;

    if (!authToken) {
      sessionStorage.setItem("ea_pending_join", token);
      navigate(`/login?next=/join/${token}`, { replace: true });
      return;
    }

    setStatus("loading");
    apiRequest(`/workspace/join/${token}`, "GET")
      .then((m) => {
        setMember(m);
        setStatus("success");
        sessionStorage.removeItem("ea_pending_join");
      })
      .catch((e) => {
        const msg = e.message || "";
        if (msg.includes("HTTP 409")) {
          setStatus("already_member");
        } else {
          setError(msg || "Failed to join workspace.");
          setStatus("error");
        }
      });
  }, [hydrated, authToken, token, navigate]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-br from-purple-50 via-white to-blue-50 px-4 py-10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="w-full max-w-md">

        <div className="mb-8 flex justify-center">
          <img src={logoUrl} alt="EnterprateAI" className="h-9 w-auto object-contain" />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">

          {(status === "idle" || status === "loading") && (
            <div className="flex flex-col items-center py-8 gap-4">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" />
              <p className="text-sm text-slate-500 dark:text-slate-400">Accepting invitation…</p>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center text-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
                  <svg className="h-7 w-7 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">You're in!</h1>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {member?.workspace_name
                      ? <>You've joined <span className="font-semibold text-slate-700 dark:text-slate-300">{member.workspace_name}</span>.</>
                      : "You've joined the workspace successfully."}
                  </p>
                </div>
              </div>

              {member && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Your access
                    </p>
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950/40 dark:text-brand-400">
                      {member.permission_type === "module" ? "Module-level" : "Feature-level"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {MODULES.map((mod) => {
                      const granted = hasModuleAccess(mod.key, member.permission_type, member.permissions);
                      return (
                        <div
                          key={mod.key}
                          className={`flex items-center gap-2.5 rounded-xl border p-3 transition-all ${
                            granted
                              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                              : "border-slate-100 bg-slate-50 opacity-40 dark:border-slate-800 dark:bg-slate-800/30"
                          }`}
                        >
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                            granted
                              ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400"
                              : "bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500"
                          }`}>
                            {MODULE_ICONS[mod.key] || (
                              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                <path d="M10 2a8 8 0 100 16A8 8 0 0010 2z" />
                              </svg>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className={`truncate text-xs font-semibold ${granted ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>
                              {mod.label}
                            </div>
                            {granted ? (
                              <div className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Access granted</div>
                            ) : (
                              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                                <LockIcon />
                                <span>No access</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => navigate("/dashboard", { replace: true })}
                className="w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
              >
                Continue to workspace
              </button>
            </div>
          )}

          {status === "already_member" && (
            <div className="flex flex-col items-center text-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 dark:bg-slate-800">
                <svg className="h-7 w-7 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Already joined</h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  You've already accepted this invitation and have access to the workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/dashboard", { replace: true })}
                className="w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
              >
                Go to workspace
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center text-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/40">
                <svg className="h-7 w-7 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Invitation failed</h1>
                <p className="mt-1 text-sm text-rose-500 dark:text-rose-400">{error}</p>
              </div>
              <Link
                to="/dashboard"
                className="block w-full rounded-xl border border-slate-200 bg-white py-2.5 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 transition"
              >
                Back to dashboard
              </Link>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
