import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ReportBox, TrustBadge } from "../components/marketplace/Directory";
import MarketplaceHeader, { Initials } from "../components/marketplace/MarketplaceHeader";
import { Btn, Notice, Panel } from "../components/readiness/Fields";
import { activateMarketplaceProfile, directoryError, getBusinessProfile, profileAccess, recordProfileView, verifyOwnBusiness } from "../lib/directory";
import { confirmDialog } from "../lib/dialog";
import { SkeletonBlock, SkeletonCard, SkeletonRegion, SkeletonText } from "../components/Skeleton";

// W02 and W12: a business's public Marketplace profile. Before a claim it shows what public
// sources say, labelled as such, with a clear way to claim it. After a claim it shows what
// the owner has confirmed and only the actions they switched on.
//
// The page: a header card across the top (who this is, one trust badge, one main button), then
// the business's own words and offerings on the left and how to reach it on the right. The
// owner's controls are a slim bar above all of that, never part of what the public sees.

export function PublicFrame({ children }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 dark:bg-slate-950">
      <MarketplaceHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

function useNoIndex(on) {
  // Sparse, unclaimed-and-thin or disputed profiles are kept out of search engines.
  useEffect(() => {
    if (!on) return undefined;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [on]);
}

function useAway(open, close, box) {
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);      // eslint-disable-line react-hooks/exhaustive-deps
}

const sourceLine = (profile) => (profile.source_basis ? `Based on public sources${profile.sources?.length ? ` · ${profile.sources.join(", ")}` : ""}` : `${profile.trust.label} · what this means`);

/** What the badge means and where the details come from, as sentences. Used by the badge's tooltip and the trust card. */
function TrustWords({ profile }) {
  const sourced = Boolean(profile.source_basis);
  return (
    <>
      <p><span className="font-semibold">{profile.trust.label}.</span> {profile.trust.meaning}</p>
      {sourced && <p>{profile.source_basis}{profile.sources?.length ? ` Sources: ${profile.sources.join(", ")}.` : ""}</p>}
      {sourced && !profile.claimed && <p>The business can confirm or change these details after claiming the profile.</p>}
      {profile.legal_identifier && <p>Registered number {profile.legal_identifier}, from the public register.</p>}
    </>
  );
}

/** The "i" beside the badge: what it means, on request. */
function BadgeInfo({ profile }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useAway(open, () => setOpen(false), box);
  return (
    <span ref={box} className="relative inline-flex">
      <button type="button" aria-label={sourceLine(profile)} aria-expanded={open} aria-controls="profile-provenance" onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-bold text-slate-500 hover:border-brand-500 hover:text-brand-700 dark:border-slate-600 dark:text-slate-300">
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span id="profile-provenance" role="note" className="absolute left-0 top-7 z-20 block w-[min(22rem,calc(100vw-2rem))] space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-left text-[13px] font-normal text-slate-700 shadow-lg max-sm:-left-24 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <TrustWords profile={profile} />
        </span>
      )}
    </span>
  );
}

/** The business's own description: four lines, and the rest on request. */
function About({ text }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const body = useRef(null);
  useLayoutEffect(() => { const el = body.current; if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1); }, [text, open]);
  return (
    <>
      <p ref={body} data-about className={`whitespace-pre-line break-words text-sm leading-6 text-slate-700 dark:text-slate-200 ${open ? "" : "line-clamp-4"}`}>{text || "No description yet."}</p>
      {(long || open) && <Btn kind="link" className="mt-1" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Show less" : "Read more"}</Btn>}
    </>
  );
}

const ICON = {
  enquiries: "M8 10h8M8 14h5m8-2a9 9 0 11-4.2-7.6L21 3l-1 4.5A8.96 8.96 0 0121 12z",
  rfqs: "M9 7h6m-6 4h6m-6 4h3m5 6H6a2 2 0 01-2-2V5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2z",
  proposals: "M12 19l9 2-9-18-9 18 9-2zm0 0v-8",
  partnerships: "M17 20h5v-2a4 4 0 00-5-3.9M9 20H2v-2a4 4 0 015-3.9m10-3.1a3 3 0 10-6 0 3 3 0 006 0zM9 8a3 3 0 11-6 0 3 3 0 016 0zm3 12v-2a4 4 0 00-3-3.9",
  subcontracting: "M4 7h16M4 12h10M4 17h7m7-3v6m-3-3h6",
};
// The opportunity types in plain words: what a visitor can do, one line on what happens, and the button that does it.
const WAYS = [
  ["enquiries", "Ask a question", "Send a message and get a reply from the business."],
  ["rfqs", "Request a quote", "Say what you need and get a price for it."],
  ["proposals", "Send a proposal", "Offer your services or an idea to this business."],
  ["partnerships", "Partner with us", "Suggest working together on a shared opportunity."],
  ["subcontracting", "Subcontract work", "Bring them in on part of a project of yours."],
];

function since(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `On EnterprateAI since ${d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : null;
}

/** The owner's own controls, above the public page: a row of links, or one menu on a phone. */
function OwnerBar({ profile, busy, problem, onVerify, onUnlist, onVisitor }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useAway(open, () => setOpen(false), box);
  const edit = `/marketplace/profile?business=${profile.business_id}`;
  const items = [
    { key: "edit", label: "Edit profile", onClick: () => navigate(edit) },
    { key: "opportunities", label: "Opportunity settings", onClick: () => navigate(`${edit}&tab=opportunities`) },
    profile.trust.state === "created" && { key: "verify", label: busy === "verify" ? "Starting…" : "Verify", onClick: onVerify },
    profile.activated && { key: "unlist", label: busy === "unlist" ? "Unlisting…" : "Unlist", onClick: onUnlist, danger: true },
    { key: "visitor", label: "View as visitor", onClick: onVisitor },
  ].filter(Boolean);
  const link = (i) => `text-[13px] font-semibold underline-offset-2 hover:underline disabled:opacity-50 ${i.danger ? "text-rose-700 dark:text-rose-300" : "text-brand-700 dark:text-brand-300"}`;
  return (
    <div data-owner-bar role="region" aria-label="Your profile" className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-900 dark:bg-brand-950/40">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-[13px] font-semibold text-brand-900 dark:text-brand-100">You're viewing your public profile</p>
        <div className="hidden flex-wrap items-center justify-end gap-x-4 gap-y-1 md:flex">
          {items.map((i) => <button key={i.key} type="button" disabled={Boolean(busy)} onClick={i.onClick} className={link(i)}>{i.label}</button>)}
        </div>
        <div ref={box} className="relative md:hidden">
          <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-brand-800 dark:border-brand-800 dark:bg-slate-900 dark:text-brand-200">Manage</button>
          {open && (
            <div role="menu" className="absolute right-0 top-10 z-30 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {items.map((i) => (
                <button key={i.key} type="button" role="menuitem" disabled={Boolean(busy)} onClick={() => { setOpen(false); i.onClick(); }}
                  className={`block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800 ${i.danger ? "text-rose-700 dark:text-rose-300" : "text-slate-700 dark:text-slate-200"}`}>{i.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {problem && <p role="alert" className="mt-1 text-[12px] font-medium text-rose-600">{problem}</p>}
    </div>
  );
}

export default function DirectoryProfilePage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true });
  const [owner, setOwner] = useState({});      // the owner's controls: what is running, or what went wrong
  const [asVisitor, setAsVisitor] = useState(false);
  const [shared, setShared] = useState("");
  const b = state.profile;
  // What opens this profile if unclaimed profiles aren't public: an invitation link or an exact-match lookup.
  const via = profileAccess(slug, params);
  useNoIndex(Boolean(b?.noindex));

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    getBusinessProfile(slug, via)
      .then((profile) => { if (live) { setState({ loading: false, profile }); recordProfileView(slug, via); } })
      .catch((e) => live && setState({ loading: false, problem: directoryError(e, "This profile couldn't be loaded.") }));
    return () => { live = false; };
  }, [slug]);

  useEffect(() => { if (b?.name) document.title = `${b.name} · EnterprateAI Marketplace`; }, [b?.name]);
  // An older address (before a location was tidied, or before two profiles became one) moves to the current one.
  useEffect(() => {
    if (b?.canonical_slug && b.canonical_slug !== slug) navigate(`/marketplace/business/${b.canonical_slug}${params.toString() ? `?${params}` : ""}`, { replace: true });
  }, [b?.canonical_slug]);      // eslint-disable-line react-hooks/exhaustive-deps

  if (state.loading) {
    // The page's own shape: the header card, then the main column beside the sidebar.
    return (
      <PublicFrame>
        <SkeletonRegion label="this business profile">
          <SkeletonCard className="p-4 sm:p-6">
            <div className="flex items-start gap-4"><SkeletonBlock className="h-14 w-14 shrink-0 rounded-full" /><div className="min-w-0 flex-1"><SkeletonBlock className="h-7 w-64 max-w-full rounded" /><SkeletonBlock className="mt-3 h-4 w-80 max-w-full rounded" /></div></div>
          </SkeletonCard>
          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <SkeletonCard className="p-4 sm:p-5" lines={4} />
              <SkeletonCard className="p-4 sm:p-5"><SkeletonBlock className="h-4 w-28 rounded" /><div className="mt-4 grid gap-3 sm:grid-cols-2"><SkeletonBlock className="h-32 rounded-xl" /><SkeletonBlock className="h-32 rounded-xl" /></div></SkeletonCard>
              <SkeletonCard className="p-4 sm:p-5" lines={3} />
            </div>
            <div className="order-first space-y-4 lg:order-none"><SkeletonCard className="p-4 sm:p-5"><SkeletonBlock className="h-4 w-48 rounded" /><SkeletonText lines={2} className="mt-3" /><SkeletonBlock className="mt-4 h-10 w-full rounded-xl" /></SkeletonCard><SkeletonCard className="p-4 sm:p-5" lines={2} /></div>
          </div>
        </SkeletonRegion>
      </PublicFrame>
    );
  }
  if (state.problem) {
    return (
      <PublicFrame>
        <Notice tone={state.problem.status === 404 ? "slate" : "rose"} role="alert">{state.problem.status === 404 ? "This business profile isn't available." : state.problem.message}</Notice>
        <Btn className="mt-3" onClick={() => navigate("/marketplace?tab=businesses")}>Back to the business directory</Btn>
      </PublicFrame>
    );
  }

  const carried = new URLSearchParams(Object.entries({ invite: via.invite, access: via.access }).filter(([, v]) => v)).toString();
  const claimLink = `/marketplace/claim/${b.canonical_slug || b.slug}${carried ? `?${carried}` : ""}`;
  const paused = b.trust.state === "disputed";
  const mine = Boolean(b.owner_controls) && !asVisitor;

  async function unlist() {
    if (!(await confirmDialog("Your profile will no longer be shown on the Marketplace. Your profile, offerings and settings are kept, and you can list it again at any time.",
      { title: "Unlist your business?", confirmLabel: "Unlist", danger: true }))) return;
    setOwner({ busy: "unlist" });
    try { await activateMarketplaceProfile(b.business_id, false); navigate(`/marketplace/profile?business=${b.business_id}`); }
    catch (e) { setOwner({ problem: directoryError(e, "Your business couldn't be unlisted. Nothing was changed; try again.").message }); }
  }
  async function verifyMine() {
    setOwner({ busy: "verify" });
    try { const claim = await verifyOwnBusiness(b.business_id); navigate(`/marketplace/claim/${claim.profile.slug}`); }
    catch (e) { setOwner({ problem: directoryError(e, "Verification couldn't be started. Please try again.").message }); }
  }
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) { await navigator.share({ title: b.name, url }); return; }
      await navigator.clipboard.writeText(url);
      setShared("Link copied");
    } catch { setShared(""); }
  }

  // What a visitor can do. Only what the business switched on, and nothing while ownership is under review.
  const toListing = b.listing_id ? `/marketplace?tab=products&business=${b.listing_id}` : null;
  const quoteLink = (offering) => `${toListing}&quote=1${offering ? `&offering=${encodeURIComponent(offering)}` : ""}`;
  const open = b.claimed && !paused && toListing ? (b.opportunities || {}) : {};
  const goTo = { enquiries: toListing, rfqs: toListing && quoteLink(), proposals: toListing, partnerships: toListing, subcontracting: toListing };
  const ways = WAYS.filter(([key]) => open[key]).map(([key, label, line]) => ({ key, label, line, to: goTo[key] }));
  const mail = !paused && b.contact?.email ? `mailto:${b.contact.email}` : null;
  // One main button: a quote where quotes are on, otherwise the way to get in touch.
  const main = !b.claimed ? (b.claim?.eligible ? { label: b.claim.cta, go: () => navigate(claimLink) } : null)
    : open.rfqs ? { label: "Request a quote", go: () => navigate(quoteLink()) }
      : open.enquiries ? { label: "Contact", go: () => navigate(toListing) }
        : mail ? { label: "Contact", go: () => { window.location.href = mail; } } : null;
  const site = b.website ? (/^https?:\/\//.test(b.website) ? b.website : `https://${b.website}`) : null;
  const place = [b.location, b.country].filter(Boolean).filter((x, i, all) => all.findIndex((y) => String(y).toLowerCase() === String(x).toLowerCase()) === i).join(", ");
  const joined = since(b.since);
  const meta = [b.category, place].filter(Boolean);
  const sticky = b.claimed && main;      // on a phone, the main button stays in reach

  return (
    <PublicFrame>
      {mine && <OwnerBar profile={b} busy={owner.busy} problem={owner.problem} onVerify={verifyMine} onUnlist={unlist} onVisitor={() => setAsVisitor(true)} />}
      {b.owner_controls && asVisitor && (
        <div data-owner-bar role="region" aria-label="Your profile" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] dark:border-slate-700 dark:bg-slate-900">
          <span className="font-semibold text-slate-700 dark:text-slate-200">This is what a visitor sees</span>
          <button type="button" onClick={() => setAsVisitor(false)} className="font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">Back to your view</button>
        </div>
      )}
      {mine && b.quality_hold?.length > 0 && (
        <Notice tone="amber" role="alert" className="mb-4">
          <p className="font-semibold">Only you can see this page. It isn't shown on the Marketplace until this is fixed:</p>
          <ul className="mt-1 list-disc pl-5">{b.quality_hold.map((line) => <li key={line}>{line}</li>)}</ul>
          <Btn kind="link" className="mt-1" onClick={() => navigate(`/marketplace/profile?business=${b.business_id}`)}>Edit profile</Btn>
        </Notice>
      )}

      {/* Identity: who this is, how far it can be trusted, and the one thing to do next. */}
      <section aria-label="Business" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Initials name={b.name} size={56} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h1 className="min-w-0 break-words text-2xl font-bold leading-tight text-slate-900 sm:text-[28px] dark:text-slate-100">{b.name}</h1>
                <span className="inline-flex items-center gap-1.5"><TrustBadge trust={b.trust} /><BadgeInfo profile={b} /></span>
              </div>
              {b.trading_name && b.trading_name !== b.name && <p className="mt-0.5 text-sm text-slate-500">Trading as {b.trading_name}</p>}
              <p data-meta className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-600 dark:text-slate-300">
                {meta.map((m, i) => <span key={m} className="inline-flex items-center gap-2">{i > 0 && <span aria-hidden="true" className="text-slate-300">·</span>}{m}</span>)}
                {site && (
                  <span className="inline-flex min-w-0 items-center gap-2">{meta.length > 0 && <span aria-hidden="true" className="text-slate-300">·</span>}
                    <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">{b.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
                  </span>
                )}
                {joined && <span className="inline-flex items-center gap-2">{(meta.length > 0 || site) && <span aria-hidden="true" className="text-slate-300">·</span>}{joined}</span>}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {main && <Btn kind="primary" className="w-full !px-5 !py-2.5 sm:w-auto" onClick={main.go}>{main.label}</Btn>}
            <Btn className="w-full !py-2.5 sm:w-auto" onClick={share}>Share</Btn>
            {shared && <span role="status" className="text-[12px] text-slate-500">{shared}</span>}
          </div>
        </div>
      </section>

      <div className={`mt-4 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] ${sticky ? "max-md:pb-20" : ""}`} data-profile-grid>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="About"><About text={b.description} /></Panel>

          <Panel title={b.claimed && b.activated ? "Offerings" : "Services"}>
            {b.offerings?.length > 0 && (
              <ul className="mb-3 grid gap-3 sm:grid-cols-2" data-offerings>
                {b.offerings.map((o) => (
                  <li key={o.id} className="flex flex-col rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <p className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{o.name}</p>
                    {o.description && <p className="mt-0.5 line-clamp-3 break-words text-[13px] text-slate-600 dark:text-slate-300">{o.description}</p>}
                    <p className="mt-2 text-[13px] font-semibold text-slate-800 dark:text-slate-200">{o.price ? `From ${new Intl.NumberFormat("en-GB", { style: "currency", currency: o.currency || "GBP", maximumFractionDigits: 0 }).format(o.price)}` : "Price on request"}</p>
                    {(open.rfqs || open.enquiries) && (
                      <Btn className="mt-3 w-full !py-2" aria-label={`${open.rfqs ? "Request a quote" : "Ask about this"}: ${o.name}`}
                        onClick={() => navigate(open.rfqs ? quoteLink(o.name) : toListing)}>{open.rfqs ? "Request a quote" : "Ask about this"}</Btn>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {b.service_tags?.length > 0 ? (
              <p className="flex flex-wrap gap-1.5">{b.service_tags.map((t) => <span key={t} className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">{t}</span>)}</p>
            ) : !b.offerings?.length && <p className="text-sm text-slate-500">Nothing listed yet.</p>}
          </Panel>

          <Panel title="How to work with us">
            {paused ? <p className="text-sm text-slate-600 dark:text-slate-300">Actions are paused while who manages this profile is reviewed.</p>
              : ways.length > 0 ? (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-ways>
                  {ways.map((w) => (
                    <li key={w.key} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                        <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={ICON[w.key]} /></svg>
                      </span>
                      <span className="min-w-[12rem] flex-1">
                        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{w.label}</span>
                        <span className="block text-[13px] text-slate-600 dark:text-slate-300">{w.line}</span>
                      </span>
                      <Btn className="!py-2 max-sm:w-full" aria-label={`${w.label}: start`} onClick={() => navigate(w.to)}>{w.label}</Btn>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-600 dark:text-slate-300">{b.claimed ? (b.activated ? "This business hasn't opened any ways to work with it yet." : "This business hasn't published its Marketplace profile yet.") : b.opportunity_note}</p>}
          </Panel>

          <div className="mt-auto px-1"><ReportBox slug={b.slug} via={via} /></div>
        </div>

        {/* On a tablet and a phone this sits straight under the header card; on a desktop it stays in view while the page scrolls. */}
        <aside className="order-first lg:order-none">
          <div className="space-y-4 lg:sticky lg:top-[88px]">
            {!b.claimed ? (
              <Panel title="Is this your business?">
                <p className="text-sm text-slate-700 dark:text-slate-200">Claim it to control this profile, publish your offerings, choose the opportunities you want and connect to EnterprateAI's business tools.</p>
                {b.claim?.eligible
                  ? <p className="mt-2 text-[12px] text-slate-500">Claiming is free. You'll be asked to show that you manage the business.</p>
                  : <p className="mt-2 text-[13px] text-slate-500">This profile can't be claimed right now.</p>}
              </Panel>
            ) : (
              <Panel title={open.rfqs ? `Get a quote from ${b.name}` : `Contact ${b.name}`} data-contact-card>
                {paused ? <p className="text-sm text-slate-600 dark:text-slate-300">Actions are paused while who manages this profile is reviewed.</p>
                  : !main ? <p className="text-sm text-slate-600 dark:text-slate-300">{b.activated ? "This business hasn't opened a way to contact it yet." : "This business hasn't published its Marketplace profile yet."}</p>
                    : (
                      <>
                        <p className="text-sm text-slate-600 dark:text-slate-300">{open.rfqs ? "Say what you need. The business replies with a price, and nothing is agreed until you accept it." : "Send a message and the business will reply."}</p>
                        <Btn kind="primary" className="mt-3 w-full !py-2.5" aria-label={`${main.label}: ${b.name}`} onClick={main.go}>{main.label}</Btn>
                      </>
                    )}
                {/* Shown only when the business chose this route and entered a public address or number. */}
                {!paused && b.contact?.email && <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">Email: <a href={`mailto:${b.contact.email}`} className="break-all font-semibold text-brand-600 hover:underline">{b.contact.email}</a></p>}
                {!paused && b.contact?.phone && <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">Phone: <a href={`tel:${b.contact.phone}`} className="font-semibold text-brand-600 hover:underline">{b.contact.phone}</a></p>}
              </Panel>
            )}
            <Panel title="About this badge" data-trust-card>
              <div className="space-y-2 text-[13px] text-slate-600 dark:text-slate-300"><TrustWords profile={b} /></div>
            </Panel>
          </div>
        </aside>
      </div>

      {sticky && (
        <div data-sticky-action className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm md:hidden dark:border-slate-800 dark:bg-slate-950/95">
          <Btn kind="primary" className="w-full !py-3" aria-label={`${main.label} (${b.name})`} onClick={main.go}>{main.label}</Btn>
        </div>
      )}
    </PublicFrame>
  );
}
