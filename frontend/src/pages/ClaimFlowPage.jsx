import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ActivationChecklist, OpportunityPreferences, ProfileSettings, TrustBadge } from "../components/marketplace/Directory";
import { Btn, Notice, Panel, inputClass } from "../components/readiness/Fields";
import { getDashboard, saveDashboardPreferences, saveDashboardStage } from "../lib/dashboard";
import {
  attachClaimEvidence, cancelClaim, claimContext, completeHandoff, completeVerification, confirmMatch, createClaimIntent, directoryError, forgetClaimContext,
  getBusinessProfile, getClaim, getMarketplaceProfile, myClaims, profileAccess, rememberClaimContext, startClaim, startVerification,
} from "../lib/directory";
import { dateLabel } from "../lib/readiness";
import { confirmDialog } from "../lib/dialog";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";
import { Initials } from "../components/marketplace/MarketplaceHeader";
import { PublicFrame } from "./DirectoryProfilePage";

// The claim journey (W03 to W11): introduction, sign-in with the claim kept, which business
// the profile belongs to, verification, review, profile, opportunities, a short confirmation
// of context, and on to the ordinary dashboard. It asks only for what it doesn't already know.

const STEPS = [["match", "Your business"], ["verification", "Verify"], ["profile_review", "Profile"], ["preferences", "Opportunities"], ["context", "Finish"]];
const STEP_OF = { match: 0, verification: 1, pending_review: 1, profile_review: 2, preferences: 3, context: 4, done: 4 };

function Progress({ step }) {
  const at = STEP_OF[step] ?? 0;
  return (
    <nav aria-label="Claim progress">
      <div className="sm:hidden">
        <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Step {at + 1} of {STEPS.length} · {STEPS[at][1]}</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full rounded-full bg-brand-600" style={{ width: `${((at + 1) / STEPS.length) * 100}%` }} /></div>
      </div>
      <ol className="hidden items-start sm:flex">
        {STEPS.map(([key, label], i) => (
          <li key={key} aria-current={i === at ? "step" : undefined} className={`flex items-start ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
            <span className="flex w-[88px] shrink-0 flex-col items-center gap-1.5">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold ${i < at ? "bg-emerald-500 text-white" : i === at ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-900"}`}>
                {i < at ? <span aria-hidden="true">✓</span> : i + 1}
              </span>
              <span className={`text-center text-[12px] font-semibold ${i === at ? "text-brand-700 dark:text-brand-300" : i < at ? "text-slate-700 dark:text-slate-200" : "text-slate-500"}`}>{label}{i < at ? <span className="sr-only"> (done)</span> : null}</span>
            </span>
            {i < STEPS.length - 1 && <span aria-hidden="true" className={`-mx-7 mt-4 h-0.5 flex-1 ${i < at ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-700"}`} />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// Every step ends with the same row: a quiet "Cancel this claim" on the left (while the claim
// can still be cancelled) and the step's main button on the right.
const FooterLeft = createContext(null);
function Footer({ children }) {
  const left = useContext(FooterLeft);
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
      <span>{left}</span>
      <span className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</span>
    </div>
  );
}

function Teaser({ opportunity }) {
  if (!opportunity) return null;
  return (
    <Notice tone={opportunity.available ? "emerald" : "slate"}>
      <span className="font-semibold">{opportunity.text}</span>{opportunity.note ? ` ${opportunity.note}` : ""}
    </Notice>
  );
}

// ── W03 ───────────────────────────────────────────────────────────────────────
function Intro({ profile, opportunity, signedIn, busy, onContinue, onSignIn }) {
  return (
    <Panel>
      <div className="flex items-center gap-3">
        <Initials name={profile.name} size={40} />
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold leading-tight text-slate-900 dark:text-slate-100">Claim {profile.name}</h1>
          <div className="mt-1"><TrustBadge trust={profile.trust} /></div>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Why claim it</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
            <li>Control what your profile says</li><li>Confirm your services and offerings</li><li>Receive the enquiries, quote requests and proposals you choose</li><li>Use EnterprateAI's business tools for the same business</li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">What happens next</h2>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
            <li>Sign in or create an account</li><li>Show that you manage the business</li><li>Review your profile</li><li>Choose your opportunities</li>
          </ol>
        </div>
      </div>
      <p className="mt-4 text-[13px] text-slate-500">Claiming confirms that you have the authority to manage this Marketplace profile. It does not verify the quality of the business or its financial health.</p>
      <div className="mt-3"><Teaser opportunity={opportunity} /></div>
      <Footer>
        {signedIn ? <Btn kind="primary" disabled={busy} onClick={onContinue}>{busy ? "Starting…" : "Continue to Claim"}</Btn> : (
          <>
            <Btn disabled={busy} onClick={() => onSignIn(false)}>I already have an account</Btn>
            <Btn kind="primary" disabled={busy} onClick={() => onSignIn(true)}>Create a free account to claim</Btn>
          </>
        )}
      </Footer>
    </Panel>
  );
}

// ── W05 ───────────────────────────────────────────────────────────────────────
function Match({ claim, onDone, setProblem }) {
  const likely = (claim.candidates || []).find((c) => c.likely_match && !c.already_linked);
  const [choice, setChoice] = useState(likely ? likely.business_id : (claim.candidates || []).length ? "" : "new");
  const [busy, setBusy] = useState(false);
  async function confirmBusiness() {
    setBusy(true);
    try { onDone(await confirmMatch(claim.id, choice)); } catch (e) { setProblem(directoryError(e)); } finally { setBusy(false); }
  }
  return (
    <Panel title="Which EnterprateAI business should this profile belong to?" description="One business has one profile. Choosing the right one now avoids a duplicate.">
      <fieldset className="space-y-2">
        <legend className="sr-only">Choose a business</legend>
        {(claim.candidates || []).map((c) => (
          <label key={c.business_id} className={`flex items-start gap-3 rounded-xl border p-3 ${c.already_linked ? "border-slate-200 opacity-60 dark:border-slate-700" : "border-slate-200 dark:border-slate-700"}`}>
            <input type="radio" name="business" className="mt-1" disabled={c.already_linked} checked={choice === c.business_id} onChange={() => setChoice(c.business_id)} />
            <span>
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{c.name}{c.likely_match ? " · likely the same business" : ""}</span>
              <span className="block text-[12px] text-slate-500">{c.already_linked ? "Already has a Marketplace profile" : c.location || "One of your businesses"}</span>
            </span>
          </label>
        ))}
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <input type="radio" name="business" className="mt-1" checked={choice === "new"} onChange={() => setChoice("new")} />
          <span>
            <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{(claim.candidates || []).length ? "None of these" : `Set up ${claim.profile.name} on EnterprateAI`}</span>
            <span className="block text-[12px] text-slate-500">A business is created for {claim.profile.name} once you're verified, with what we already know filled in.</span>
          </span>
        </label>
      </fieldset>
      <Footer><Btn kind="primary" disabled={!choice || busy} onClick={confirmBusiness}>{busy ? "Saving…" : "Confirm Business"}</Btn></Footer>
    </Panel>
  );
}

// ── W06 ───────────────────────────────────────────────────────────────────────
function Verification({ claim, onDone, setProblem }) {
  const methods = claim.methods || [];
  const v = claim.verification;
  const awaitingCode = v?.method === "email_domain" && v.status === "sent";
  const [method, setMethod] = useState(awaitingCode ? "email_domain" : methods[0]?.method);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const run = async (fn) => {
    setBusy(true); setErrors({}); setProblem(null);
    try { onDone(await fn()); } catch (e) { const p = directoryError(e); if (Object.keys(p.errors || {}).length) setErrors(p.errors); else setProblem(p); } finally { setBusy(false); }
  };
  const err = (k) => errors[k] && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{errors[k]}</span>;
  const chosen = methods.find((m) => m.method === method);
  const sendCode = () => run(() => startVerification(claim.id, { method: "email_domain", email }));
  return (
    <Panel title={`Verify that you manage ${claim.profile.name}`}
      description="We ask for this so that only someone with authority can change a business's profile. Nothing private is shown until it is done.">
      <p className="text-[13px] text-slate-600 dark:text-slate-300">{claim.profile.name}{claim.profile.legal_identifier ? ` · registered number ${claim.profile.legal_identifier}` : ""}</p>
      <fieldset className="mt-3 space-y-2">
        <legend className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Choose how to verify</legend>
        {methods.map((m) => (
          <label key={m.method} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <input type="radio" name="method" className="mt-1" checked={method === m.method} onChange={() => setMethod(m.method)} />
            <span><span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{m.label}</span><span className="block text-[12px] text-slate-500">{m.help}</span></span>
          </label>
        ))}
      </fieldset>
      {err("method")}

      {chosen?.method === "email_domain" && (
        <div className="mt-4 space-y-3">
          <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Your email address at {claim.profile.domain}
            <input type="email" className={`mt-1 ${inputClass}`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`you@${claim.profile.domain}`} />
          </label>
          {err("email")}
          {awaitingCode && <Btn disabled={busy || !email} onClick={sendCode}>Send a new code</Btn>}
          {awaitingCode && (
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[13px] text-slate-600 dark:text-slate-300">We sent a 6-digit code to {v.destination}. It works for 30 minutes.{v.attempts_left !== null ? ` Attempts left: ${v.attempts_left}.` : ""}</p>
              <label className="mt-2 block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Code
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`mt-1 ${inputClass} tracking-[0.4em]`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              </label>
              {err("code")}
            </div>
          )}
        </div>
      )}

      {chosen?.method === "manual" && (
        <div className="mt-4 space-y-3">
          <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">How are you connected to this business?
            <textarea rows={3} className={`mt-1 ${inputClass}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: I am a director. The certificate of incorporation is attached." />
          </label>
          {err("note")}
          <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">A document that shows it (optional)
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="mt-1 block w-full text-[13px]" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <span className="mt-0.5 block text-[12px] font-normal text-slate-500">PDF or image, up to 10 MB. Only the people who review claims can see it.</span>
          </label>
          {err("file")}
        </div>
      )}
      <p className="mt-4 text-[12px] text-slate-500">If one way doesn't work, choose the other. Your claim is kept either way.</p>
      <Footer>
        {chosen?.method === "manual" && (
          <Btn kind="primary" disabled={busy} onClick={() => run(async () => {
            const started = await startVerification(claim.id, { method: "manual", note });
            return file ? attachClaimEvidence(claim.id, started.verification.id, file) : started;
          })}>{busy ? "Sending…" : "Send for review"}</Btn>
        )}
        {chosen?.method === "email_domain" && !awaitingCode && <Btn kind="primary" disabled={busy || !email} onClick={sendCode}>{busy ? "Sending…" : "Send me a code"}</Btn>}
        {chosen?.method === "email_domain" && awaitingCode && (
          <Btn kind="primary" disabled={busy || code.length !== 6} onClick={() => run(() => completeVerification(claim.id, v.id, code))}>{busy ? "Checking…" : "Verify and Continue"}</Btn>
        )}
      </Footer>
    </Panel>
  );
}

// ── W07 ───────────────────────────────────────────────────────────────────────
function Pending({ claim }) {
  const navigate = useNavigate();
  return (
    <Panel title={claim.status === "disputed" ? "Your claim is being reviewed against the current holder" : "Claim under review"}>
      <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
        <div><dt className="font-semibold text-slate-700 dark:text-slate-200">Reference</dt><dd className="break-all text-slate-600 dark:text-slate-300">{claim.id}</dd></div>
        <div><dt className="font-semibold text-slate-700 dark:text-slate-200">Submitted</dt><dd className="text-slate-600 dark:text-slate-300">{claim.verification?.method === "manual" ? "Evidence for review" : "Email code confirmed"} · {dateLabel(claim.verification?.submitted_at)}</dd></div>
      </dl>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">What you can do</h3>
          <ul className="mt-1 list-disc pl-5 text-[13px] text-slate-600 dark:text-slate-300"><li>Come back to this page at any time</li><li>Add evidence if we ask for it</li><li>Cancel the claim</li></ul></div>
        <div><h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">What waits until it's approved</h3>
          <ul className="mt-1 list-disc pl-5 text-[13px] text-slate-600 dark:text-slate-300"><li>Editing the public profile</li><li>Seeing restricted opportunities</li><li>Anything belonging to the business</li></ul></div>
      </div>
      <Footer><Btn kind="primary" onClick={() => navigate("/marketplace?tab=businesses")}>Return to Marketplace</Btn></Footer>
    </Panel>
  );
}

// ── W10 ───────────────────────────────────────────────────────────────────────
function Context({ claim, onFinished, setProblem }) {
  const [dash, setDash] = useState(null);
  const [stage, setStage] = useState("");
  const [trading, setTrading] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    getDashboard(claim.business_id).then((d) => { if (live && d?.enabled) { setDash(d); setStage(d.context.business_stage); setGoal(d.context.current_goal || ""); } }).catch(() => live && setDash({ enabled: false }));
    return () => { live = false; };
  }, [claim.business_id]);
  const ctx = dash?.context;
  const hint = trading === "yes" && ["idea", "pre_launch"].includes(stage) ? "You have customers or revenue, so “Operating” may describe you better. You can change this at any time."
    : trading === "no" && ["operating", "growth"].includes(stage) ? "Without customers or revenue yet, “Pre-launch” may describe you better. You can change this at any time." : null;

  async function finish() {
    setBusy(true);
    try {
      // The dashboard's own settings decide what it shows. This only records the answers there.
      if (ctx && stage && stage !== ctx.business_stage) await saveDashboardStage(claim.business_id, stage);
      if (ctx && goal !== (ctx.current_goal || "")) await saveDashboardPreferences(claim.business_id, goal ? { current_goal: goal } : { clear_goal: true });
      onFinished(await completeHandoff(claim.id));
    } catch (e) { setProblem(directoryError(e)); } finally { setBusy(false); }
  }
  return (
    <Panel title="One last check before your dashboard" description="We only ask what we couldn't work out. Nothing here creates another business.">
      <Notice><span className="font-semibold">{claim.profile.name}</span>{claim.profile.location ? ` · ${claim.profile.location}` : ""}{claim.profile.category ? ` · ${claim.profile.category}` : ""}. If any of this is wrong, you can correct it on your profile.</Notice>
      {!dash ? <p role="status" className="mt-3 text-sm text-slate-500">Loading…</p> : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Where is the business now?
            <select className={`mt-1 ${inputClass}`} value={stage} onChange={(e) => setStage(e.target.value)} disabled={!ctx}>
              {(ctx?.stages || []).map((s) => <option key={s.key} value={s.key}>{s.label}{s.key === ctx.detected_stage ? " (from your records)" : ""}</option>)}
            </select>
          </label>
          <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Do you currently have customers or revenue?
            <select className={`mt-1 ${inputClass}`} value={trading} onChange={(e) => setTrading(e.target.value)}>
              <option value="">Prefer not to say</option><option value="yes">Yes</option><option value="no">Not yet</option>
            </select>
          </label>
          <label className="block text-[13px] font-semibold text-slate-800 sm:col-span-2 dark:text-slate-100">What matters most right now? (optional)
            <select className={`mt-1 ${inputClass}`} value={goal} onChange={(e) => setGoal(e.target.value)} disabled={!ctx}>
              <option value="">No goal set</option>
              {(ctx?.goals || []).map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </label>
        </div>
      )}
      {hint && <p className="mt-2 text-[13px] text-amber-700 dark:text-amber-300">{hint}</p>}
      <p className="mt-3 text-[12px] text-slate-500">You'll land on your normal EnterprateAI dashboard. Marketplace stays in the menu, and enquiries, quotes and invoices live in Business Operations.</p>
      <Footer><Btn kind="primary" disabled={busy || !dash} onClick={finish}>{busy ? "Opening…" : "Go to My Dashboard"}</Btn></Footer>
    </Panel>
  );
}

// Already claimed and verified by this person's business: nothing to claim, so say so and point to where it is managed.
function Manages({ name, businessId, onDashboard }) {
  const navigate = useNavigate();
  return (
    <Panel title="You manage this business">
      <p className="text-sm text-slate-700 dark:text-slate-200">{name} is already claimed and verified for your business. There is nothing more to claim.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn kind="primary" onClick={() => navigate(`/marketplace/profile${businessId ? `?business=${businessId}` : ""}`)}>Open Marketplace profile</Btn>
        <Btn onClick={onDashboard}>Go to My Dashboard</Btn>
      </div>
    </Panel>
  );
}

// Held by another business: not an ordinary claim. A challenge is possible and a person decides it.
function AlreadyClaimed({ profile, signedIn, busy, onChallenge, onSignIn }) {
  const navigate = useNavigate();
  return (
    <Panel title="Already claimed">
      <div className="mb-2"><TrustBadge trust={profile.trust} /></div>
      <p className="text-sm text-slate-700 dark:text-slate-200">{profile.name} is already managed by a business on EnterprateAI.</p>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">If you have the authority to manage it and believe this is wrong, you can ask for a review. You'll be asked to show that you manage the business, and a person decides. The current profile stays as it is until then.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {signedIn
          ? <Btn disabled={busy} onClick={onChallenge}>{busy ? "Starting…" : "Ask for a review"}</Btn>
          : <Btn disabled={busy} onClick={() => onSignIn(false)}>Sign in to ask for a review</Btn>}
        <Btn kind="primary" onClick={() => navigate(`/marketplace/business/${profile.canonical_slug || profile.slug}`)}>Back to the profile</Btn>
      </div>
    </Panel>
  );
}

export default function ClaimFlowPage() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const hydrated = useAuthStore((s) => s.hydrated);
  const [profile, setProfile] = useState(null);
  const [claim, setClaim] = useState(null);
  const [settings, setSettings] = useState(null);
  const [opportunity, setOpportunity] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(false);      // whether we've looked for a claim this person already has on this profile
  const intent = params.get("intent") || (claimContext()?.slug === slug ? claimContext().intent : null);
  // What opens the profile when unclaimed profiles aren't public (an invitation, an exact-match lookup, or the claim already started).
  const via = { ...profileAccess(slug, params), intent: intent || null };
  const invite = via.invite;

  const begin = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      let started = await startClaim(slug, { intent, access: via.access, invitation: via.invite, opportunity_ref: params.get("opportunity") || null, source: params.get("source") || null });
      // Sent here from setting up a business ("Claim and link it"): that business is the one to link, so go straight on to verification.
      const business = params.get("business");
      if (business && started.next_step === "match" && (started.candidates || []).some((c) => c.business_id === business && !c.already_linked)) started = await confirmMatch(started.id, business);
      setClaim(started);
      forgetClaimContext();
      if (params.get("intent")) { const p = new URLSearchParams(params); p.delete("intent"); setParams(p, { replace: true }); }
    } catch (e) {
      setProblem(directoryError(e, "Your claim couldn't be started. Please try again."));
    } finally {
      setBusy(false);
    }
  }, [slug, intent]);      // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    setLoading(true);
    getBusinessProfile(slug, via).then((p) => live && setProfile(p)).catch((e) => live && setProblem(directoryError(e, "This profile couldn't be loaded."))).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [slug]);

  // Signed in and opening the claim address directly: carry on with the claim they already have, at its next step.
  useEffect(() => {
    if (!hydrated || !profile) return undefined;
    if (!token || intent) { setChecked(true); return undefined; }
    let live = true;
    myClaims()
      .then((r) => { const mine = (r.items || []).find((c) => c.profile?.id === profile.id && c.next_step !== "closed"); if (live && mine) setClaim((now) => now || mine); })
      .catch(() => {})
      .finally(() => live && setChecked(true));
    return () => { live = false; };
  }, [hydrated, token, intent, profile?.id]);      // eslint-disable-line react-hooks/exhaustive-deps

  // An invitation link: say only that a relevant request exists, if one really does.
  useEffect(() => {
    if (!invite || token) return;
    createClaimIntent(slug, { invitation: invite }).then((r) => { setOpportunity(r.opportunity); rememberClaimContext({ slug, name: r.profile.name, intent: r.intent }); }).catch(() => {});
  }, [invite, slug, token]);

  // Back from sign-in with the claim kept: carry straight on at the next step.
  useEffect(() => { if (hydrated && token && intent && !claim && !busy && !problem) begin(); }, [hydrated, token, intent]);      // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (claim?.status === "verified" && claim.business_id) getMarketplaceProfile(claim.business_id).then(setSettings).catch((e) => setProblem(directoryError(e)));
  }, [claim?.status, claim?.business_id]);

  async function signIn(signup) {
    setBusy(true);
    try {
      const made = claimContext()?.slug === slug && claimContext().intent ? { intent: claimContext().intent, profile } : await createClaimIntent(slug, { source: params.get("source") || "marketplace_profile", opportunity_ref: params.get("opportunity") || null, invitation: invite || null, access: via.access });
      rememberClaimContext({ slug, name: profile.name, intent: made.intent });
      const next = `/marketplace/claim/${slug}?intent=${encodeURIComponent(made.intent)}`;
      navigate(`/login?${signup ? "signup=1&" : ""}next=${encodeURIComponent(next)}`);
    } catch (e) { setProblem(directoryError(e)); setBusy(false); }
  }

  async function cancel() {
    if (!(await confirmDialog("Your claim will be closed. You can start again at any time.", { title: "Cancel this claim?", confirmLabel: "Cancel claim", cancelLabel: "Keep it", danger: true }))) return;
    try { setClaim(await cancelClaim(claim.id)); } catch (e) { setProblem(directoryError(e)); }
  }

  function finished(result) {
    // The claimed business becomes the one in view, in the ordinary dashboard.
    useWorkspaceStore.getState().setWorkspaceId(result.business_id);
    useWorkspaceStore.getState().setWorkspaceName(profile?.name || null);
    navigate(result.to || "/dashboard");
  }

  if (loading || !hydrated || (profile && !checked && !claim)) return <PublicFrame><p role="status" className="text-sm text-slate-500">Loading…</p></PublicFrame>;
  if (!profile) {
    return <PublicFrame><Notice tone="slate" role="alert">{problem?.message || "This business profile isn't available."}</Notice><Btn className="mt-3" onClick={() => navigate("/marketplace?tab=businesses")}>Back to the business directory</Btn></PublicFrame>;
  }
  const step = claim?.next_step;
  const manages = (claim && step === "done") || (!claim && profile.owner_controls);
  const heldByAnother = !claim && !manages && profile.claimed;
  const cancelLink = claim?.can?.cancel ? <Btn kind="link" className="text-[13px] !font-medium !text-slate-500" onClick={cancel}>Cancel this claim</Btn> : null;
  return (
    <PublicFrame>
      <FooterLeft.Provider value={cancelLink}>
      <div className="mx-auto max-w-[680px] space-y-4">
        {!manages && !heldByAnother && (claim || !token) && (
          <p className="flex items-center gap-3 rounded-2xl bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">
            <Initials name={profile.name} size={32} className="!bg-white dark:!bg-brand-900" />
            <span className="min-w-0 break-words">{claim?.self_verify ? "You are verifying" : "You are claiming"}: {profile.name}</span>
          </p>
        )}
        {claim && step !== "closed" && step !== "done" && <Progress step={step} />}
        {problem && (
          <Notice tone={problem.code === "already_yours" ? "emerald" : "rose"} role="alert">
            {problem.message}
            {problem.code === "already_yours" && <Btn kind="link" className="ml-2" onClick={() => navigate(`/marketplace/profile?business=${problem.business_id}`)}>Manage the profile</Btn>}
            {problem.code === "signed_out" && <Btn kind="link" className="ml-2" onClick={() => signIn(false)}>Sign in</Btn>}
          </Notice>
        )}
        {claim?.notice && step !== "closed" && <Notice tone="amber">{claim.notice}</Notice>}
        {claim?.opportunity && step !== "closed" && <Teaser opportunity={claim.opportunity} />}

        {manages && <Manages name={profile.name} businessId={claim?.business_id || profile.business_id}
          onDashboard={() => finished({ business_id: claim?.business_id || profile.business_id, to: "/dashboard" })} />}
        {heldByAnother && <AlreadyClaimed profile={profile} signedIn={Boolean(token)} busy={busy} onChallenge={begin} onSignIn={signIn} />}
        {!claim && !manages && !heldByAnother && <Intro profile={profile} opportunity={opportunity} signedIn={Boolean(token)} busy={busy} onContinue={begin} onSignIn={signIn} />}
        {claim && step === "match" && <Match claim={claim} onDone={setClaim} setProblem={setProblem} />}
        {claim && step === "verification" && <Verification claim={claim} onDone={(c) => { setProblem(null); setClaim(c); }} setProblem={setProblem} />}
        {claim && step === "pending_review" && <Pending claim={claim} />}
        {claim && step === "closed" && (
          <Panel title={claim.status === "cancelled" ? "This claim was cancelled" : claim.status === "revoked" ? "Control of this profile was removed" : "We couldn't confirm this claim"}>
            <p className="text-sm text-slate-700 dark:text-slate-200">{claim.reason || "You can start again at any time."}</p>
            <div className="mt-3 flex gap-2"><Btn kind="primary" onClick={() => { setClaim(null); setProblem(null); }}>Start again</Btn><Btn onClick={() => navigate(`/marketplace/business/${slug}`)}>Back to the profile</Btn></div>
          </Panel>
        )}

        {claim?.status === "verified" && !settings && <p role="status" className="text-sm text-slate-500">Loading your profile…</p>}
        {claim && step === "profile_review" && settings && (
          <Panel title={`You now manage ${profile.name} on EnterprateAI`} description="Check what the public will see. You can change any of this later.">
            <ProfileSettings profile={settings} claimId={claim.id} saveLabel="Save & Set Opportunity Preferences" footerLeft={cancelLink || <span />}
              onSaved={async (saved) => { setSettings(saved); setClaim(await getClaim(claim.id)); }} />
          </Panel>
        )}
        {claim && step === "preferences" && settings && (
          <>
            <Panel title="Which opportunities do you want?" description="Only what you switch on is offered on your profile. You can change these at any time.">
              <OpportunityPreferences profile={settings} claimId={claim.id} saveLabel="Activate Marketplace Profile" activateOnSave footerLeft={cancelLink || <span />}
                onSaved={async (saved) => { setSettings(saved); setClaim(await getClaim(claim.id)); }} />
            </Panel>
            <ActivationChecklist activation={settings.activation} />
          </>
        )}
        {claim && step === "context" && (
          <>
            {settings && !settings.is_published && <Notice tone="amber">Your claim is complete and your settings are saved. Your profile isn't published yet: finish the items under Marketplace profile when you're ready.</Notice>}
            <Context claim={claim} onFinished={finished} setProblem={setProblem} />
          </>
        )}

        {/* Steps without a footer of their own (a closed claim) still offer the way out. */}
        {cancelLink && step === "closed" && <p>{cancelLink}</p>}
      </div>
      </FooterLeft.Provider>
    </PublicFrame>
  );
}
