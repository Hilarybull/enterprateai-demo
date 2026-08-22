import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiRequest } from "../api/client";

const PROVIDER_INFO = {
  stripe: {
    label: "Stripe",
    tagline: "Payments & Billing",
    description: "Coming soon. Import products, customers, and invoices from your Stripe account using an API key.",
    importSupported: false,
    comingSoon: true,
    color: "#635BFF",
    logo: (
      <svg viewBox="0 0 44 44" className="h-11 w-11" fill="none">
        <rect width="44" height="44" rx="12" fill="#635BFF" />
        <path
          d="M21.1 17.3c0-1 .8-1.4 2.1-1.4 1.9 0 4.3.6 6.1 1.6v-5.7A16.2 16.2 0 0 0 23.2 11c-5.1 0-8.5 2.7-8.5 7.1 0 6.9 9.5 5.8 9.5 8.8 0 1.2-1 1.6-2.4 1.6-2.1 0-4.7-.9-6.8-2v5.8a17.3 17.3 0 0 0 6.8 1.4c5.2 0 8.8-2.6 8.8-7.1-.1-7.5-9.5-6.1-9.5-9.3Z"
          fill="white"
        />
      </svg>
    ),
  },
  quickbooks: {
    label: "QuickBooks",
    tagline: "Online Accounting",
    description: "Import invoices, expenses, customers and vendors from QuickBooks Online.",
    importSupported: true,
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
    description: "Coming soon. Import invoices, bills, customers and suppliers from Xero.",
    importSupported: false,
    comingSoon: true,
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

const COMMON_CURRENCIES = [
  { code: "GBP", label: "GBP – British Pound" },
  { code: "USD", label: "USD – US Dollar" },
  { code: "EUR", label: "EUR – Euro" },
  { code: "NGN", label: "NGN – Nigerian Naira" },
  { code: "KES", label: "KES – Kenyan Shilling" },
  { code: "GHS", label: "GHS – Ghanaian Cedi" },
  { code: "ZAR", label: "ZAR – South African Rand" },
  { code: "TZS", label: "TZS – Tanzanian Shilling" },
  { code: "UGX", label: "UGX – Ugandan Shilling" },
  { code: "RWF", label: "RWF – Rwandan Franc" },
  { code: "ETB", label: "ETB – Ethiopian Birr" },
  { code: "XOF", label: "XOF – West African CFA Franc" },
  { code: "XAF", label: "XAF – Central African CFA Franc" },
  { code: "EGP", label: "EGP – Egyptian Pound" },
  { code: "MAD", label: "MAD – Moroccan Dirham" },
  { code: "CAD", label: "CAD – Canadian Dollar" },
  { code: "AUD", label: "AUD – Australian Dollar" },
  { code: "INR", label: "INR – Indian Rupee" },
  { code: "PKR", label: "PKR – Pakistani Rupee" },
  { code: "BDT", label: "BDT – Bangladeshi Taka" },
  { code: "AED", label: "AED – UAE Dirham" },
  { code: "SAR", label: "SAR – Saudi Riyal" },
  { code: "QAR", label: "QAR – Qatari Riyal" },
  { code: "SGD", label: "SGD – Singapore Dollar" },
  { code: "MYR", label: "MYR – Malaysian Ringgit" },
  { code: "JPY", label: "JPY – Japanese Yen" },
  { code: "CNY", label: "CNY – Chinese Yuan" },
  { code: "BRL", label: "BRL – Brazilian Real" },
  { code: "MXN", label: "MXN – Mexican Peso" },
  { code: "CHF", label: "CHF – Swiss Franc" },
  { code: "SEK", label: "SEK – Swedish Krona" },
  { code: "NOK", label: "NOK – Norwegian Krone" },
  { code: "DKK", label: "DKK – Danish Krone" },
  { code: "NZD", label: "NZD – New Zealand Dollar" },
];

function StripeImportModal({ onConfirm, onCancel }) {
  const info = PROVIDER_INFO.stripe;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="h-1 w-full" style={{ background: info.color }} />
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            {info.logo}
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{info.label}</div>
              <div className="text-[11px] text-slate-400">{info.tagline}</div>
            </div>
          </div>

          <h2 className="text-[15px] font-bold text-slate-900 dark:text-slate-100 mb-1">How would you like to import?</h2>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-5">
            Stripe records include currency information automatically — no extra setup needed.
          </p>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => onConfirm("new_only")}
              className="group flex items-start gap-3 rounded-xl border-2 border-slate-200 p-4 text-left transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: info.color + "18" }}>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke={info.color} strokeWidth="2">
                  <path d="M10 4v12M4 10l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">New records only</div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Skip anything you've already imported. Only pull in records that don't exist yet.</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onConfirm("overwrite")}
              className="group flex items-start gap-3 rounded-xl border-2 border-slate-200 p-4 text-left transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: info.color + "18" }}>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke={info.color} strokeWidth="2">
                  <path d="M4 10a6 6 0 1 0 12 0 6 6 0 0 0-12 0Z" />
                  <path d="M10 7v3l2 2" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Import &amp; update existing</div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Pull in new records and overwrite existing ones with the latest data from Stripe.</div>
              </div>
            </button>
          </div>

          <button type="button" onClick={onCancel} className="mt-4 w-full text-center text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ImportModeModal({ provider, info, onConfirm, onCancel }) {
  const [sourceCurrency, setSourceCurrency] = useState("");

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        {/* Header strip */}
        <div className="h-1 w-full" style={{ background: info.color }} />

        <div className="p-6">
          {/* Provider identity */}
          <div className="flex items-center gap-3 mb-5">
            {info.logo}
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{info.label}</div>
              <div className="text-[11px] text-slate-400">{info.tagline}</div>
            </div>
          </div>

          <h2 className="text-[15px] font-bold text-slate-900 dark:text-slate-100 mb-1">
            How would you like to import?
          </h2>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-5">
            Choose whether to bring in new records only, or also refresh ones you've already imported.
          </p>

          {/* Currency selector */}
          <div className={`mb-4 rounded-xl border-2 p-3 transition-colors ${sourceCurrency ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-900/20" : "border-amber-300 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/20"}`}>
            <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">
              Source currency <span className="text-rose-500">*</span>
              <span className="ml-1 font-normal normal-case text-slate-400">(required for price conversion)</span>
            </label>
            <select
              value={sourceCurrency}
              onChange={(e) => setSourceCurrency(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] font-medium text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">Select currency used in {info.label}</option>
              {COMMON_CURRENCIES.map(({ code, label }) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
            {!sourceCurrency && (
              <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">Select a currency to continue</p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {/* Option A — new only */}
            <button
              type="button"
              disabled={!sourceCurrency}
              onClick={() => onConfirm("new_only", sourceCurrency)}
              className="group flex items-start gap-3 rounded-xl border-2 border-slate-200 p-4 text-left transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              <div
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: info.color + "18" }}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke={info.color} strokeWidth="2">
                  <path d="M10 4v12M4 10l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">New records only</div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Skip anything you've already imported. Only pull in records that don't exist yet.
                </div>
              </div>
            </button>

            {/* Option B — overwrite */}
            <button
              type="button"
              disabled={!sourceCurrency}
              onClick={() => onConfirm("overwrite", sourceCurrency)}
              className="group flex items-start gap-3 rounded-xl border-2 border-slate-200 p-4 text-left transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              <div
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: info.color + "18" }}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke={info.color} strokeWidth="2">
                  <path d="M4 10a6 6 0 1 0 12 0 6 6 0 0 0-12 0Z" />
                  <path d="M10 7v3l2 2" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Import &amp; update existing</div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Pull in new records and overwrite existing ones with the latest data from {info.label}.
                </div>
              </div>
            </button>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="mt-4 w-full text-center text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ProviderCard({ provider, info, status, onConnect, onDisconnect, onAskImport, actionLoading }) {
  const connected = status?.connected;
  const isImporting = actionLoading === `import_${provider}`;
  const loading = actionLoading === provider || isImporting;
  const isComingSoon = !!info.comingSoon;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="h-1 w-full shrink-0" style={{ background: info.color }} />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between">
          {info.logo}
          {connected && !isComingSoon && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Connected
            </span>
          )}
          {isComingSoon && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              Coming soon
            </span>
          )}
        </div>

        <div className="mt-3">
          <div className="text-[13px] font-bold text-slate-900 dark:text-slate-100">{info.label}</div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500">{info.tagline}</div>
        </div>

        <p className="mt-2 flex-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
          {info.description}
        </p>

        {connected && !isComingSoon && (
          <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
            {status?.last_sync_at
              ? `Last imported ${fmtDate(status.last_sync_at)}`
              : info.importSupported
                ? "Ready to import. No data pulled yet."
                : "Connected · import coming soon."}
          </p>
        )}
        {isComingSoon && (
          <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
            This connector is on the roadmap and will be released soon.
          </p>
        )}

        <div className="mt-5 flex gap-2">
          {isComingSoon ? (
            <div className="flex-1 rounded-xl border border-dashed border-slate-200 py-2.5 text-center text-[11px] font-medium text-slate-400 dark:border-slate-700 dark:text-slate-500">
              Coming soon
            </div>
          ) : connected ? (
            <>
              {info.importSupported ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onAskImport(provider)}
                  className="flex-1 rounded-xl py-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: info.color }}
                >
                  {isImporting ? "Importing…" : "Import Data"}
                </button>
              ) : (
                <div className="flex-1 rounded-xl border border-dashed border-slate-200 py-2.5 text-center text-[11px] font-medium text-slate-400 dark:border-slate-700 dark:text-slate-500">
                  Import coming soon
                </div>
              )}
              <button
                type="button"
                disabled={loading}
                onClick={() => onDisconnect(provider)}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-[11px] font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={() => onConnect(provider)}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
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
  const [importModal, setImportModal] = useState(null); // provider key or null
  const [stripeImportModal, setStripeImportModal] = useState(false);

  const loadStatuses = useCallback(async () => {
    try {
      const cacheBust = Date.now().toString(36);
      const data = await apiRequest(`/integrations/status?ts=${cacheBust}`, "GET");
      setStatuses(data);
    } catch (e) {
      // silently fail
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

  async function handleImport(provider, mode, sourceCurrency) {
    setImportModal(null);
    setActionLoading(`import_${provider}`);
    setSyncResult(null);
    setError("");
    try {
      const body = { direction: "import", mode };
      if (sourceCurrency) body.source_currency = sourceCurrency;
      const res = await apiRequest(`/integrations/${provider}/sync`, "POST", body, { timeoutMs: 120000 });
      setSyncResult(res);
      if (onWorkspaceRefresh) await onWorkspaceRefresh();
      await loadStatuses();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  }

  const modalInfo = importModal ? PROVIDER_INFO[importModal] : null;

  function handleAskImport(provider) {
    if (provider === "stripe") {
      // Stripe carries its own currency per record — skip the currency step
      setStripeImportModal(true);
      return;
    }
    setImportModal(provider);
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              onAskImport={handleAskImport}
              actionLoading={actionLoading}
            />
          );
        })}
      </div>

      {importModal && modalInfo && (
        <ImportModeModal
          provider={importModal}
          info={modalInfo}
          onConfirm={(mode, currency) => handleImport(importModal, mode, currency)}
          onCancel={() => setImportModal(null)}
        />
      )}

      {stripeImportModal && (
        <StripeImportModal
          onConfirm={(mode) => { setStripeImportModal(false); handleImport("stripe", mode, null); }}
          onCancel={() => setStripeImportModal(false)}
        />
      )}
    </div>
  );
}
