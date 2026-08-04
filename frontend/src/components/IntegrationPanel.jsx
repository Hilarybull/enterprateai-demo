import { useEffect, useState, useCallback } from "react";
import { apiRequest } from "../api/client";

const PROVIDER_INFO = {
  quickbooks: {
    label: "QuickBooks",
    description: "Import invoices, expenses, customers and vendors from QuickBooks Online.",
    importSupported: false,
    logo: (
      <svg viewBox="0 0 40 40" className="h-8 w-8">
        <rect width="40" height="40" rx="8" fill="#2CA01C" />
        <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="sans-serif">QB</text>
      </svg>
    ),
  },
  xero: {
    label: "Xero",
    description: "Import invoices, bills, customers and suppliers from Xero.",
    importSupported: false,
    logo: (
      <svg viewBox="0 0 40 40" className="h-8 w-8">
        <rect width="40" height="40" rx="8" fill="#13B5EA" />
        <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="sans-serif">X</text>
      </svg>
    ),
  },
  zoho_crm: {
    label: "Zoho CRM",
    description: "Import products, contacts and vendors from Zoho CRM.",
    importSupported: true,
    logo: (
      <svg viewBox="0 0 40 40" className="h-8 w-8">
        <rect width="40" height="40" rx="8" fill="#E42527" />
        <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold" fontFamily="sans-serif">ZOHO</text>
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
    <div className={`rounded-2xl border p-5 transition ${connected ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-900/10" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
      <div className="flex items-center gap-4">
        <div className="shrink-0">{info.logo}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{info.label}</span>
            {connected && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{info.description}</p>
          {connected && status?.last_sync_at && (
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Last imported: {fmtDate(status.last_sync_at)}</p>
          )}
          {connected && !status?.last_sync_at && (
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              {info.importSupported
                ? "Not yet imported. Click Import to pull your data in."
                : "Connected. Import coming soon."}
            </p>
          )}
        </div>
        {connected ? (
          <div className="flex shrink-0 items-center gap-2">
            {info.importSupported ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => onImport(provider)}
                className="rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {isImporting ? "Importing..." : `Import from ${info.label}`}
              </button>
            ) : (
              <span className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-400 dark:border-slate-700 dark:text-slate-500 cursor-default select-none">
                Import coming soon
              </span>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={() => onDisconnect(provider)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={() => onConnect(provider)}
            className="shrink-0 rounded-xl bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        )}
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
      // silently fail - integrations are optional
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
      if (res?.auth_url) {
        window.location.href = res.auth_url;
      }
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
      if (onWorkspaceRefresh) {
        await onWorkspaceRefresh();
      }
      await loadStatuses();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400">
          {error.replace(/^HTTP \d+:\s*/, "")}
        </div>
      )}
      {syncResult && (
        <div className={`rounded-xl border px-4 py-3 text-xs ${syncResult.errors?.length ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400" : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"}`}>
          <strong>{syncResult.imported || 0} records imported</strong>
          {" from "}
          {PROVIDER_INFO[syncResult.provider]?.label}.
          {syncResult.errors?.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11px]">
              {syncResult.errors.map((e, i) => <li key={i}>{"⚠"} {e}</li>)}
            </ul>
          )}
        </div>
      )}
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
  );
}
