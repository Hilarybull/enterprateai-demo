import { useEffect, useState, useCallback } from "react";
import { apiRequest } from "../api/client";

const PROVIDER_INFO = {
  quickbooks: {
    label: "QuickBooks",
    tagline: "Online Accounting",
    description: "Import invoices, expenses, customers and vendors from QuickBooks Online.",
    importSupported: false,
    color: "#2CA01C",
    logo: (
      <svg viewBox="0 0 44 44" className="h-11 w-11" fill="none">
        <rect width="44" height="44" rx="12" fill="#2CA01C" />
        <circle cx="22" cy="22" r="10" fill="none" stroke="white" strokeWidth="2.5" />
        <text x="50%" y="57%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="13" fontWeight="800" fontFamily="system-ui,sans-serif">Q</text>
      </svg>
    ),
  },
  xero: {
    label: "Xero",
    tagline: "Cloud Accounting",
    description: "Import invoices, bills, customers and suppliers from Xero.",
    importSupported: false,
    color: "#13B5EA",
    logo: (
      <svg viewBox="0 0 44 44" className="h-11 w-11" fill="none">
        <rect width="44" height="44" rx="12" fill="#13B5EA" />
        <path d="M15 15l14 14M29 15L15 29" stroke="white" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
  zoho_crm: {
    label: "Zoho CRM",
    tagline: "Customer Relationship",
    description: "Import products, contacts, vendors, invoices and quotes from Zoho CRM.",
    importSupported: true,
    color: "#E42527",
    logo: (
      <svg viewBox="0 0 44 44" className="h-11 w-11" fill="none">
        <rect width="44" height="44" rx="12" fill="#E42527" />
        <text x="50%" y="57%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="10" fontWeight="800" fontFamily="system-ui,sans-serif" letterSpacing="0.5">ZOHO</text>
      </svg>
    ),
  },
};

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ProviderCard({ provider, info, status, onConnect, onDisconnect, onImport, actionLoading }) {
  const connected = status?.connected;
  const isImporting = actionLoading === `import_${provider}`;
  const loading = actionLoading === provider || isImporting;

  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border transition-shadow duration-200 hover:shadow-md ${
      connected
        ? "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
        : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    }`}>
      {/* Top accent */}
      <div className="h-1 w-full shrink-0" style={{ background: info.color }} />

      <div className="flex flex-1 flex-col p-5">
        {/* Logo + status */}
        <div className="flex items-start justify-between">
          {info.logo}
          {connected && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Connected
            </span>
          )}
        </div>

        {/* Name + tagline */}
        <div className="mt-3">
          <div className="text-[13px] font-bold text-slate-900 dark:text-slate-100">{info.label}</div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500">{info.tagline}</div>
        </div>

        {/* Description */}
        <p className="mt-2 flex-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
          {info.description}
        </p>

        {/* Last sync note */}
        {connected && (
          <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
            {status?.last_sync_at
              ? `Last imported ${fmtDate(status.last_sync_at)}`
              : info.importSupported
                ? "Ready to import — no data pulled yet."
                : "Connected · import coming soon."}
          </p>
        )}

        {/* Actions */}
        <div className="mt-5 flex flex-col gap-2">
          {connected ? (
            <>
              {info.importSupported ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onImport(provider)}
                  className="w-full rounded-xl py-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: info.color }}
                >
                  {isImporting ? "Importing…" : "Import Data"}
                </button>
              ) : (
                <div className="w-full rounded-xl border border-dashed border-slate-200 py-2.5 text-center text-[11px] font-medium text-slate-400 dark:border-slate-700 dark:text-slate-500">
                  Import coming soon
                </div>
              )}
              <button
                type="button"
                disabled={loading}
                onClick={() => onDisconnect(provider)}
                className="w-full rounded-xl border border-slate-200 py-2 text-[11px] font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={() => onConnect(provider)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {loading ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IntegrationPanel({ providers, onWorkspaceRefresh }) {
  const [statuses, setStatuses] = useState({});
  const [actionLoading, setActionLoading] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState("");

  const loadStatuses = useCallback(async () => {
    try {
      const data = await apiRequest("/integrations/status", "GET");
      setStatuses(data);
    } catch (e) {
      // silently fail — integrations are optional
    }
  }, []);

  useEffect(() => {
    loadStatuses();
    const handler = () => loadStatuses();
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [loadStatuses]);

  async function handleConnect(provider) {
    setActionLoading(provider);
    setError("");
    try {
      const res = await apiRequest(`/integrations/${provider}/connect`, "GET");
      if (res?.auth_url) window.location.href = res.auth_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setActionLoading(null);
    }
  }

  async function handleDisconnect(provider) {
    setActionLoading(provider);
    setError("");
    try {
      await apiRequest(`/integrations/${provider}`, "DELETE");
      await loadStatuses();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleImport(provider) {
    setActionLoading(`import_${provider}`);
    setSyncResult(null);
    setError("");
    try {
      const res = await apiRequest(`/integrations/${provider}/sync`, "POST", { direction: "import" }, { timeoutMs: 120000 });
      setSyncResult(res);
      if (onWorkspaceRefresh) await onWorkspaceRefresh();
      await loadStatuses();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400">
          <span className="mt-0.5 shrink-0 text-base leading-none">⚠</span>
          <span>{error.replace(/^HTTP \d+:\s*/, "")}</span>
        </div>
      )}
      {syncResult && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-xs ${
          syncResult.errors?.length
            ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
            : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
        }`}>
          <span className="mt-0.5 shrink-0 text-base leading-none">{syncResult.errors?.length ? "⚠" : "✓"}</span>
          <div>
            <strong>{syncResult.imported || 0} records imported</strong>{" from "}
            {PROVIDER_INFO[syncResult.provider]?.label}.
            {syncResult.errors?.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[11px] opacity-80">
                {syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {providers.map((provider) => {
          const info = PROVIDER_INFO[provider];
          if (!info) return null;
          return (
            <ProviderCard
              key={provider}
              provider={provider}
              info={info}
              status={statuses[provider]}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onImport={handleImport}
              actionLoading={actionLoading}
            />
          );
        })}
      </div>
    </div>
  );
}
