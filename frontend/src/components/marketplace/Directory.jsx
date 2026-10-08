import { SkeletonCard, SkeletonRegion } from "../Skeleton";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Btn, Notice, Panel, Pill, inputClass } from "../readiness/Fields";
import { Initials } from "./MarketplaceHeader";
import { useAuthStore } from "../../store/auth";
import {
  OPPORTUNITY_LABEL, TRUST_MARK, TRUST_TONE, activateMarketplaceProfile, claimLookup, directoryError, reportBusiness, searchBusinesses, suggestMarketplaceServices, suggestMarketplaceDescription, updateMarketplaceProfile,
  updateOpportunityPreferences,
} from "../../lib/directory";

// Shared pieces of the business directory: the trust label, the search results, the report
// form, and the two settings forms a claimed business uses (public profile, opportunities).

/** Unclaimed is a neutral ownership state, not a mark against the business. */
export function TrustBadge({ trust, withMeaning = false }) {
  if (!trust) return null;
  return (
    <span className="inline-flex flex-col gap-1">
      <Pill tone={TRUST_TONE[trust.state] || "slate"} mark={TRUST_MARK[trust.state]} className="whitespace-nowrap">{trust.label}</Pill>
      {withMeaning && <span className="text-[12px] text-slate-500 dark:text-slate-400">{trust.meaning}</span>}
    </span>
  );
}

// One colour per kind of opportunity, the same on cards and on the profile. Only the ones a business switched on are shown.
const OPPORTUNITY_CHIP = {
  enquiries: ["Enquiries", "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"],
  rfqs: ["RFQs", "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"],
  proposals: ["Proposals", "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"],
  partnerships: ["Partnerships", "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"],
  subcontracting: ["Subcontracting", "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"],
};

export function OpportunityChips({ opportunities }) {
  const open = Object.keys(OPPORTUNITY_CHIP).filter((k) => opportunities?.[k]);
  if (!open.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5" aria-label={`Open for ${open.map((k) => OPPORTUNITY_LABEL[k].toLowerCase()).join(", ")}`}>
      {open.map((k) => <span key={k} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${OPPORTUNITY_CHIP[k][1]}`}>{OPPORTUNITY_CHIP[k][0]}</span>)}
    </span>
  );
}

// ── W01: search and results ───────────────────────────────────────────────────

/** `stickyTop`: the height of whatever is fixed above (the Marketplace header), so the filter bar stays in view under it. */
export function DirectoryResults({ query = "", stickyTop = 0 }) {
  const [filters, setFilters] = useState({ category: "", location: "", trust: "", open_for: "" });
  const [state, setState] = useState({ loading: true, items: [], total: 0, categories: [] });

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, problem: null }));
    const t = setTimeout(() => {
      searchBusinesses({ q: query, ...filters })
        .then((r) => live && setState({ loading: false, ...r }))
        .catch((e) => live && setState({ loading: false, items: [], total: 0, categories: [], problem: directoryError(e, "The directory couldn't be loaded.").message }));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query, filters]);

  if (state.enabled === false) return <div className="pt-6"><Notice>The business directory isn't available yet.</Notice></div>;
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const narrowed = Boolean(query.trim()) || Object.values(filters).some(Boolean);
  const field = `${inputClass} !py-2 !text-[13px]`;
  return (
    <div>
      <div style={{ top: stickyTop }} className="sticky z-20 -mx-4 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 dark:border-slate-800 dark:bg-slate-950/95">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Filter businesses">
          <select aria-label="Category" className={field} value={filters.category} onChange={set("category")}>
            <option value="">All categories</option>
            {(state.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input aria-label="Location or service area" className={field} value={filters.location} onChange={set("location")} placeholder="Location" />
          <select aria-label="Profile status" className={field} value={filters.trust} onChange={set("trust")}>
            <option value="">Any status</option><option value="claimed">Verified only</option><option value="created">Created on EnterprateAI, not verified</option>
            {/* Offered only when unclaimed profiles are listed at all. */}
            {state.unclaimed_listed && <option value="unclaimed">Not yet claimed</option>}
          </select>
          <select aria-label="Open for" className={field} value={filters.open_for} onChange={set("open_for")}>
            <option value="">Any opportunity</option><option value="enquiries">Open for enquiries</option><option value="rfqs">Open for quote requests</option><option value="proposals">Open for proposals</option>
          </select>
        </div>
      </div>
      <div className="space-y-4 pt-5">
        {state.problem && <Notice tone="rose" role="alert">{state.problem}</Notice>}
        {state.loading ? <SkeletonRegion label="businesses"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, n) => <SkeletonCard key={n} className="h-[148px] p-4" lines={3} />)}</div></SkeletonRegion>
          : state.items.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">{narrowed ? "No businesses match that search." : "No businesses listed yet."}</p>
            : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {state.items.map((b) => {
                  const tags = b.service_tags || [];
                  return (
                    <li key={b.id} className="min-w-0">
                      {/* The whole card is the link. */}
                      <Link to={`/marketplace/business/${b.slug}`} aria-label={`${b.name}: view profile`}
                        className="group flex h-full min-h-[212px] flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700">
                        {/* The badge has the top line to itself on every card, so names line up across a row. */}
                        <div className="flex justify-end"><TrustBadge trust={b.trust} /></div>
                        <div className="mt-2 flex items-center gap-3">
                          <Initials name={b.name} size={40} />
                          <div className="min-w-0">
                            <h3 className="break-words text-base font-bold leading-snug text-slate-900 dark:text-slate-100">{b.name}</h3>
                            <p className="truncate text-[12px] text-slate-500">{[b.category, b.location].filter(Boolean).join(" · ")}</p>
                          </div>
                        </div>
                        <p className="mt-2 line-clamp-2 break-words text-[13px] text-slate-600 dark:text-slate-300">{b.description || "No description yet."}</p>
                        {tags.length > 0 && (
                          <p className="mt-2 flex flex-wrap gap-1.5">
                            {tags.slice(0, 3).map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t}</span>)}
                            {tags.length > 3 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">+{tags.length - 3}</span>}
                          </p>
                        )}
                        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                          <OpportunityChips opportunities={b.opportunities} />
                          <span className="ml-auto shrink-0 whitespace-nowrap text-[13px] font-semibold text-brand-600 group-hover:underline dark:text-brand-300">View profile →</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
        {!state.loading && state.total > state.items.length && <p className="text-[12px] text-slate-500">Showing {state.items.length} of {state.total}. Narrow the search to see the rest.</p>}
      </div>
    </div>
  );
}

// ── find and claim your business ──────────────────────────────────────────────

/** An exact name with its company number or website: no browsing and no suggestions. A match
 *  goes to the claim introduction; a miss offers to create a profile instead. */
export function FindToClaim({ defaultOpen = false }) {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const [open, setOpen] = useState(defaultOpen);
  const [form, setForm] = useState({ name: "", company_number: "", website: "" });
  const [state, setState] = useState({});
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setState({}); };

  async function find(e) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await claimLookup({ name: form.name.trim(), company_number: form.company_number.trim() || null, website: form.website.trim() || null });
      if (r.found) navigate(`/marketplace/claim/${r.slug}${r.access ? `?access=${encodeURIComponent(r.access)}` : ""}`);
      else setState({ missed: true });
    } catch (err) {
      setState({ problem: directoryError(err, "That couldn't be checked. Please try again.") });
    }
  }
  const create = () => navigate(token ? "/marketplace/profile" : `/login?signup=1&next=${encodeURIComponent("/marketplace/profile")}`);
  const err = (k) => state.problem?.errors?.[k] && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{state.problem.errors[k]}</span>;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-[13px] text-slate-600 dark:text-slate-300"><span className="font-semibold text-slate-900 dark:text-slate-100">Is your business already known to us?</span> Find it and take control of its profile.</p>
        <Btn onClick={() => setOpen(true)}>Find and claim your business</Btn>
      </div>
    );
  }
  return (
    <form onSubmit={find} aria-label="Find and claim your business" className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Find and claim your business</h2>
      <p className="mt-0.5 text-[13px] text-slate-500">Enter the name exactly as it is registered or trades, with the company number or the website.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div><label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Business name
          <input className={`mt-1 ${inputClass}`} value={form.name} onChange={set("name")} required /></label>{err("name")}</div>
        <div><label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Company number
          <input className={`mt-1 ${inputClass}`} value={form.company_number} onChange={set("company_number")} /></label>{err("company_number")}</div>
        <div><label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">or website
          <input className={`mt-1 ${inputClass}`} value={form.website} onChange={set("website")} placeholder="example.co.uk" /></label></div>
      </div>
      {state.problem && !Object.keys(state.problem.errors || {}).length && <p role="alert" className="mt-2 text-[13px] font-medium text-rose-600">{state.problem.message}</p>}
      {state.missed && (
        <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <span>We couldn't find it. Check the spelling and the number, or start a profile of your own.</span>
          <Btn kind="primary" className="!py-1.5 !text-[13px]" onClick={create}>Create your Marketplace profile</Btn>
        </div>
      )}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Btn onClick={() => { setOpen(false); setState({}); }}>Close</Btn>
        <Btn kind="primary" type="submit" disabled={state.busy || !form.name.trim() || !(form.company_number.trim() || form.website.trim())}>{state.busy ? "Checking…" : "Find my business"}</Btn>
      </div>
    </form>
  );
}

// ── report / correction (no account needed) ───────────────────────────────────

export function ReportBox({ slug, via }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: "correction", message: "", email: "" });
  const [state, setState] = useState({});
  async function send(e) {
    e.preventDefault();
    setState({ busy: true });
    try { const r = await reportBusiness(slug, form, via); setState({ done: r.message }); }
    catch (err) { setState({ problem: directoryError(err, "That couldn't be sent. Please try again.") }); }
  }
  if (state.done) return <Notice tone="emerald">{state.done}</Notice>;
  if (!open) return <Btn kind="link" className="text-[13px] !text-slate-500" onClick={() => setOpen(true)}>Report incorrect information</Btn>;
  return (
    <form onSubmit={send} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700" aria-label="Report this profile">
      <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">What would you like to do?
        <select className={`mt-1 ${inputClass}`} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          <option value="correction">Correct something on this page</option><option value="unlist">Ask for this page to be removed</option><option value="other">Something else</option>
        </select>
      </label>
      <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Details
        <textarea rows={3} className={`mt-1 ${inputClass}`} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        {state.problem?.errors?.message && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{state.problem.errors.message}</span>}
      </label>
      <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Your email (optional, if you'd like a reply)
        <input type="email" className={`mt-1 ${inputClass}`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      {state.problem && !Object.keys(state.problem.errors || {}).length && <p role="alert" className="text-[12px] font-medium text-rose-600">{state.problem.message}</p>}
      <div className="flex gap-2"><Btn kind="primary" type="submit" disabled={state.busy}>Send</Btn><Btn onClick={() => setOpen(false)}>Cancel</Btn></div>
      <p className="text-[12px] text-slate-500">You don't need an account, and you don't need to claim the profile, for us to act on this.</p>
    </form>
  );
}

// ── W08: public profile review ────────────────────────────────────────────────

/** "AI fill": writes the field from what the business has on record. It says it uses AI Credits, and what it writes can be edited before saving. */
function AiFill({ writing, disabled, onClick, label }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-ai-fill aria-label={label} aria-busy={writing || undefined}
      title="Written from your business details. Uses AI Credits. You can edit it before saving."
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[12px] font-semibold text-brand-700 transition hover:bg-brand-100 disabled:opacity-60 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-200">
      {writing ? <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700" />
        : <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M8 1.5l1.2 2.8 2.8 1.2-2.8 1.2L8 9.5 6.8 6.7 4 5.5l2.8-1.2L8 1.5z" /><path d="M12.5 9.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7.7-1.6z" opacity=".6" /></svg>}
      {writing ? "Writing…" : "AI fill"}
    </button>
  );
}

export function ProfileSettings({ profile, claimId, onSaved, saveLabel = "Save profile", preview = true, footerLeft = null, flag = null }) {
  const p = profile.profile;
  const [form, setForm] = useState({ description: p.description, website: p.website, service_area: p.service_area, contact_preference: p.contact_preference,
    public_email: p.public_email || "", public_phone: p.public_phone || "",
    tags: (p.service_tags.length ? p.service_tags : profile.directory?.sourced_tags || []).join(", ") });
  const [published, setPublished] = useState(() => new Set(profile.offerings.filter((o) => o.published).map((o) => o.id)));
  const [state, setState] = useState({});
  const navigate = useNavigate();
  const frozen = profile.directory?.frozen;
  const disabled = !profile.can_edit || frozen || state.busy;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // AI fill: the words go into the box for the owner to change. Nothing is saved until they save.
  const [writing, setWriting] = useState(null);      // "description" | "services" while it is being written
  const [filled, setFilled] = useState({});
  async function fill(field) {
    if (writing) return;
    setWriting(field);
    setFilled({});
    const draft = { description: form.description, service_area: form.service_area, service_tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean) };
    try {
      if (field === "services") {
        const res = await suggestMarketplaceServices(profile.business_id, draft);
        setForm((f) => ({ ...f, tags: res.suggestion }));
        setFilled({ field, note: "Suggested from your business details. Change or remove any that aren't right, then save." });
      } else {
        const res = await suggestMarketplaceDescription(profile.business_id, draft);
        const before = form.description;
        setForm((f) => ({ ...f, description: res.suggestion }));
        setFilled({ field, note: "Written for you from your business details. Check it and change anything that isn't right, then save.", before });
      }
    } catch (err) {
      const problem = directoryError(err, field === "services" ? "Services couldn't be suggested just now. Please try again." : "A description couldn't be written just now. Please try again.");
      setFilled({ field, problem: problem.errors?.description || problem.errors?.service_tags || problem.message });
    } finally { setWriting(null); }
  }

  async function save(e) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const saved = await updateMarketplaceProfile(profile.business_id, {
        description: form.description, website: form.website, service_area: form.service_area, contact_preference: form.contact_preference,
        public_email: form.public_email.trim(), public_phone: form.public_phone.trim(),
        service_tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean), published_offering_ids: [...published],
      }, p.revision, claimId);
      setState({ saved: true });
      onSaved(saved);
    } catch (err) {
      setState({ problem: directoryError(err, "Your profile couldn't be saved. Your changes are still here; try again.") });
    }
  }
  const err = (k) => state.problem?.errors?.[k] && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{state.problem.errors[k]}</span>;
  // After a save that left the profile unable to go live (`flag`: the checklist rows still to do),
  // each field says what it needs. Worked out from what is in the form now, so it clears as they type.
  const length = form.description.trim().length;
  const offered = published.size > 0 || form.tags.split(",").some((t) => t.trim());
  const need = (k, text) => flag?.includes(k) && <span data-needed={k} className="mt-1 block text-[12px] font-medium text-amber-700 dark:text-amber-300">{text}</span>;
  return (
    <form onSubmit={save} className="space-y-4" aria-label="Public Marketplace profile">
      {frozen && <Notice tone="amber">Who manages this profile is under review, so changes are paused until that is settled.</Notice>}
      {!profile.can_edit && <Notice>Your role can view this profile but not change it.</Notice>}
      {profile.directory && profile.directory.origin !== "created" && (
        <Notice>
          <span className="font-semibold">{profile.directory.sourced?.name}</span>{profile.directory.legal_identifier ? ` · registered number ${profile.directory.legal_identifier}` : ""}.
          {" "}These come from public sources and stay on record; what you write below is what the public sees.
        </Notice>
      )}
      <div>
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <label htmlFor="mp-field-description" className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Public description
            <span className="mt-0.5 block text-[12px] font-normal text-slate-500">What you do and who for. At least 20 characters.</span>
          </label>
          {profile.can_edit && !frozen && (
            <AiFill writing={writing === "description"} disabled={disabled || Boolean(writing)} onClick={() => fill("description")} label="AI fill: write the public description for me" />
          )}
        </div>
        <textarea id="mp-field-description" rows={4} className={`mt-1 ${inputClass}`} disabled={disabled} value={form.description} onChange={set("description")} />{err("description")}
        {filled.field === "description" && filled.note && <span role="status" className="mt-1 block text-[12px] text-slate-500">{filled.note}{filled.before != null && <button type="button" onClick={() => { setForm((f) => ({ ...f, description: filled.before })); setFilled({}); }} className="ml-2 font-semibold text-brand-700 underline-offset-2 hover:underline">Undo</button>}</span>}
        {filled.field === "description" && filled.problem && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{filled.problem}</span>}
        {length < 20 && need("description", length ? `${length} of 20 characters. Add ${20 - length} more to publish.` : "Needed to publish: at least 20 characters.")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Website
          <input className={`mt-1 ${inputClass}`} disabled={disabled} value={form.website} onChange={set("website")} placeholder="example.co.uk" />{err("website")}
        </label>
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Location or service area
          <input id="mp-field-service_area" className={`mt-1 ${inputClass}`} disabled={disabled} value={form.service_area} onChange={set("service_area")} placeholder="For example: Leeds and remote" />{err("service_area")}
          {!form.service_area.trim() && need("service_area", "Needed to publish.")}
        </label>
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">How should people contact you?
          <select className={`mt-1 ${inputClass}`} disabled={disabled} value={form.contact_preference} onChange={set("contact_preference")}>
            <option value="enquiry_form">Through an enquiry on EnterprateAI</option><option value="email">By email</option><option value="phone">By phone</option><option value="none">Don't show a contact route</option>
          </select>
        </label>
        {form.contact_preference === "email" && (
          <div>
            <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Business email to show publicly
              <input type="email" className={`mt-1 ${inputClass}`} disabled={disabled} value={form.public_email} onChange={set("public_email")} placeholder="hello@yourbusiness.co.uk" />
            </label>
            <span className="mt-0.5 block text-[12px] text-slate-500">Anyone can see this. Your sign-in email is never shown.</span>
            {err("public_email")}
          </div>
        )}
        {form.contact_preference === "phone" && (
          <div>
            <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Business phone number to show publicly
              <input type="tel" className={`mt-1 ${inputClass}`} disabled={disabled} value={form.public_phone} onChange={set("public_phone")} />
            </label>
            <span className="mt-0.5 block text-[12px] text-slate-500">Anyone can see this.</span>
            {err("public_phone")}
          </div>
        )}
        <div>
          <div className="flex items-end justify-between gap-2">
            <label htmlFor="mp-field-offering" className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Services (separate with commas)</label>
            {profile.can_edit && !frozen && <AiFill writing={writing === "services"} disabled={disabled || Boolean(writing)} onClick={() => fill("services")} label="AI fill: suggest my services" />}
          </div>
          <input id="mp-field-offering" className={`mt-1 ${inputClass}`} disabled={disabled} value={form.tags} onChange={set("tags")} placeholder="Pricing, Strategy" />
          {filled.field === "services" && filled.note && <span role="status" className="mt-1 block text-[12px] text-slate-500">{filled.note}</span>}
          {filled.field === "services" && filled.problem && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{filled.problem}</span>}
        </div>
      </div>
      <div>
        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Offerings to show publicly</p>
        <p className="text-[12px] text-slate-500">These are your Catalogue items. Ticking one shows it on your profile; nothing is copied.</p>
        {!offered && need("offering", "Needed to publish: tick at least one offering, or list a service above.")}
        {profile.offerings.length === 0 ? (
          <p className="mt-1 text-[13px] text-slate-500">Your Catalogue is empty. <Btn kind="link" onClick={() => navigate("/catalogue")}>Add a product or service</Btn>, or list your services above.</p>
        ) : (
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {profile.offerings.map((o) => (
              <li key={o.id}>
                <label className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-200">
                  <input type="checkbox" disabled={disabled} checked={published.has(o.id)}
                    onChange={(e) => setPublished((s) => { const n = new Set(s); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n; })} />
                  {o.name}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {state.problem && <Notice tone="rose" role="alert">{state.problem.message}</Notice>}
      <div className={`flex flex-wrap items-center gap-3 ${footerLeft ? "flex-row-reverse justify-between border-t border-slate-100 pt-4 dark:border-slate-800" : ""}`}>
        <Btn kind="primary" type="submit" className="max-sm:w-full" disabled={disabled}>{state.busy ? "Saving…" : saveLabel}</Btn>
        {preview && profile.directory?.slug && profile.directory.public !== false && <Btn onClick={() => window.open(`/marketplace/business/${profile.directory.slug}`, "_blank", "noopener")}>Preview public profile</Btn>}
        {state.busy && <span role="status" className="text-[12px] text-slate-500">Saving your profile…</span>}
        {state.saved && <span role="status" className="text-[12px] text-slate-500">Saved.</span>}
        {footerLeft && <span className="mr-auto">{footerLeft}</span>}
      </div>
    </form>
  );
}

// ── W09: opportunity preferences ──────────────────────────────────────────────

function Toggle({ label, help, checked, onChange, disabled, children }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span><span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span><span className="block text-[12px] text-slate-500">{help}</span></span>
      </label>
      {checked && children && <div className="mt-2 pl-7">{children}</div>}
    </div>
  );
}

export function OpportunityPreferences({ profile, claimId, onSaved, saveLabel = "Save opportunity settings", activateOnSave = false, footerLeft = null }) {
  const [prefs, setPrefs] = useState(() => JSON.parse(JSON.stringify(profile.preferences)));
  const [state, setState] = useState({});
  const frozen = profile.directory?.frozen;
  const disabled = !profile.can_edit || frozen || state.busy;
  const set = (key, patch) => setPrefs((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  const modes = new Set(prefs.proposals.accepted_modes || []);

  async function save(e) {
    e.preventDefault();
    setState({ busy: "saving" });
    try {
      let saved = await updateOpportunityPreferences(profile.business_id, {
        enquiries: { enabled: prefs.enquiries.enabled },
        rfqs: { enabled: prefs.rfqs.enabled, categories: prefs.rfqs.categories, service_areas: prefs.rfqs.service_areas },
        proposals: { enabled: prefs.proposals.enabled, accepted_modes: [...modes].length ? [...modes] : ["general"] },
        partnerships: { enabled: prefs.partnerships.enabled, notes: prefs.partnerships.notes },
        subcontracting: { enabled: prefs.subcontracting.enabled, notes: prefs.subcontracting.notes },
        notifications: { email: prefs.notifications.email },
      }, claimId);
      let notice = null;
      if (activateOnSave) {
        setState({ busy: "publishing" });
        try { saved = await activateMarketplaceProfile(profile.business_id, true); }
        catch (err) {
          // Settings are saved either way. Publishing can wait for a missing item or a plan that includes it.
          const p = directoryError(err);
          notice = p.code === "invalid" ? `Saved. Not published yet: ${Object.values(p.errors).join(" ")}` : `Saved. ${p.message}`;
        }
      }
      setState({ saved: true, notice });
      onSaved(saved, { published: Boolean(saved.is_published), notice });
    } catch (err) {
      setState({ problem: directoryError(err, "Your settings couldn't be saved. They are still here; try again.") });
    }
  }
  const list = (value) => (value || []).join(", ");
  const parse = (text) => text.split(",").map((t) => t.trim()).filter(Boolean);
  return (
    <form onSubmit={save} className="space-y-3" aria-label="Opportunity preferences">
      {frozen && <Notice tone="amber">Who manages this profile is under review, so changes are paused until that is settled.</Notice>}
      <Toggle label="Enquiries" help="Show an enquiry action on your profile." checked={prefs.enquiries.enabled} disabled={disabled} onChange={(v) => set("enquiries", { enabled: v })} />
      <Toggle label="Quote requests (RFQs)" help="Be found for relevant requests for a quote." checked={prefs.rfqs.enabled} disabled={disabled} onChange={(v) => set("rfqs", { enabled: v })}>
        <div className="grid gap-2 sm:grid-cols-2">
          <input aria-label="Categories for quote requests" className={inputClass} disabled={disabled} defaultValue={list(prefs.rfqs.categories)} onChange={(e) => set("rfqs", { categories: parse(e.target.value) })} placeholder="Categories, separated by commas" />
          <input aria-label="Service areas for quote requests" className={inputClass} disabled={disabled} defaultValue={list(prefs.rfqs.service_areas)} onChange={(e) => set("rfqs", { service_areas: parse(e.target.value) })} placeholder="Service areas, separated by commas" />
        </div>
      </Toggle>
      <Toggle label="Proposals" help="Accept proposals through Proposal Intelligence. These are the same settings as in Business Blueprints." checked={prefs.proposals.enabled} disabled={disabled} onChange={(v) => set("proposals", { enabled: v })}>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(profile.proposal_modes || []).map((m) => (
            <label key={m.key} className="flex items-center gap-1.5 text-[13px] text-slate-700 dark:text-slate-200">
              <input type="checkbox" disabled={disabled} checked={modes.has(m.key)}
                onChange={(e) => { const n = new Set(modes); if (e.target.checked) n.add(m.key); else n.delete(m.key); set("proposals", { accepted_modes: [...n] }); }} />
              {m.label}
            </label>
          ))}
        </div>
      </Toggle>
      <Toggle label="Partnerships" help="Say you're open to partnering. Nothing is agreed automatically." checked={prefs.partnerships.enabled} disabled={disabled} onChange={(v) => set("partnerships", { enabled: v })}>
        <input aria-label="Partnership notes" className={inputClass} disabled={disabled} value={prefs.partnerships.notes} onChange={(e) => set("partnerships", { notes: e.target.value })} placeholder="What kind of partner are you looking for?" />
      </Toggle>
      <Toggle label="Subcontracting" help="Say you have capacity to deliver work for other businesses. No contract is created automatically." checked={prefs.subcontracting.enabled} disabled={disabled} onChange={(v) => set("subcontracting", { enabled: v })}>
        <input aria-label="Subcontracting notes" className={inputClass} disabled={disabled} value={prefs.subcontracting.notes} onChange={(e) => set("subcontracting", { notes: e.target.value })} placeholder="What work can you take on?" />
      </Toggle>
      <label className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-200">
        <input type="checkbox" disabled={disabled} checked={prefs.notifications.email} onChange={(e) => set("notifications", { email: e.target.checked })} />
        Email me about eligible Marketplace opportunities
      </label>
      {state.problem && <Notice tone="rose" role="alert">{state.problem.message}</Notice>}
      {state.notice && <Notice tone="amber">{state.notice}</Notice>}
      <div className={`flex flex-wrap items-center gap-3 ${footerLeft ? "flex-row-reverse justify-between border-t border-slate-100 pt-4 dark:border-slate-800" : ""}`}>
        <Btn kind="primary" type="submit" disabled={disabled}>{state.busy === "publishing" ? "Publishing…" : state.busy ? "Saving…" : saveLabel}</Btn>
        {state.busy && <span role="status" className="text-[12px] text-slate-500">{state.busy === "publishing" ? "Publishing your profile…" : "Saving your opportunity settings…"}</span>}
        {state.saved && !state.notice && <span role="status" className="text-[12px] text-slate-500">Saved.</span>}
        {footerLeft && <span className="mr-auto">{footerLeft}</span>}
      </div>
    </form>
  );
}

/** The rows the checklist shows and the status line counts: everything needed, plus an optional
 *  item only once it is done (an unverified profile isn't marked down for a step it doesn't need). */
export const checklistItems = (activation) => (activation?.items || []).filter((i) => !i.optional || i.done);

export function ActivationChecklist({ activation, onTodo, collapsible = false }) {
  const items = checklistItems(activation);
  const ready = items.filter((i) => i.done).length;
  const [open, setOpen] = useState(false);      // below 1024px, where it sits above the form: closed until asked for
  const pill = "inline-flex w-[58px] justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold";
  return (
    <Panel id="marketplace-checklist" className="scroll-mt-24">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Marketplace activation</h2>
          <p className={`mt-0.5 text-[13px] text-slate-500 dark:text-slate-400 ${collapsible ? "max-lg:hidden" : ""}`}>Your profile goes live once these are in place.</p>
        </div>
        {collapsible && (
          <button type="button" aria-expanded={open} aria-controls="marketplace-checklist-rows" aria-label={`Activation ${ready}/${items.length}: ${open ? "hide" : "show"} the checklist`} onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-semibold text-slate-700 lg:hidden dark:border-slate-700 dark:text-slate-200">
            Activation {ready}/{items.length} <span aria-hidden="true">{open ? "▴" : "▾"}</span>
          </button>
        )}
      </div>
      <div className="mt-3" data-checklist-progress>
        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{ready} of {items.length} ready</p>
        <div role="progressbar" aria-label="Activation progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={ready} className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${items.length ? Math.round((ready / items.length) * 100) : 0}%` }} />
        </div>
      </div>
      <ul id="marketplace-checklist-rows" className={`mt-3 space-y-2.5 ${collapsible && !open ? "max-lg:hidden" : ""}`}>
        {items.map((i) => (
          <li key={i.key} data-checklist-row={i.key} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2 text-[13px] text-slate-700 dark:text-slate-200">
            {i.done
              ? <svg aria-hidden="true" className="h-5 w-5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z" clipRule="evenodd" /></svg>
              : <svg aria-hidden="true" className="h-5 w-5 text-amber-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10" cy="10" r="7" /></svg>}
            <span className="min-w-0 break-words leading-5">{i.label}
              {!i.done && i.fix && <span className="mt-0.5 block text-[12px] text-amber-700 dark:text-amber-300">{i.fix}</span>}
            </span>
            {i.done ? <span className={`${pill} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200`}>Done</span>
              : onTodo ? <button type="button" aria-label={`To do: ${i.label}`} onClick={() => onTodo(i.key)} className={`${pill} bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100`}>To do</button>
                : <span className={`${pill} bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100`}>To do</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
