import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";
import Spinner from "../components/Spinner";
import logoUrl from "../enterprate-logo.png";

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(str) {
  if (!str) return "";
  return str.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function industryColor(industry) {
  const map = {
    technology: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    finance: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    healthcare: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    education: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
    retail: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
    ecommerce: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    consulting: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
    logistics: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    manufacturing: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    real_estate: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    marketing: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
  };
  return map[industry] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

function initials(name) {
  return (name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function avatarGradient(name) {
  const gradients = [
    "from-brand-500 to-accent-500", "from-blue-500 to-indigo-600",
    "from-emerald-500 to-teal-600", "from-orange-400 to-red-500",
    "from-purple-500 to-pink-500", "from-yellow-400 to-orange-500",
    "from-cyan-500 to-blue-600", "from-rose-400 to-fuchsia-500",
  ];
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  return gradients[Math.abs(hash) % gradients.length];
}

// ─── star components ──────────────────────────────────────────────────────────

function StarDisplay({ rating, count, size = "sm" }) {
  const filled = Math.floor(rating || 0);
  const half = rating && (rating - filled) >= 0.4;
  const s = size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5";
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <svg key={i} className={`${s} shrink-0`} viewBox="0 0 24 24">
            {i <= filled ? (
              <path fill="#f59e0b" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            ) : i === filled + 1 && half ? (
              <>
                <defs><linearGradient id={`hg-${i}`}><stop offset="50%" stopColor="#f59e0b" /><stop offset="50%" stopColor="#e2e8f0" /></linearGradient></defs>
                <path fill={`url(#hg-${i})`} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </>
            ) : (
              <path fill="#e2e8f0" className="dark:fill-slate-700" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            )}
          </svg>
        ))}
      </span>
      {rating != null && (
        <span className={`font-semibold text-slate-700 dark:text-slate-300 ${size === "lg" ? "text-base" : "text-[11px]"}`}>
          {rating.toFixed(1)}
        </span>
      )}
      {count != null && (
        <span className={`text-slate-400 dark:text-slate-500 ${size === "lg" ? "text-sm" : "text-[10px]"}`}>({count})</span>
      )}
    </span>
  );
}

function StarInput({ value, hover, onHover, onLeave, onChange, disabled }) {
  return (
    <span className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => {
        const active = i <= (hover || value || 0);
        return (
          <button
            key={i} type="button" disabled={disabled}
            onMouseEnter={() => onHover(i)} onMouseLeave={onLeave} onClick={() => onChange(i)}
            className="transition-transform hover:scale-110 focus:outline-none disabled:cursor-not-allowed"
          >
            <svg className="h-7 w-7" viewBox="0 0 24 24">
              <path fill={active ? "#f59e0b" : "#e2e8f0"} className={active ? "" : "dark:fill-slate-700"}
                d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        );
      })}
    </span>
  );
}

const STAR_LABELS = ["", "Poor", "Fair", "Good", "Very Good", "Excellent"];

// ─── business card ────────────────────────────────────────────────────────────

function BusinessCard({ listing, onClick }) {
  const grad = avatarGradient(listing.company_name);
  const hasLogo = listing.logo_data_url && listing.logo_data_url.startsWith("data:");
  return (
    <article
      onClick={() => onClick(listing)}
      className="ea-card ea-card-hover group flex cursor-pointer flex-col overflow-hidden"
    >
      <div className={`h-1.5 w-full bg-gradient-to-r ${grad} opacity-80`} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0">
            {hasLogo ? (
              <img src={listing.logo_data_url} alt={listing.company_name}
                className="h-12 w-12 rounded-2xl border border-slate-200 bg-white object-contain p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900" />
            ) : (
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${grad} text-sm font-bold text-white shadow-sm`}>
                {initials(listing.company_name)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold text-slate-900 dark:text-slate-100 group-hover:text-brand-700 dark:group-hover:text-brand-400 transition-colors">
              {listing.company_name}
            </h3>
            {listing.tagline && <p className="truncate text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">{listing.tagline}</p>}
            <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2C8.1 2 5 5.1 5 9c0 5.3 7 13 7 13s7-7.7 7-13c0-3.9-3.1-7-7-7Z" /><circle cx="12" cy="9" r="2.5" />
              </svg>
              <span className="truncate">{[listing.city, listing.country].filter(Boolean).join(", ")}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${industryColor(listing.primary_industry)}`}>{fmt(listing.primary_industry)}</span>
          {listing.business_type && (
            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400">{fmt(listing.business_type)}</span>
          )}
        </div>

        <p className="mt-3 line-clamp-3 text-[12px] leading-relaxed text-slate-600 dark:text-slate-400">{listing.about_company}</p>

        {listing.services && listing.services.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {listing.services.slice(0, 3).map((s, i) => (
              <span key={i} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                {s.service_name}
              </span>
            ))}
            {listing.services.length > 3 && (
              <span className="rounded-md border border-dashed border-slate-200 px-2 py-0.5 text-[11px] text-slate-400 dark:border-slate-700">
                +{listing.services.length - 3} more
              </span>
            )}
          </div>
        )}

        <div className="mt-auto pt-4 flex flex-col gap-2.5 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            {listing.avg_rating != null ? (
              <StarDisplay rating={listing.avg_rating} count={listing.rating_count} />
            ) : (
              <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">No ratings yet</span>
            )}
            <span className="text-[11px] font-semibold text-brand-600 group-hover:text-brand-700 dark:text-brand-400 transition-colors">View Profile →</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-[11px] text-slate-500 dark:text-slate-400">
              {listing.phone_number ? (
                <a
                  href={`tel:${listing.phone_number}`}
                  className="inline-flex max-w-full items-center gap-1.5 truncate hover:text-brand-600 dark:hover:text-brand-400"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.63 2.62a2 2 0 0 1-.45 2.11L8 9.91a16 16 0 0 0 6.09 6.09l1.46-1.29a2 2 0 0 1 2.11-.45c.84.3 1.72.51 2.62.63A2 2 0 0 1 22 16.92z" />
                  </svg>
                  <span className="truncate">{listing.phone_number}</span>
                </a>
              ) : (
                <span className="italic text-slate-400 dark:text-slate-500">Phone not listed</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {listing.website && (
                <a href={listing.website.startsWith("http") ? listing.website : `https://${listing.website}`} target="_blank" rel="noopener noreferrer"
                  className="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900"
                  onClick={(e) => e.stopPropagation()}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></svg>
                </a>
              )}
              {listing.linkedin_url && (
                <a href={listing.linkedin_url} target="_blank" rel="noopener noreferrer"
                  className="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900"
                  onClick={(e) => e.stopPropagation()}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z" /><circle cx="4" cy="4" r="2" /></svg>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

// ─── filter chip ──────────────────────────────────────────────────────────────

function FilterChip({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`rounded-xl border px-3 py-1.5 text-[12px] font-medium transition whitespace-nowrap ${active
        ? "border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-900/30 dark:text-brand-300"
        : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"}`}>
      {label}
    </button>
  );
}

// ─── RFQ modal ────────────────────────────────────────────────────────────────

function RFQModal({ listing, onClose }) {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [items, setItems] = useState([{ name: "", quantity: 1, notes: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  // Build dropdown options: catalogue products first, then profile services, deduplicated by name
  const productOptions = (() => {
    const seen = new Set();
    const opts = [];
    for (const p of (listing.catalogue_products || [])) {
      const n = String(p.name || "").trim();
      if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); opts.push(n); }
    }
    for (const s of (listing.services || [])) {
      const n = String(s.service_name || "").trim();
      if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); opts.push(n); }
    }
    return opts;
  })();

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function addItem() {
    setItems((prev) => [...prev, { name: "", quantity: 1, notes: "" }]);
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateItem(idx, field, value) {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: field === "quantity" ? Math.max(1, Number(value) || 1) : value };
      // clear custom name when switching away from "other"
      if (field === "name" && value !== "__other__") updated.customName = "";
      return updated;
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) { setError("Name and email are required."); return; }
    const validItems = items.filter((item) => item.name && item.name !== "__other__" ? item.name.trim() : (item.customName || "").trim());
    if (!validItems.length) { setError("Select at least one product or service."); return; }
    if (validItems.some((item) => item.name === "__other__" && !(item.customName || "").trim())) {
      setError("Enter a name for the custom product or service."); return;
    }
    setSubmitting(true); setError(null);
    try {
      await apiRequest(`/marketplace/rfq/${listing.workspace_id}`, "POST", {
        customer_name: form.name.trim(),
        customer_email: form.email.trim(),
        items: validItems.map((item) => ({
          name: item.name === "__other__" ? item.customName.trim() : item.name.trim(),
          quantity: item.quantity,
          notes: (item.notes || "").trim() || null,
        })),
        message: form.message.trim() || null,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="ea-dialog relative z-10 w-full max-w-lg overflow-hidden" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Request Quotation</h3>
            <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">from {listing.company_name}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <h4 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Request sent!</h4>
            <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">{listing.company_name} will review your request and send a quotation to your email.</p>
            <button onClick={onClose} className="mt-6 rounded-xl bg-brand-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-brand-700 transition">Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="ea-scroll overflow-y-auto px-5 py-4" style={{ maxHeight: "calc(90vh - 80px)" }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="ea-label">Your Name *</label>
                <input className="ea-input" placeholder="Full name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="ea-label">Your Email *</label>
                <input type="email" className="ea-input" placeholder="email@example.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <label className="ea-label mb-0">Products / Services *</label>
                <button type="button" onClick={addItem} className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">+ Add item</button>
              </div>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="grid grid-cols-[1fr,80px,auto] items-start gap-2">
                      {productOptions.length > 0 ? (
                        <div className="relative">
                          <select
                            className={`w-full appearance-none rounded-xl border border-slate-200 bg-white pl-3 pr-8 py-2.5 text-sm outline-none ring-brand-200 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 ${!item.name ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"}`}
                            value={item.name}
                            onChange={(e) => updateItem(idx, "name", e.target.value)}
                          >
                            <option value="">Select a product / service</option>
                            {productOptions.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                            <option value="__other__">Other / Custom…</option>
                          </select>
                          <svg className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </div>
                      ) : (
                        <input className="ea-input" placeholder="Product or service name" value={item.name} onChange={(e) => updateItem(idx, "name", e.target.value)} />
                      )}
                      <input type="number" min="1" className="ea-input" placeholder="Qty" value={item.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} />
                      {items.length > 1 ? (
                        <button type="button" onClick={() => removeItem(idx)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-500 dark:border-slate-700">
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                      ) : <div className="h-9 w-9" />}
                    </div>
                    {item.name === "__other__" && (
                      <input
                        className="ea-input"
                        placeholder="Describe the product or service you need"
                        value={item.customName || ""}
                        onChange={(e) => updateItem(idx, "customName", e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <label className="ea-label">Message (optional)</label>
              <textarea className="ea-input resize-none" rows={3} placeholder="Additional details, timeline, or requirements…" value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
            </div>

            {error && <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-brand-700 transition disabled:opacity-50">
                {submitting ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> : null}
                Send Request
              </button>
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── sign up gate modal ────────────────────────────────────────────────────────

function SignUpGateModal({ action, onClose }) {
  const navigate = useNavigate();
  const messages = {
    rate: { title: "Sign in to rate", body: "Share your experience with this business. Create a free account or sign in — it only takes a minute." },
    publish: { title: "List your business", body: "Once you sign up and validate your business idea, you can publish it to the marketplace for others to discover." },
  };
  const { title, body } = messages[action] || messages.publish;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="ea-dialog relative z-10 w-full max-w-sm p-7">
        <button onClick={onClose} className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500">
          <svg className="h-7 w-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9ZM3 9l2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{body}</p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button onClick={() => navigate("/login?signup=1")}
            className="w-full rounded-xl bg-gradient-to-r from-brand-600 to-accent-600 py-2.5 text-[13px] font-bold text-white transition hover:opacity-90">
            Create Free Account
          </button>
          <button onClick={() => navigate("/login")}
            className="w-full rounded-xl border border-slate-200 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Sign In
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── detail row (inside profile modal) ───────────────────────────────────────

function DetailRow({ icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{icon}</div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
        <div className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{value}</div>
      </div>
    </div>
  );
}

// ─── business profile modal ───────────────────────────────────────────────────

function BusinessProfileModal({ listing, onClose, isLoggedIn, userEmail, ownWorkspaceId, onNeedAuth, onRequestQuote }) {
  const grad = avatarGradient(listing.company_name);
  const hasLogo = listing.logo_data_url && listing.logo_data_url.startsWith("data:");
  const isOwnListing = isLoggedIn && ownWorkspaceId === listing.workspace_id;

  const [ratingData, setRatingData] = useState({
    avg_rating: listing.avg_rating, rating_count: listing.rating_count || 0,
    user_rating: null, user_review: null,
  });
  const [ratingLoading, setRatingLoading] = useState(true);
  const [hoverStar, setHoverStar] = useState(0);
  const [pendingStar, setPendingStar] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [ratingEmail, setRatingEmail] = useState(userEmail || "");
  const [submitting, setSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState(null);
  const [showReviewBox, setShowReviewBox] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setRatingLoading(true);
      try {
        const res = await apiRequest(`/marketplace/ratings/${listing.workspace_id}`, "GET");
        if (!alive) return;
        setRatingData(res);
        setPendingStar(res.user_rating || 0);
        setReviewText(res.user_review || "");
      } catch { /* non-critical */ } finally {
        if (alive) setRatingLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [listing.workspace_id]);

  async function submitRating() {
    if (!pendingStar) return;
    const emailTrimmed = ratingEmail.trim();
    if (!emailTrimmed) { setRatingError("Please enter your email to verify this review."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) { setRatingError("Enter a valid email address."); return; }
    setSubmitting(true); setRatingError(null);
    try {
      const res = await apiRequest(`/marketplace/ratings/${listing.workspace_id}`, "POST", {
        rating: pendingStar,
        review: reviewText.trim() || null,
        rater_email: emailTrimmed,
      });
      setRatingData(res); setShowReviewBox(false); setRatingEmail("");
    } catch (e) { setRatingError(e instanceof Error ? e.message : "Failed to submit rating."); }
    finally { setSubmitting(false); }
  }

  async function removeRating() {
    setSubmitting(true); setRatingError(null);
    try {
      const res = await apiRequest(`/marketplace/ratings/${listing.workspace_id}`, "DELETE");
      setRatingData(res); setPendingStar(0); setReviewText("");
    } catch (e) { setRatingError(e instanceof Error ? e.message : "Failed to remove rating."); }
    finally { setSubmitting(false); }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="ea-dialog relative z-10 flex w-full max-w-2xl flex-col overflow-hidden" style={{ maxHeight: "90vh" }}>
        {/* Hero */}
        <div className={`relative h-28 bg-gradient-to-br ${grad} shrink-0`}>
          <button onClick={onClose} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-xl bg-white/20 text-white backdrop-blur-sm hover:bg-white/30 transition">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <div className="absolute -bottom-6 left-6">
            {hasLogo ? (
              <img src={listing.logo_data_url} alt={listing.company_name} className="h-16 w-16 rounded-2xl border-4 border-white bg-white object-contain shadow-lg dark:border-slate-900" />
            ) : (
              <div className={`flex h-16 w-16 items-center justify-center rounded-2xl border-4 border-white bg-gradient-to-br ${grad} text-xl font-bold text-white shadow-lg dark:border-slate-900`}>
                {initials(listing.company_name)}
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="ea-scroll flex-1 overflow-y-auto px-6 pb-8 pt-10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{listing.company_name}</h2>
              {listing.tagline && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{listing.tagline}</p>}
              <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-slate-400 dark:text-slate-500">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2C8.1 2 5 5.1 5 9c0 5.3 7 13 7 13s7-7.7 7-13c0-3.9-3.1-7-7-7Z" /><circle cx="12" cy="9" r="2.5" />
                </svg>
                {[listing.city, listing.state_or_region, listing.country].filter(Boolean).join(", ")}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${industryColor(listing.primary_industry)}`}>{fmt(listing.primary_industry)}</span>
            </div>
          </div>

          {/* About */}
          <div className="mt-5 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/50">
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">About</h4>
            <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">{listing.about_company}</p>
          </div>

          {/* Services */}
          {listing.services && listing.services.length > 0 && (
            <div className="mt-5">
              <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Services</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {listing.services.map((s, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{s.service_name}</div>
                    <div className="mt-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">{fmt(s.service_category)}</div>
                    {s.service_description && <div className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 line-clamp-2">{s.service_description}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Details */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <DetailRow icon={<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9ZM3 9l2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9M12 3v6" /></svg>} label="Business Type" value={fmt(listing.business_type)} />
            {listing.company_size && <DetailRow icon={<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>} label="Team Size" value={listing.company_size} />}
            {listing.year_established && <DetailRow icon={<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>} label="Est." value={String(listing.year_established)} />}
            {listing.delivery_model && <DetailRow icon={<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12H3l9-9 9 9h-2" /><path d="M9 21V12h6v9" /></svg>} label="Delivery" value={fmt(listing.delivery_model)} />}
            {listing.target_customer_type && <DetailRow icon={<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></svg>} label="Target Customer" value={fmt(listing.target_customer_type)} />}
          </div>

          {/* Contact */}
          <div className="mt-5">
            <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Contact</h4>
            <div className="flex flex-wrap gap-2">
              {listing.email && (
                <a href={`mailto:${listing.email}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 hover:border-brand-300 transition dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300" onClick={(e) => e.stopPropagation()}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                  {listing.email}
                </a>
              )}
              {listing.phone_number && (
                <a href={`tel:${listing.phone_number}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 hover:border-brand-300 transition dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300" onClick={(e) => e.stopPropagation()}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.63 2.62a2 2 0 0 1-.45 2.11L8 9.91a16 16 0 0 0 6.09 6.09l1.46-1.29a2 2 0 0 1 2.11-.45c.84.3 1.72.51 2.62.63A2 2 0 0 1 22 16.92z" /></svg>
                  {listing.phone_number}
                </a>
              )}
              {listing.website && (
                <a href={listing.website.startsWith("http") ? listing.website : `https://${listing.website}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] font-semibold text-brand-700 hover:bg-brand-100 transition dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-300"
                  onClick={(e) => e.stopPropagation()}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></svg>
                  Visit Website
                </a>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { url: listing.linkedin_url, label: "LinkedIn", icon: <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z" /><circle cx="4" cy="4" r="2" /></svg> },
                { url: listing.twitter_url, label: "Twitter/X", icon: <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg> },
                { url: listing.instagram_url, label: "Instagram", icon: <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg> },
                { url: listing.facebook_url, label: "Facebook", icon: <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg> },
              ].filter((s) => s.url).map((s) => (
                <a key={s.label} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-600 hover:border-brand-300 hover:text-brand-600 transition dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  onClick={(e) => e.stopPropagation()}>
                  {s.icon}{s.label}
                </a>
              ))}
            </div>
          </div>

          {/* Request Quotation */}
          {!isOwnListing && (
            <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-800 dark:bg-brand-900/20">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-bold text-brand-800 dark:text-brand-300">Request a Quotation</div>
                  <div className="mt-0.5 text-[11px] text-brand-600 dark:text-brand-400">Send your requirements and get a formal quote from {listing.company_name}.</div>
                </div>
                <button
                  onClick={() => onRequestQuote(listing)}
                  className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-brand-700 transition"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
                  Request Quotation
                </button>
              </div>
            </div>
          )}

          {/* Ratings section */}
          <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-5">
            <h4 className="mb-4 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Ratings & Reviews</h4>

            {/* Aggregate */}
            <div className="mb-4 flex items-center gap-4 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/50">
              {ratingLoading ? <Spinner size="sm" /> : ratingData.avg_rating != null ? (
                <div className="text-center">
                  <div className="text-4xl font-bold text-slate-900 dark:text-slate-100">{ratingData.avg_rating.toFixed(1)}</div>
                  <div className="mt-1"><StarDisplay rating={ratingData.avg_rating} size="lg" /></div>
                  <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{ratingData.rating_count} review{ratingData.rating_count !== 1 ? "s" : ""}</div>
                </div>
              ) : (
                <div className="text-[13px] text-slate-500 dark:text-slate-400 italic">No ratings yet — be the first to review.</div>
              )}
            </div>

            {/* Rating input */}
            {isOwnListing ? (
              <p className="text-[12px] text-slate-400 dark:text-slate-500 italic">You cannot rate your own business.</p>
            ) : (
              <div>
                {ratingData.user_rating && !showReviewBox ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Your rating</div>
                        <StarDisplay rating={ratingData.user_rating} count={null} />
                        {ratingData.user_review && <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400 italic">"{ratingData.user_review}"</p>}
                      </div>
                      {isLoggedIn && (
                        <button onClick={removeRating} disabled={submitting}
                          className="text-[11px] font-medium text-red-500 hover:text-red-600 hover:underline disabled:opacity-50 transition">Remove</button>
                      )}
                    </div>
                    <button onClick={() => { setPendingStar(ratingData.user_rating); setShowReviewBox(true); }}
                      className="mt-2 text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400">Edit rating</button>
                  </div>
                ) : null}

                {(!ratingData.user_rating || showReviewBox) && (
                  <div className={`rounded-2xl border p-4 dark:bg-slate-900 ${showReviewBox ? "border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-900/20" : "border-slate-200 bg-white dark:border-slate-700"}`}>
                    <div className="mb-3 text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                      {showReviewBox ? "Update your rating" : "Rate this business"}
                    </div>
                    <div className="flex items-center gap-3 mb-3">
                      <StarInput value={pendingStar} hover={hoverStar} onHover={setHoverStar} onLeave={() => setHoverStar(0)} onChange={setPendingStar} disabled={submitting} />
                      {(hoverStar || pendingStar) > 0 && (
                        <span className="text-[13px] font-semibold text-amber-600 dark:text-amber-400">{STAR_LABELS[hoverStar || pendingStar]}</span>
                      )}
                    </div>
                    <textarea placeholder="Write a short review (optional)…" value={reviewText} onChange={(e) => setReviewText(e.target.value)} rows={2} className="ea-input mb-3 resize-none" />
                    <div className="mb-3">
                      <input
                        type="email"
                        placeholder="Your email address"
                        value={ratingEmail}
                        onChange={(e) => setRatingEmail(e.target.value)}
                        className="ea-input"
                      />
                      <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">Required for review credibility. Not shown publicly.</p>
                    </div>
                    {ratingError && <p className="mb-2 text-[12px] text-red-500">{ratingError}</p>}
                    <div className="flex gap-2">
                      {showReviewBox && (
                        <button onClick={() => setShowReviewBox(false)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
                      )}
                      <button onClick={submitRating} disabled={!pendingStar || submitting}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                        {submitting ? <Spinner size="xs" /> : null}
                        {ratingData.user_rating ? "Update Rating" : "Submit Rating"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── filter constants ─────────────────────────────────────────────────────────

const INDUSTRIES = ["consulting","technology","finance","healthcare","education","retail","ecommerce","logistics","manufacturing","real_estate","marketing"];
const BIZ_TYPES = ["sole_trader","partnership","limited_company","llp","non_profit","startup"];

// ─── main page ────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const userEmail = useAuthStore((s) => s.email);
  const isLoggedIn = Boolean(token);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  const [listings, setListings] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [myStatus, setMyStatus] = useState(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterIndustry, setFilterIndustry] = useState("");
  const [filterType, setFilterType] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState(null);
  const [gateAction, setGateAction] = useState(null); // "rate" | "publish" | null
  const [rfqTarget, setRfqTarget] = useState(null);

  const PAGE_SIZE = 24;

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // fetch listings
  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (filterIndustry) params.set("industry", filterIndustry);
        if (filterType) params.set("business_type", filterType);
        const res = await apiRequest(`/marketplace/listings?${params}`, "GET");
        if (!alive) return;
        setListings(res.items || []);
        setTotal(res.total || 0);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load marketplace.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [debouncedSearch, filterIndustry, filterType, page]);

  // fetch own publish status (only when logged in)
  useEffect(() => {
    if (!isLoggedIn || !workspaceId) return;
    let alive = true;
    apiRequest("/marketplace/status", "GET")
      .then((res) => { if (alive) setMyStatus(res); })
      .catch(() => {})
      .finally(() => { alive = false; });
    return () => { alive = false; };
  }, [isLoggedIn, workspaceId]);

  function clearFilters() {
    setFilterIndustry(""); setFilterType(""); setSearch(""); setPage(1);
  }

  function clearSearch() {
    setSearch(""); setPage(1);
  }

  function clearChipFilters() {
    setFilterIndustry(""); setFilterType(""); setPage(1);
  }

  function handleListMyBusiness() {
    if (!isLoggedIn) { setGateAction("publish"); return; }
    if (myStatus?.is_published) {
      togglePublish(false);
    } else {
      togglePublish(true);
    }
  }

  async function togglePublish(publish) {
    try {
      const res = await apiRequest(publish ? "/marketplace/publish" : "/marketplace/unpublish", "POST", {});
      setMyStatus(res);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update listing.");
    }
  }

  const hasFilters = filterIndustry || filterType || debouncedSearch;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="ea-scroll flex h-screen flex-col overflow-y-auto bg-slate-50 dark:bg-slate-950">
      {/* Top navbar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(isLoggedIn ? "/dashboard" : "/")} className="flex items-center gap-2">
              <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" />
            </button>
            <span className="hidden rounded-lg bg-brand-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-600 sm:inline dark:bg-brand-900/30 dark:text-brand-400">
              Marketplace
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isLoggedIn ? (
              <>
                <button onClick={handleListMyBusiness}
                  className={`hidden rounded-xl px-3 py-1.5 text-[12px] font-semibold transition sm:block ${myStatus?.is_published
                    ? "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : "bg-brand-600 text-white hover:bg-brand-700"}`}>
                  {myStatus?.is_published ? "Listed ✓" : "List My Business"}
                </button>
                <button onClick={() => navigate("/dashboard")}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900">
                  Dashboard →
                </button>
              </>
            ) : (
              <>
                <button onClick={() => navigate("/login")}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                  Sign In
                </button>
                <button onClick={() => setGateAction("publish")}
                  className="rounded-xl bg-gradient-to-r from-brand-600 to-accent-600 px-3 py-1.5 text-[12px] font-bold text-white transition hover:opacity-90">
                  List My Business
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-br from-brand-600 via-brand-700 to-accent-700 px-4 py-12 text-center sm:py-16">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-extrabold text-white sm:text-4xl">
            Discover Validated Businesses
          </h1>
          <p className="mt-3 text-base text-white/70">
            Every business here has been built, validated, and verified through the EnterprateAI platform.
          </p>
          {/* Hero search */}
          <div className="relative mt-6">
            <svg className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input type="text" placeholder="Search by name, service, or location…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-2xl border-0 bg-white py-3.5 pl-11 pr-4 text-sm text-slate-800 shadow-xl outline-none ring-0 placeholder:text-slate-400 focus:ring-2 focus:ring-white/50 dark:bg-slate-900 dark:text-slate-100" />
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {/* Logged-in "publish" banner */}
        {isLoggedIn && myStatus && !myStatus.is_published && (
          <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-accent-50 px-5 py-4 dark:border-brand-800 dark:from-brand-900/20 dark:to-accent-900/20">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/50 dark:text-brand-400">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9ZM3 9l2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9" /></svg>
              </div>
              <div>
                <div className="text-[13px] font-bold text-brand-800 dark:text-brand-300">Your business isn't listed yet</div>
                <div className="text-[12px] text-brand-600 dark:text-brand-400">
                  {myStatus.has_profile ? "Publish to the marketplace so others can discover you." : "Complete your workspace profile first, then publish."}
                </div>
              </div>
            </div>
            <button onClick={() => myStatus.has_profile ? togglePublish(true) : navigate("/team")}
              className="shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-[12px] font-bold text-white hover:bg-brand-700 transition">
              {myStatus.has_profile ? "Publish Now" : "Complete Profile"}
            </button>
          </div>
        )}

        {/* Filter bar */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex gap-2 flex-1">
            <button onClick={() => setShowFilters((p) => !p)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition ${hasFilters
                ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/30 dark:text-brand-300"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"}`}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="21" y1="4" x2="14" y2="4" /><line x1="10" y1="4" x2="3" y2="4" />
                <line x1="21" y1="12" x2="12" y2="12" /><line x1="8" y1="12" x2="3" y2="12" />
                <line x1="21" y1="20" x2="16" y2="20" /><line x1="12" y1="20" x2="3" y2="20" />
                <line x1="14" y1="2" x2="14" y2="6" /><line x1="8" y1="10" x2="8" y2="14" /><line x1="16" y1="18" x2="16" y2="22" />
              </svg>
              Filters
              {[filterIndustry, filterType].filter(Boolean).length > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-[9px] font-bold text-white">
                  {[filterIndustry, filterType].filter(Boolean).length}
                </span>
              )}
            </button>
            {(debouncedSearch && !filterIndustry && !filterType) && (
              <button onClick={clearSearch} className="text-[12px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition">Clear search</button>
            )}
            {((filterIndustry || filterType) && !debouncedSearch) && (
              <button onClick={clearChipFilters} className="text-[12px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition">Clear filters</button>
            )}
            {(debouncedSearch && (filterIndustry || filterType)) && (
              <button onClick={clearFilters} className="text-[12px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition">Clear all</button>
            )}
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Industry</div>
                <div className="flex flex-wrap gap-1.5">
                  {INDUSTRIES.map((ind) => (
                    <FilterChip key={ind} label={fmt(ind)} active={filterIndustry === ind}
                      onClick={() => { setFilterIndustry(filterIndustry === ind ? "" : ind); setPage(1); }} />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Business Type</div>
                <div className="flex flex-wrap gap-1.5">
                  {BIZ_TYPES.map((t) => (
                    <FilterChip key={t} label={fmt(t)} active={filterType === t}
                      onClick={() => { setFilterType(filterType === t ? "" : t); setPage(1); }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{error}</div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Spinner size="md" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading marketplace…</p>
          </div>
        ) : listings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
              <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9ZM3 9l2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9M12 3v6" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300">
              {hasFilters ? "No businesses match your filters" : "No businesses listed yet"}
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {hasFilters ? "Try adjusting your search or filters." : "Be the first to list your business!"}
            </p>
            {hasFilters ? (
              <button onClick={clearFilters} className="mt-4 text-[13px] font-semibold text-brand-600 hover:underline dark:text-brand-400">Clear filters</button>
            ) : !isLoggedIn ? (
              <button onClick={() => setGateAction("publish")} className="mt-4 rounded-xl bg-brand-600 px-5 py-2 text-[13px] font-bold text-white hover:bg-brand-700 transition">
                List Your Business →
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {listings.map((l) => <BusinessCard key={l.workspace_id} listing={l} onClick={setSelected} />)}
            </div>
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                  .reduce((acc, p, i, arr) => { if (i > 0 && p - arr[i - 1] > 1) acc.push("..."); acc.push(p); return acc; }, [])
                  .map((p, i) => p === "..." ? (
                    <span key={`e${i}`} className="px-1 text-slate-400">…</span>
                  ) : (
                    <button key={p} onClick={() => setPage(p)}
                      className={`flex h-9 w-9 items-center justify-center rounded-xl border text-[13px] font-medium transition ${p === page ? "border-brand-500 bg-brand-500 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"}`}>
                      {p}
                    </button>
                  ))}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </div>
            )}
          </>
        )}

        {/* Footer CTA */}
        {!isLoggedIn && listings.length > 0 && (
          <div className="mt-12 rounded-3xl bg-gradient-to-br from-brand-600 to-accent-700 p-8 text-center">
            <h2 className="text-2xl font-extrabold text-white">Is your business here?</h2>
            <p className="mt-2 text-white/70">Validate your idea on EnterprateAI and list your business for free.</p>
            <button onClick={() => setGateAction("publish")} className="mt-5 inline-block rounded-xl bg-white px-6 py-3 text-[13px] font-bold text-brand-700 transition hover:bg-brand-50">
              Get Started — It's Free
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {selected && !rfqTarget && (
        <BusinessProfileModal
          listing={selected}
          onClose={() => setSelected(null)}
          isLoggedIn={isLoggedIn}
          userEmail={userEmail}
          ownWorkspaceId={myStatus?.workspace_id || workspaceId}
          onNeedAuth={(action) => { setSelected(null); setGateAction(action); }}
          onRequestQuote={(listing) => setRfqTarget(listing)}
        />
      )}
      {rfqTarget && <RFQModal listing={rfqTarget} onClose={() => setRfqTarget(null)} />}
      {gateAction && <SignUpGateModal action={gateAction} onClose={() => setGateAction(null)} />}
    </div>
  );
}
