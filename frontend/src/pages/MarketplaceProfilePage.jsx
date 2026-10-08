import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { SkeletonBlock, SkeletonCard, SkeletonRegion } from "../components/Skeleton";
import { confirmDialog } from "../lib/dialog";
import PageHeader from "../components/PageHeader";
import { ActivationChecklist, OpportunityPreferences, ProfileSettings, TrustBadge, checklistItems } from "../components/marketplace/Directory";
import { Btn, Notice, Panel } from "../components/readiness/Fields";
import { activateMarketplaceProfile, answerPossibleDuplicate, directoryError, getMarketplaceProfile, myClaims, verifyOwnBusiness } from "../lib/directory";
import { useWorkspaceStore } from "../store/workspace";

// A business's own Marketplace settings: what the public sees, which offerings are shown and
// which opportunities it wants. The same screens the claim journey uses, available any time.
// A business that signed up directly can find and claim its indexed profile from here.

const SETUP_LABEL = { profile_review: "review your profile", preferences: "choose your opportunities", context: "confirm a few details" };
const NEXT_LABEL = { match: "Choose your business", verification: "Verify", pending_review: "Under review", profile_review: "Review your profile", preferences: "Set opportunities", context: "Finish" };

const CHIP = "whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold";

function Breadcrumb() {
  return (
    <nav aria-label="Breadcrumb" className="text-[13px] text-slate-500 dark:text-slate-400">
      <Link to="/marketplace" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">Marketplace</Link>
      <span aria-hidden="true" className="mx-1.5">/</span>
      <span aria-current="page">Your profile</span>
    </nav>
  );
}

/** The page's own shape while it loads: title, status card, verify card, tabs, then the form beside the checklist. Nothing moves when the data arrives. */
export function ProfileSkeleton() {
  return (
    <SkeletonRegion label="your Marketplace profile" className="space-y-4">
      <div><SkeletonBlock className="h-3.5 w-40 rounded" /><SkeletonBlock className="mt-3 h-8 w-64 rounded" /><SkeletonBlock className="mt-2 h-4 w-full max-w-md rounded" /></div>
      <SkeletonCard className="p-4 sm:p-5" data-skeleton-part="status">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2"><SkeletonBlock className="h-5 w-20 rounded-full" /><SkeletonBlock className="h-5 w-24 rounded-full" /><SkeletonBlock className="h-4 w-56 rounded" /></div>
          <div className="flex gap-2"><SkeletonBlock className="h-9 w-40 rounded-xl" /><SkeletonBlock className="h-9 w-28 rounded-xl" /></div>
        </div>
      </SkeletonCard>
      <SkeletonCard className="p-4 sm:p-5" data-skeleton-part="verify"><SkeletonBlock className="h-4 w-72 max-w-full rounded" /><SkeletonBlock className="mt-2 h-3 w-full max-w-xl rounded" /><SkeletonBlock className="mt-4 h-9 w-40 rounded-xl" /></SkeletonCard>
      <div className="flex gap-3 border-b border-slate-200 pb-2 dark:border-slate-800" data-skeleton-part="tabs"><SkeletonBlock className="h-5 w-36 rounded" /><SkeletonBlock className="h-5 w-28 rounded" /></div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-skeleton-part="grid">
        <SkeletonCard className="p-4 sm:p-5">
          <SkeletonBlock className="h-4 w-40 rounded" /><SkeletonBlock className="mt-2 h-24 w-full rounded-xl" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{Array.from({ length: 4 }, (_, n) => <div key={n}><SkeletonBlock className="h-3.5 w-32 rounded" /><SkeletonBlock className="mt-2 h-10 w-full rounded-xl" /></div>)}</div>
          <SkeletonBlock className="mt-5 h-9 w-32 rounded-xl" />
        </SkeletonCard>
        <SkeletonCard className="order-first p-4 sm:p-5 lg:order-none">
          <SkeletonBlock className="h-4 w-44 rounded" /><SkeletonBlock className="mt-3 h-2 w-full rounded-full" />
          <div className="mt-4 space-y-3">{Array.from({ length: 5 }, (_, n) => (
            <div key={n} data-skeleton-row className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2"><SkeletonBlock className="h-5 w-5 rounded-full" /><SkeletonBlock className="h-3.5 w-4/5 rounded" /><SkeletonBlock className="h-5 w-[58px] rounded-full" /></div>
          ))}</div>
        </SkeletonCard>
      </div>
    </SkeletonRegion>
  );
}

export default function MarketplaceProfilePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const current = useWorkspaceStore((s) => s.workspaceId);
  const businessId = params.get("business") || current;
  const tab = params.get("tab") === "opportunities" ? "opportunities" : "profile";
  const [profile, setProfile] = useState(null);
  const [problem, setProblem] = useState(null);
  const [done, setDone] = useState(null);          // what was just saved, published or unpublished, said in words
  const [claims, setClaims] = useState([]);
  const [busy, setBusy] = useState(null);          // "publish" | "unpublish" | "answer" while that request runs
  const [asking, setAsking] = useState(null);      // the existing profile the server asked about before publishing
  const [todo, setTodo] = useState(null);          // after a save: the checklist rows still to do before it can go live
  const [clash, setClash] = useState(null);        // another profile already uses this name: claim it, or verify this business, before publishing
  // Each read or change takes a number; only the latest one may update the page. A slow first
  // load can no longer land after a change and put the old state back.
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!businessId) return;
    const mine = ++latest.current;
    try { const fresh = await getMarketplaceProfile(businessId); if (mine === latest.current) { setProfile(fresh); setProblem(null); } }
    catch (e) { if (mine === latest.current) setProblem(directoryError(e, "Your Marketplace profile couldn't be loaded.")); }
  }, [businessId]);
  useEffect(() => { setProfile(null); setDone(null); setTodo(null); setAsking(null); setClash(null); load(); }, [load]);
  useEffect(() => { myClaims().then((r) => setClaims((r.items || []).filter((c) => !["done", "closed"].includes(c.next_step)))).catch(() => {}); }, [businessId]);

  // Profiles already in the directory that are likely this same business. The server works these
  // out and keeps the owner's "this isn't my business" answers, so they follow the business everywhere.
  const candidates = profile?.possible_duplicates || [];

  async function publish(on) {
    if (busy) return;
    if (!on && !(await confirmDialog("Your profile will no longer be shown on the Marketplace. Your profile, offerings and settings are kept, and you can publish it again at any time.",
      { title: "Unpublish your profile?", confirmLabel: "Unpublish", danger: true }))) return;
    // One business, one public profile: before making a second, the owner says whether the existing one is theirs.
    if (on && !profile.is_published && candidates.length) { setAsking(candidates[0]); return; }
    const mine = ++latest.current;
    setBusy(on ? "publish" : "unpublish");
    setDone(null);
    setTodo(null);
    setProblem(null);
    try {
      const fresh = await activateMarketplaceProfile(businessId, on);
      if (mine === latest.current) setProfile(fresh);
      setAsking(null);
      setClash(null);
      setDone(!on ? "Unpublished. Your profile is no longer shown on the Marketplace. Your settings are kept."
        : fresh.review_state === "pending_review" ? "Sent for review. Your profile will be public once it has been checked; you don't need to do anything else."
          : "Published. Your profile is now on the Marketplace.");
    } catch (e) {
      const p = directoryError(e, on ? "Your profile couldn't be published. Nothing was changed; try again." : "Your profile couldn't be unpublished. Nothing was changed; try again.");
      if (p.code === "possible_duplicate" && p.profile) setAsking(p.profile);      // the server found one this page didn't know about
      else if (p.code === "verification_required" && p.profile) setClash(p.profile);
      else setProblem(p.code === "invalid" ? { ...p, message: `Not published yet. ${Object.values(p.errors).join(" ")}` } : p);
    } finally { setBusy(null); }
  }

  /** "This isn't my business": kept with the business on the server. `thenPublish` carries on with the publish that asked. */
  async function notMine(candidate, thenPublish) {
    if (busy) return;
    const mine = ++latest.current;
    setBusy("answer");
    setProblem(null);
    try {
      let fresh = await answerPossibleDuplicate(businessId, candidate.id);
      let message = null;
      const still = fresh.possible_duplicates || [];
      if (thenPublish && still.length) { if (mine === latest.current) setProfile(fresh); setAsking(still[0]); return; }      // another likely match: ask about that one too
      if (thenPublish) {
        fresh = await activateMarketplaceProfile(businessId, true);
        message = "Published. Your profile is now on the Marketplace.";
      }
      if (mine === latest.current) setProfile(fresh);
      setAsking(null);
      setDone(message);
    } catch (e) {
      const p = directoryError(e, "That couldn't be saved. Nothing was changed; try again.");
      if (p.code === "possible_duplicate" && p.profile) setAsking(p.profile);
      else { setAsking(null); setProblem(p.code === "invalid" ? { ...p, message: `Not published yet. ${Object.values(p.errors).join(" ")}` } : p); }
    } finally { setBusy(null); }
  }

  /** "Verify your business": the same steps as a claim, on the profile this business made itself. */
  async function verify() {
    if (busy) return;
    setBusy("verify");
    setProblem(null);
    try { const claim = await verifyOwnBusiness(businessId); navigate(`/marketplace/claim/${claim.profile.slug}`); }
    catch (e) { setProblem(directoryError(e, "Verification couldn't be started. Please try again.")); setBusy(null); }
  }

  // A save always keeps what was typed. If the profile still can't go live, say so and say what is missing,
  // rather than "up to date" beside a button that stays greyed out.
  const saved = (message) => (fresh) => {
    latest.current += 1;
    const left = fresh.is_published ? [] : checklistItems(fresh.activation).filter((i) => !i.done);
    setProfile(fresh); setProblem(null); setDone(left.length ? null : message); setTodo(left.length ? left : null);
  };
  const setTab = (next) => { const p = new URLSearchParams(params); p.set("tab", next); setParams(p, { replace: true }); };
  /** "To do" on a checklist row: show the field it is about, and put the cursor in it. */
  const goToField = (key) => {
    setTab(key === "opportunity" ? "opportunities" : "profile");
    setTimeout(() => {
      const el = key === "opportunity" ? document.querySelector("[aria-label='Opportunity preferences'] input, [data-opportunities] input") : document.getElementById(`mp-field-${key}`) || document.querySelector("[aria-label='Public Marketplace profile']");
      if (!el) return;
      el.scrollIntoView?.({ behavior: "smooth", block: "center" });
      el.focus?.({ preventScroll: true });
    }, 60);
  };

  if (!businessId) return <ProfileSkeleton />;
  if (problem && !profile) {
    return <div className="space-y-3"><PageHeader title="Marketplace profile" /><Notice tone="rose" role="alert">{problem.code === "not_found" ? "The Marketplace profile isn't available for this business." : problem.message}</Notice></div>;
  }
  if (!profile) return <ProfileSkeleton />;

  const publicPage = profile.directory?.public && profile.directory.slug ? `/marketplace/business/${profile.directory.slug}` : null;
  const needed = checklistItems(profile.activation);      // the same rows the checklist shows
  const ready = needed.filter((i) => i.done).length;
  const hiddenNow = Boolean(profile.is_published) && ready < needed.length;      // published earlier, but it no longer passes: kept off the Marketplace
  const verified = profile.directory?.trust?.state === "verified" || profile.directory?.trust?.state === "disputed";
  return (
    <div className="space-y-4">
      {/* A claim that isn't finished: a slim bar at the very top, with the way back into it. */}
      {claims.map((c) => (
        <div key={c.id} role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {c.status === "verified"
            ? <span className="min-w-0">Finish setting up <span className="font-semibold">{c.profile.name}</span>: {SETUP_LABEL[c.next_step] || "a few steps are left"}.</span>
            : c.self_verify ? <span className="min-w-0">Verifying <span className="font-semibold">{c.profile.name}</span> isn't finished: {NEXT_LABEL[c.next_step] || "continue"}.</span>
              : <span className="min-w-0">Your claim on <span className="font-semibold">{c.profile.name}</span> isn't finished: {NEXT_LABEL[c.next_step] || "continue"}.</span>}
          <Btn className="!py-1.5 !text-[13px]" onClick={() => navigate(`/marketplace/claim/${c.profile.slug}`)}>Continue</Btn>
        </div>
      ))}

      {/* A challenge is being reviewed: say so first, because it explains why nothing can be changed. */}
      {profile.directory?.frozen && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="font-semibold">Someone has asked to review who manages this profile.</span> Public edits are paused while we check. Your public page stays as it is, and you don't need to do anything.
        </div>
      )}
      {profile.control_removed && (
        <Notice tone="amber" role="alert">
          <span className="font-semibold">Control of the {profile.control_removed.profile_name || "claimed"} profile was removed after a review,</span> so your Marketplace profile was unpublished.
          Your business and its records are unchanged. You can publish a profile of your own again when you're ready, or claim the profile again with evidence that you manage the business.
        </Notice>
      )}

      <div><Breadcrumb /><div className="mt-2"><PageHeader title="Marketplace profile" description="What the public sees about your business, and the opportunities you want to receive." /></div></div>

      {/* Status: how far the profile can be trusted, whether it is live, and the actions that change that. */}
      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between" data-status-card>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
            <span data-status-chip className={`${CHIP} ${hiddenNow ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100" : profile.is_published ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
              {hiddenNow ? "Hidden" : profile.is_published ? "Published" : profile.review_state === "pending_review" ? "Waiting for review" : "Draft"}
            </span>
            {verified ? <TrustBadge trust={profile.directory.trust} />
              : <span data-verification-chip className={`${CHIP} border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300`}>Not verified</span>}
            <p className="min-w-0 text-[13px] text-slate-600 dark:text-slate-300">
              <a href="#marketplace-checklist" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">{ready} of {needed.length} ready</a>
              {hiddenNow ? ", not shown on the Marketplace until the checklist is finished" : ready < needed.length ? ", finish the checklist to publish" : profile.is_published ? ", your profile is live" : ", you can publish now"}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            {publicPage && <Btn className="max-sm:w-full" onClick={() => window.open(publicPage, "_blank", "noopener")}>Preview public profile</Btn>}
            {profile.can_edit && (profile.is_published
              ? <Btn className="max-sm:w-full" disabled={Boolean(busy) || Boolean(profile.directory?.frozen)} onClick={() => publish(false)}>{busy === "unpublish" ? "Unpublishing…" : "Unpublish"}</Btn>
              : <Btn kind="primary" className="max-sm:w-full" disabled={Boolean(busy) || !profile.activation.ready || Boolean(profile.directory?.frozen)} onClick={() => publish(true)}
                  title={!profile.activation.ready ? `Still needed: ${needed.filter((i) => !i.done).map((i) => i.label).join("; ")}` : undefined}>{busy === "publish" ? "Publishing…" : "Activate Marketplace Profile"}</Btn>)}
          </div>
        </div>
        {!profile.is_published && profile.directory?.origin === "indexed" && <p className="mt-2 text-[12px] text-slate-500">The public page shows the details from public sources until you activate.</p>}
      </Panel>

      {profile.listing_suppressed && (
        <Notice tone="rose" role="alert">
          <span className="font-semibold">Your Marketplace profile was taken down after a review.</span> Reason: {profile.listing_suppressed.reason}{" "}
          Change what's needed below and activate it again. It will be checked before it goes back on the Marketplace.
        </Notice>
      )}
      {profile.review_state === "pending_review" && !profile.listing_suppressed && (
        <Notice>Your profile is waiting for a quick review before it goes public. You can keep editing it, or preview it, in the meantime.</Notice>
      )}

      {clash && (
        <Notice tone="amber" role="alert">
          <p className="font-semibold">Another Marketplace profile already uses this name.</p>
          <p className="mt-1"><span className="font-semibold">{clash.name}</span>{clash.location ? `, ${clash.location}` : ""} is {clash.claimed ? "a verified business" : "already in the directory"}. To protect businesses from being impersonated, yours can't be published under the same name until it is verified.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {!clash.claimed && <Btn kind="primary" onClick={() => navigate(`/marketplace/claim/${clash.slug}?source=signup_match&business=${businessId}`)}>That's my business: claim it</Btn>}
            <Btn kind={clash.claimed ? "primary" : "secondary"} disabled={Boolean(busy)} onClick={verify}>{busy === "verify" ? "Starting…" : "Verify my business"}</Btn>
            <Btn kind="link" onClick={() => setClash(null)}>Not now</Btn>
          </div>
        </Notice>
      )}

      {asking && (
        <Notice tone="amber" role="alert">
          <p className="font-semibold">Before you publish: is this your business?</p>
          <p className="mt-1">The Marketplace already has a profile for <span className="font-semibold">{asking.name}</span>{asking.location ? `, ${asking.location}` : ""}{asking.matched_on ? ` (matched on its ${asking.matched_on})` : ""}. Publishing now would give the same business two public profiles.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind="primary" onClick={() => navigate(`/marketplace/claim/${asking.slug}?source=signup_match`)}>Claim and link it</Btn>
            <Btn disabled={Boolean(busy)} onClick={() => notMine(asking, true)}>{busy === "answer" ? "Saving…" : "This isn't my business"}</Btn>
            <Btn kind="link" onClick={() => setAsking(null)}>Not now</Btn>
          </div>
        </Notice>
      )}

      {done && !problem && <Notice tone="emerald">{done}</Notice>}
      {todo && !problem && (
        <Notice tone="amber" role="alert">
          <p className="font-semibold">Saved, but your profile can't go live yet. {todo.length === 1 ? "One thing is" : `${todo.length} things are`} still needed:</p>
          <ul className="mt-1 list-disc pl-5">
            {todo.map((i) => (
              <li key={i.key}>{i.fix || i.label}
                {i.key === "opportunity" && tab !== "opportunities" && <Btn kind="link" className="ml-2" onClick={() => setTab("opportunities")}>Open Opportunities</Btn>}
                {i.key !== "opportunity" && tab !== "profile" && <Btn kind="link" className="ml-2" onClick={() => setTab("profile")}>Open Profile and offerings</Btn>}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {problem && <Notice tone={problem.code === "entitlement" ? "amber" : "rose"} role="alert">{problem.message}{problem.code === "entitlement" && <Btn kind="link" className="ml-2" onClick={() => navigate("/pricing")}>See plans</Btn>}</Notice>}

      {!asking && candidates.map((f) => (
        <Notice key={f.id} tone="emerald">
          We found an existing Marketplace profile that may be your business: <span className="font-semibold">{f.name}</span>{f.location ? `, ${f.location}` : ""} (matched on its {f.matched_on}).
          Verify to link it instead of creating a duplicate.
          <Btn kind="link" className="ml-2" onClick={() => navigate(`/marketplace/claim/${f.slug}?source=signup_match`)}>Claim and link it</Btn>
          {profile.can_edit && <Btn kind="link" className="ml-2 !text-slate-600" disabled={Boolean(busy)} onClick={() => notMine(f, false)}>This isn't my business</Btn>}
        </Notice>
      ))}

      {profile.can_edit && profile.directory?.origin === "created" && profile.directory.trust.state === "created" && !clash && (
        <Panel title="Verify your business to earn the Owner-verified badge" description="Show that you manage this business, by a code sent to an email address at your website or by sending a document. It takes a few minutes.">
          <Btn disabled={Boolean(busy)} onClick={verify}>{busy === "verify" ? "Starting…" : "Verify your business"}</Btn>
        </Panel>
      )}

      <div role="tablist" aria-label="Marketplace profile sections" className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {[["profile", "Profile and offerings"], ["opportunities", "Opportunities"]].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === key ? "border-brand-600 text-brand-700 dark:text-brand-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          {tab === "profile"
            ? <ProfileSettings key={`p-${profile.profile.revision}`} profile={profile} preview={false} flag={todo ? todo.map((i) => i.key) : null} onSaved={saved("Saved. Your profile is up to date.")} />
            : <OpportunityPreferences key={`o-${profile.preferences.version}`} profile={profile} onSaved={saved("Saved. Your opportunity settings are up to date.")} />}
        </Panel>
        {/* Beside the form from 1024px; above it, folded away, on anything narrower. */}
        <div className="order-first lg:order-none"><div className="lg:sticky lg:top-[88px]"><ActivationChecklist activation={profile.activation} onTodo={profile.can_edit ? goToField : undefined} collapsible /></div></div>
      </div>
    </div>
  );
}
