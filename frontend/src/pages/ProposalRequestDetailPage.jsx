import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";
import logoUrl from "../enterprate-logo.png";
import Spinner from "../components/Spinner";
import { ApplyModal, BusinessProfileModal } from "./MarketplacePage";

function fmt(str) {
  if (!str) return "";
  return str.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function categoryColor(cat) {
  const map = {
    software: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    design: "bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-400",
    consulting: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400",
    marketing: "bg-pink-50 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400",
    finance: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
    legal: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    logistics: "bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
    health: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    education: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  };
  const key = Object.keys(map).find((k) => (cat || "").toLowerCase().includes(k));
  return key ? map[key] : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

const REQ_FORMAT_META = {
  text: { label: "Text response", icon: "✏️" },
  document: { label: "Document upload", icon: "📄" },
  image: { label: "Image upload", icon: "🖼️" },
  presentation: { label: "Presentation", icon: "📊" },
  url: { label: "Link / URL", icon: "🔗" },
  number: { label: "Number", icon: "🔢" },
};

function SharePanel({ req }) {
  const [copied, setCopied] = useState(false);
  const [liCopied, setLiCopied] = useState(false);
  const pageUrl = `${window.location.origin}/marketplace/request/${req.id}`;

  const shareTitle = `${req.company_name} is looking for proposals: "${req.title}"`;
  const shareText =
    `${shareTitle}` +
    (req.budget_range ? ` — Budget: ${req.budget_currency || "GBP"} ${req.budget_range}` : "") +
    `. Apply now: ${pageUrl}`;

  const tweetText = encodeURIComponent(
    `${req.company_name} is seeking proposals for "${req.title}"` +
    (req.budget_range ? ` — Budget: ${req.budget_currency || "GBP"} ${req.budget_range}` : "") +
    `. Apply now:`
  );
  const waText = encodeURIComponent(
    `*${req.title}* — ${req.company_name} is looking for proposals.\n` +
    (req.budget_range ? `Budget: ${req.budget_currency || "GBP"} ${req.budget_range}\n` : "") +
    `Apply here: ${pageUrl}`
  );

  function copyLink() {
    navigator.clipboard?.writeText(pageUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function handleEmail() {
    if (navigator.share) {
      navigator.share({ title: shareTitle, text: shareText, url: pageUrl }).catch(() => {});
    } else {
      const subject = encodeURIComponent(`Proposal Request: ${req.title} — ${req.company_name}`);
      const body = encodeURIComponent(
        `${req.company_name} is looking for proposals:\n\n` +
        `"${req.title}"\n` +
        (req.budget_range ? `Budget: ${req.budget_currency || "GBP"} ${req.budget_range}\n` : "") +
        `\nApply here: ${pageUrl}`
      );
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    }
  }

  function handleLinkedIn() {
    // LinkedIn share-offsite doesn't pre-fill text for non-partner apps.
    // Copy the post text so user can paste it in.
    navigator.clipboard?.writeText(shareText).catch(() => {});
    setLiCopied(true);
    setTimeout(() => setLiCopied(false), 4000);
    window.open("https://www.linkedin.com/post/new", "_blank", "noreferrer");
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Share this request</p>

      <div className="grid grid-cols-2 gap-2">
        {/* Email / Native share */}
        <button onClick={handleEmail}
          className="flex items-center justify-center gap-2 rounded-xl bg-slate-700 py-2.5 text-[12px] font-semibold text-white hover:bg-slate-800 transition">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/>
          </svg>
          Email
        </button>

        {/* WhatsApp */}
        <a href={`https://wa.me/?text=${waText}`} target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] py-2.5 text-[12px] font-semibold text-white hover:bg-[#20b858] transition">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.524 5.855L.057 23.547a.5.5 0 0 0 .609.61l5.805-1.53A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.693-.516-5.222-1.415l-.374-.222-3.878 1.022 1.01-3.784-.241-.386A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
          </svg>
          WhatsApp
        </a>

        {/* X / Twitter */}
        <a href={`https://twitter.com/intent/tweet?text=${tweetText}&url=${encodeURIComponent(pageUrl)}`} target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-2 rounded-xl bg-black py-2.5 text-[12px] font-semibold text-white hover:bg-slate-800 transition dark:bg-slate-800 dark:hover:bg-slate-700">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
          X / Twitter
        </a>

        {/* LinkedIn — copies text then opens composer */}
        <button onClick={handleLinkedIn}
          className="relative flex items-center justify-center gap-2 rounded-xl bg-[#0A66C2] py-2.5 text-[12px] font-semibold text-white hover:bg-[#0958a8] transition">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
          LinkedIn
        </button>
      </div>

      {liCopied && (
        <p className="mt-2 text-center text-[11px] text-emerald-600 dark:text-emerald-400">
          Post text copied — paste it in LinkedIn
        </p>
      )}

      <button onClick={copyLink}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
        {copied ? (
          <svg className="h-3.5 w-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        ) : (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        )}
        {copied ? "Link copied!" : "Copy link"}
      </button>
    </div>
  );
}

export default function ProposalRequestDetailPage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const userEmail = useAuthStore((s) => s.email);
  const isLoggedIn = Boolean(token);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  const [req, setReq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [applyTarget, setApplyTarget] = useState(null); // { listing, request }
  const [applyLoading, setApplyLoading] = useState(false);
  const [profileListing, setProfileListing] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiRequest(`/marketplace/proposal-requests/${requestId}`, "GET")
      .then((data) => setReq(data))
      .catch((e) => setError(e?.message || "Request not found"))
      .finally(() => setLoading(false));
  }, [requestId]);

  async function handleApply() {
    if (!req) return;
    setApplyLoading(true);
    try {
      const listing = await apiRequest(`/marketplace/listings/${req.workspace_id}`, "GET");
      setApplyTarget({ listing, request: req });
    } catch {
      navigate(`/marketplace?request=${requestId}`);
    } finally {
      setApplyLoading(false);
    }
  }

  async function handleViewCompany() {
    if (!req) return;
    setProfileLoading(true);
    try {
      const listing = await apiRequest(`/marketplace/listings/${req.workspace_id}`, "GET");
      setProfileListing(listing);
    } catch {
      window.open(`/marketplace?workspace=${req.workspace_id}`, "_blank");
    } finally {
      setProfileLoading(false);
    }
  }

  const deadlinePassed = req?.deadline && new Date(req.deadline) < new Date();
  const isOwn = isLoggedIn && req?.workspace_id === workspaceId;
  const reqs = req?.requirements || [];
  const acceptedModeLabel = Array.isArray(req?.accepted_modes)
    ? req.accepted_modes.map((m) => fmt(m)).join(", ")
    : req?.accepted_modes ? fmt(req.accepted_modes) : null;

  return (
    <div className="ea-scroll flex h-screen flex-col overflow-y-auto bg-slate-50 dark:bg-slate-950">
      {/* Navbar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(isLoggedIn ? "/dashboard" : "/")} className="flex items-center gap-2">
              <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" />
            </button>
            <button onClick={() => navigate("/marketplace?tab=requests")}
              className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-slate-700 transition dark:text-slate-400 dark:hover:text-slate-200">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
              Proposal Requests
            </button>
          </div>
          <div className="flex items-center gap-2">
            {isLoggedIn ? (
              <button onClick={() => navigate("/dashboard")}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900">
                Dashboard →
              </button>
            ) : (
              <>
                <button onClick={() => navigate("/login")}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                  Sign In
                </button>
                <button onClick={() => navigate("/register")}
                  className="rounded-xl bg-gradient-to-r from-brand-600 to-accent-600 px-3 py-1.5 text-[12px] font-bold text-white transition hover:opacity-90">
                  Get Started
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {applyTarget && (
        <ApplyModal
          listing={applyTarget.listing}
          request={applyTarget.request}
          onClose={() => setApplyTarget(null)}
          onSuccess={() => setApplyTarget(null)}
        />
      )}
      {profileListing && (
        <BusinessProfileModal
          listing={profileListing}
          isLoggedIn={isLoggedIn}
          userEmail={userEmail}
          ownWorkspaceId={workspaceId}
          onClose={() => setProfileListing(null)}
          onNeedAuth={() => navigate("/login")}
          onRequestQuote={() => {}}
        />
      )}

      {/* Content */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        {loading && (
          <div className="flex items-center justify-center py-24">
            <Spinner size={32} />
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300">{error}</p>
            <button onClick={() => navigate("/marketplace?tab=requests")}
              className="mt-4 rounded-xl bg-brand-600 px-5 py-2.5 text-[13px] font-bold text-white hover:bg-brand-700 transition">
              Browse All Requests
            </button>
          </div>
        )}

        {req && !loading && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Main content */}
            <div className="lg:col-span-2 space-y-5">
              {/* Header card */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-start gap-4">
                  {req.company_logo ? (
                    <img src={req.company_logo} alt={req.company_name}
                      className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 bg-white object-contain p-1.5 dark:border-slate-700 dark:bg-slate-800" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 text-lg font-bold text-white">
                      {(req.company_name || "?").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-brand-600 dark:text-brand-400">{req.company_name}</p>
                    <h1 className="mt-1 text-[22px] font-extrabold leading-snug text-slate-900 dark:text-slate-100">{req.title}</h1>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {req.category && (
                        <span className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${categoryColor(req.category)}`}>{fmt(req.category)}</span>
                      )}
                      {acceptedModeLabel && (
                        <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400">{acceptedModeLabel}</span>
                      )}
                      {(req.accepted_categories || []).map((c) => (
                        <span key={c} className="rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{fmt(c)}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {req.description && (
                  <p className="mt-5 text-[14px] leading-relaxed text-slate-600 dark:text-slate-400">{req.description}</p>
                )}

                {/* Meta */}
                <div className="mt-5 flex flex-wrap gap-5 text-[13px] text-slate-500 dark:text-slate-400">
                  {req.budget_range && (
                    <span className="inline-flex items-center gap-2">
                      <svg className="h-4 w-4 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="11" rx="2"/><path d="M16 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0"/><path d="M6 12h.01M18 12h.01"/></svg>
                      Budget: <strong className="text-slate-700 dark:text-slate-300">{req.budget_currency || "GBP"} {req.budget_range}</strong>
                    </span>
                  )}
                  {req.deadline && (
                    <span className={`inline-flex items-center gap-2 ${deadlinePassed ? "text-red-500 dark:text-red-400" : ""}`}>
                      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      {deadlinePassed ? "Deadline passed" : `Due ${new Date(req.deadline).toLocaleDateString()}`}
                    </span>
                  )}
                  {req.submission_cap != null && (
                    <span className="inline-flex items-center gap-2">
                      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      Max {req.submission_cap} proposals
                    </span>
                  )}
                  {req.published_at && (
                    <span className="inline-flex items-center gap-2">
                      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
                      Posted {new Date(req.published_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              {/* Specific criteria */}
              {req.specific_criteria && (req.specific_criteria.business_types?.length > 0 || req.specific_criteria.operating_stages?.length > 0 || req.specific_criteria.industry || req.specific_criteria.country) && (
                <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-5 dark:border-violet-800 dark:bg-violet-900/10">
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400">Who can apply</p>
                  <div className="flex flex-wrap gap-x-8 gap-y-3 text-[13px] text-slate-600 dark:text-slate-400">
                    {req.specific_criteria.business_types?.length > 0 && (
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Business type: </span>
                        <span>{req.specific_criteria.business_types.map(t => t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())).join(", ")}</span>
                      </div>
                    )}
                    {req.specific_criteria.operating_stages?.length > 0 && (
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Stage: </span>
                        <span>{req.specific_criteria.operating_stages.map(s => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())).join(", ")}</span>
                      </div>
                    )}
                    {req.specific_criteria.industry && (
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Industry: </span>
                        <span>{req.specific_criteria.industry}</span>
                      </div>
                    )}
                    {req.specific_criteria.country && (
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Country: </span>
                        <span>{req.specific_criteria.country}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Requirements */}
              {reqs.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                  <p className="mb-4 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">What you'll need to provide</p>
                  <ul className="space-y-3">
                    {reqs.map((r, i) => {
                      const text = typeof r === "string" ? r : r?.text || "";
                      const mandatory = typeof r === "object" && !!r?.mandatory;
                      const fmt_key = (typeof r === "object" && r?.format) || "text";
                      const meta = REQ_FORMAT_META[fmt_key] || REQ_FORMAT_META.text;
                      return (
                        <li key={i} className={`flex items-start gap-3 rounded-xl border p-4 ${mandatory ? "border-indigo-100 bg-indigo-50/60 dark:border-indigo-900/50 dark:bg-indigo-900/20" : "border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/30"}`}>
                          <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${mandatory ? "bg-indigo-200 text-indigo-700 dark:bg-indigo-800 dark:text-indigo-300" : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"}`}>
                            {mandatory ? "Required" : "Optional"}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 mb-0.5">
                              <span>{meta.icon}</span>
                              <span>{meta.label}</span>
                            </div>
                            <p className="text-[13px] text-slate-700 dark:text-slate-300">{text}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* CTA */}
              {isOwn ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">This is your request</p>
                  <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Manage it from your Business Operations dashboard.</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    disabled={deadlinePassed || applyLoading}
                    onClick={handleApply}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-[14px] font-bold text-white hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                    {applyLoading ? (
                      <Spinner size={16} />
                    ) : (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/>
                        <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                      </svg>
                    )}
                    {deadlinePassed ? "Deadline Passed" : applyLoading ? "Loading…" : "Submit Proposal"}
                  </button>
                </div>
              )}

              {/* Share panel */}
              <SharePanel req={req} />

              {/* Company info */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Posted by</p>
                <div className="flex items-center gap-3">
                  {req.company_logo ? (
                    <img src={req.company_logo} alt={req.company_name} className="h-10 w-10 rounded-xl border border-slate-200 object-contain p-1 dark:border-slate-700" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 text-sm font-bold text-white">
                      {(req.company_name || "?").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-[14px] font-bold text-slate-800 dark:text-slate-100">{req.company_name}</p>
                    {req.company_industry && <p className="text-[12px] text-slate-500 dark:text-slate-400">{req.company_industry}</p>}
                    {req.company_country && <p className="text-[11px] text-slate-400 dark:text-slate-500">{req.company_country}</p>}
                  </div>
                </div>
                {!isOwn && (
                  <button onClick={handleViewCompany} disabled={profileLoading}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
                    {profileLoading && <Spinner size={12} />}
                    View Company Profile
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
