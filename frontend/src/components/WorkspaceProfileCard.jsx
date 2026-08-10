import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { apiRequest } from "../api/client";

const STAGE_LABELS = {
  idea: "Idea stage",
  pre_revenue: "Pre-revenue",
  early_revenue: "Early revenue",
  growth: "Growth",
  scaling: "Scaling",
  mature: "Mature",
};

const DELIVERY_LABELS = {
  manual: "Manual / service-led",
  hybrid: "Hybrid",
  digital: "Digital / automated",
  productised: "Productised service",
};

function Row({ label, value, optional = false }) {
  if (!value && optional) return null;
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className={
        "mt-0.5 text-[13px] " +
        (value ? "text-slate-700 dark:text-slate-200" : "italic text-slate-300 dark:text-slate-600")
      }>
        {value || "Not set"}
      </dd>
    </div>
  );
}

function ExternalLink({ href, label }) {
  if (!href) return null;
  const url = href.startsWith("http") ? href : `https://${href}`;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="text-[13px] text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">
      {label || href.replace(/^https?:\/\/(www\.)?/, "")}
    </a>
  );
}

function ServicePill({ name }) {
  return (
    <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
      {name}
    </span>
  );
}

export function WorkspaceProfilePanel({ workspaceId, onClose, onEdit }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const backdropRef = useRef(null);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    let alive = true;
    apiRequest(`/validation/${workspaceId}`, "GET")
      .then((ws) => { if (alive) { setData(ws?.data || null); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [workspaceId]);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const p = data?.workspace_profile || {};
  const b = data?.business_profile || {};
  const companyName = p.company_name || b.business_name || "";
  const logo = p.logo_data_url || null;
  const tagline = p.tagline || "";
  const about = p.about_company || b.about || "";
  const industry = p.primary_industry || b.primary_industry || "";
  const bizType = (p.business_type || "").replace(/_/g, " ");
  const stage = STAGE_LABELS[p.operating_stage] || "";
  const delivery = DELIVERY_LABELS[p.delivery_model] || "";
  const locationStr = [p.city, p.country].filter(Boolean).join(", ");
  const email = p.email || b.email || "";
  const phone = p.phone_number || "";
  const website = p.website || b.website || "";
  const linkedin = p.linkedin_url || "";
  const twitter = p.twitter_url || "";
  const services = (Array.isArray(p.services) ? p.services : []).filter((s) => s.service_name || typeof s === "string");
  const targetCustomer = (p.target_customer_type || "").replace(/_/g, " ");
  const revenueModel = (p.primary_revenue_model || "").replace(/_/g, " ");
  const keyOffering = p.key_offering_focus || "";
  const vision = p.vision || "";
  const mission = p.mission || "";
  const coreValues = Array.isArray(p.core_values)
    ? p.core_values.filter(Boolean).join(", ")
    : (typeof p.core_values === "string" ? p.core_values : "");
  const employeeCount = p.employee_count ? String(p.employee_count) : "";
  const companySize = (p.company_size || "").replace(/_/g, " ");
  const yearEstablished = p.year_established ? String(p.year_established) : "";

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[300] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            {logo ? (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-800">
                <img src={logo} alt={companyName} className="h-full w-full object-contain" />
              </div>
            ) : companyName ? (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
                <span className="text-base font-bold text-brand-600 dark:text-brand-400">{companyName[0].toUpperCase()}</span>
              </div>
            ) : null}
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                {loading ? <span className="inline-block h-4 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /> : (companyName || "Workspace")}
              </div>
              {tagline && !loading && (
                <div className="mt-0.5 truncate text-[12px] italic text-slate-500 dark:text-slate-400">{tagline}</div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!loading && (
              <button
                type="button"
                onClick={onEdit}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Edit workspace
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
          ) : !companyName ? (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">No workspace profile set up yet.</p>
              <button
                type="button"
                onClick={onEdit}
                className="mt-3 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition"
              >
                Set up workspace
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* About */}
              {about && (
                <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">{about}</p>
              )}

              {/* Primary details — required fields always shown, optional ones hidden when empty */}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Row label="Industry" value={industry} />
                <Row label="Business type" value={bizType} />
                <Row label="Operating stage" value={stage} />
                <Row label="Delivery model" value={delivery} />
                <Row label="Location" value={locationStr} />
                <Row label="Target customer" value={targetCustomer} optional />
                <Row label="Revenue model" value={revenueModel} optional />
                <Row label="Key offering" value={keyOffering} optional />
                <Row label="Company size" value={companySize} optional />
                <Row label="Employees" value={employeeCount} optional />
                <Row label="Est." value={yearEstablished} optional />
              </dl>

              {/* Services */}
              {services.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Services</div>
                  <div className="flex flex-wrap gap-1.5">
                    {services.map((s, i) => (
                      <ServicePill key={i} name={s.service_name || s} />
                    ))}
                  </div>
                </div>
              )}

              {/* Vision / Mission / Values */}
              {(vision || mission || coreValues) && (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                  <dl className="space-y-3">
                    {vision && <Row label="Vision" value={vision} />}
                    {mission && <Row label="Mission" value={mission} />}
                    {coreValues && <Row label="Core values" value={coreValues} />}
                  </dl>
                </div>
              )}

              {/* Contact & links */}
              {(email || phone || website || linkedin || twitter) && (
                <div>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Contact & links</div>
                  <dl className="grid grid-cols-1 gap-y-3 sm:grid-cols-2">
                    {email && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Email</dt>
                        <dd className="mt-0.5 text-[13px] text-slate-700 dark:text-slate-200 break-all">{email}</dd>
                      </div>
                    )}
                    {phone && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Phone</dt>
                        <dd className="mt-0.5 text-[13px] text-slate-700 dark:text-slate-200">{phone}</dd>
                      </div>
                    )}
                    {website && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Website</dt>
                        <dd className="mt-0.5"><ExternalLink href={website} /></dd>
                      </div>
                    )}
                    {linkedin && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">LinkedIn</dt>
                        <dd className="mt-0.5"><ExternalLink href={linkedin} label="View profile" /></dd>
                      </div>
                    )}
                    {twitter && (
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Twitter / X</dt>
                        <dd className="mt-0.5"><ExternalLink href={twitter} label="View profile" /></dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
