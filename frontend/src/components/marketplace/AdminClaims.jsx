import { useCallback, useEffect, useState } from "react";
import { AdminTable, Chip, KpiTile } from "../admin/AdminUI";
import AddBusinesses, { EditBusinessForm, VISIBILITY_OPTION } from "./AddBusiness";
import { Btn, Notice, Panel, inputClass } from "../readiness/Fields";
import {
  createInvitation, decideClaim, directoryError, downloadClaimEvidence, getClaimQueue, getDecisions, getFunnel, getProfileSources, restoreClaimWorkspace, getUnclaimedProfiles, getVisibility, getWaitingRequests, indexRecords, moderateProfile, getProfileRfps, publishProfileRfp, closeProfileRfp, setHeldProposals,
  normaliseLocations, addTeamMember, getTeam, removeTeamMember, resolveReport, reviewListing, setProfileVisibility, setVisibility,
} from "../../lib/directory";
import { dateLabel } from "../../lib/readiness";

// Marketplace moderation: the directory at a glance, then one tab each for the review queue,
// unclaimed profiles, reports, who can see unclaimed profiles, and adding records and claim
// links. Every decision needs a reason, which is kept.

export const MARKETPLACE_TABS = [["index", "Index & invites"], ["queue", "Queue"], ["decided", "Approved & rejected"], ["unclaimed", "Unclaimed profiles"], ["reports", "Reports"], ["visibility", "Visibility"]];

/** The evidence and the decision for one claim, opened under its row. */
function ClaimReview({ claim, onDone }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState({});
  async function decide(decision) {
    setState({ busy: true });
    try { await decideClaim(claim.id, decision, reason); onDone(); } catch (e) { setState({ problem: directoryError(e).message }); }
  }
  return (
    <div className="space-y-2">
      {claim.evidence.length === 0 && <p className="text-[13px] text-slate-500">No evidence has been sent yet.</p>}
      {claim.evidence.map((v) => (
        <div key={v.id} className="rounded-lg bg-white p-2 text-[13px] dark:bg-slate-900">
          <p className="font-semibold text-slate-700 dark:text-slate-200">{v.method === "manual" ? "Evidence for review" : "Email code"} · {v.status}</p>
          {v.note && <p className="whitespace-pre-line break-words text-slate-600 dark:text-slate-300">{v.note}</p>}
          {v.files.map((f) => <Btn key={f.index} kind="link" className="mr-3 text-[12px]" onClick={() => downloadClaimEvidence(v.id, f.index, f.name).catch((e) => setState({ problem: e.message }))}>Download {f.name}</Btn>)}
        </div>
      ))}
      <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Reason for the decision (kept with the claim; the claimant sees a general message)
        <textarea rows={2} className={`mt-1 ${inputClass}`} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {state.problem && <p role="alert" className="text-[12px] font-medium text-rose-600">{state.problem}</p>}
      <div className="flex flex-wrap gap-2">
        <Btn kind="primary" disabled={state.busy || reason.trim().length < 5} onClick={() => decide("approve")}>{claim.challenge ? "Uphold and transfer" : "Approve"}</Btn>
        <Btn kind="danger" disabled={state.busy || reason.trim().length < 5} onClick={() => decide("reject")}>Reject</Btn>
      </div>
    </div>
  );
}

/** A revocation one reviewer asked for. Someone else confirms it, or keeps the claim. */
function RevocationDecision({ item, onDone }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState({});
  async function decide(decision) {
    setState({ busy: true });
    try { await decideClaim(item.id, decision, reason); onDone(); } catch (e) { setState({ problem: directoryError(e).message }); }
  }
  if (item.needs_another_reviewer) {
    return <span><Chip tone="amber">Needs another reviewer</Chip><span className="mt-1 block text-[12px] text-amber-800 dark:text-amber-200">{item.requested_by_you ? "You asked for this, so someone else has to confirm it." : "You are a party to this profile, so someone else has to confirm it."}</span></span>;
  }
  return (
    <div className="min-w-[220px] space-y-2">
      <input aria-label={`Reason for your decision on ${item.profile.name}`} className={`${inputClass} !py-1.5 !text-[13px]`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept with the claim)" />
      {state.problem && <p role="alert" className="text-[12px] font-medium text-rose-600">{state.problem}</p>}
      <span className="flex flex-wrap gap-2">
        <Btn kind="danger" className="!py-1.5 !text-[13px]" disabled={state.busy || reason.trim().length < 5} onClick={() => decide("revoke")}>Confirm revocation</Btn>
        <Btn className="!py-1.5 !text-[13px]" disabled={state.busy || reason.trim().length < 5} onClick={() => decide("keep")}>Keep the claim</Btn>
      </span>
      {reason.trim().length < 5 && <p className="text-[12px] text-slate-500">Write a reason of at least 5 characters.</p>}
    </div>
  );
}

/** Approve or suppress one newly published self-made profile. Suppressing needs a reason, which the owner is shown. */
function ListingDecision({ item, onDone }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState({});
  async function decide(decision) {
    setState({ busy: true });
    try { await reviewListing(item.slug, decision, reason); onDone(); } catch (e) { setState({ problem: directoryError(e).message }); }
  }
  if (item.needs_another_reviewer) {
    return <span><Chip tone="amber">Needs another reviewer</Chip><span className="mt-1 block text-[12px] text-amber-800 dark:text-amber-200">You belong to this business, so someone else has to decide.</span></span>;
  }
  return (
    <div className="min-w-[220px] space-y-2">
      <input aria-label={`Reason for ${item.name}`} className={`${inputClass} !py-1.5 !text-[13px]`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (needed to suppress; the owner sees it)" />
      {state.problem && <p role="alert" className="text-[12px] font-medium text-rose-600">{state.problem}</p>}
      <span className="flex flex-wrap gap-2">
        <Btn kind="primary" className="!py-1.5 !text-[13px]" disabled={state.busy} onClick={() => decide("approve")}>Approve</Btn>
        <Btn kind="danger" className="!py-1.5 !text-[13px]" disabled={state.busy || reason.trim().length < 5} onClick={() => decide("suppress")}>Suppress</Btn>
      </span>
    </div>
  );
}

function Queue({ queue, onChange }) {
  const [open, setOpen] = useState(null);
  if (!queue) return <p role="status" className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="space-y-5">
      {queue.new_listings?.length > 0 && (
        <section aria-label="New listings" className="space-y-2">
          <div><h2 className="text-base font-bold text-slate-900 dark:text-slate-100">New listings</h2>
            <p className="text-[13px] text-slate-500">Profiles businesses made themselves and have just published. {queue.self_created_review === "pre_publish" ? "They stay hidden until approved." : "They are live now unless marked otherwise; look at each within 24 hours."}</p></div>
          <AdminTable caption="New listings" minWidth={760} rows={queue.new_listings} columns={[
            { key: "business", label: "Business", render: (r) => <><p className="break-words font-semibold text-slate-900 dark:text-slate-100">{r.live ? <a href={`/marketplace/business/${r.slug}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.name}</a> : r.name}</p>
              <p className="text-[12px] text-slate-500">{[r.category, r.location].filter(Boolean).join(" · ") || "No category or location"}</p></> },
            { key: "description", label: "What it says", tdClass: "break-words", render: (r) => r.description || "—" },
            { key: "state", label: "State", render: (r) => <span className="flex flex-col items-start gap-1"><Chip tone={r.live ? "emerald" : "slate"}>{r.live ? "Live" : "Waiting, not public"}</Chip>
              <Chip tone={r.overdue ? "rose" : "sky"}>{r.overdue ? "Over 24 hours" : `Due ${dateLabel(r.due_at)}`}</Chip></span> },
            { key: "action", label: "Decision", render: (r) => <ListingDecision item={r} onDone={onChange} /> },
          ]} />
        </section>
      )}
      {queue.revocations?.length > 0 && (
        <section aria-label="Revocations waiting for a second reviewer" className="space-y-2">
          <div><h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Revocations waiting for a second reviewer</h2>
            <p className="text-[13px] text-slate-500">Removing control of a verified profile takes two people. Nothing changes for the business until the second confirms.</p></div>
          <AdminTable caption="Revocations waiting for a second reviewer" minWidth={720} rows={queue.revocations} columns={[
            { key: "business", label: "Business", render: (r) => <><p className="break-words font-semibold text-slate-900 dark:text-slate-100">{r.profile.name}</p><p className="break-all text-[12px] text-slate-500">{r.claimant_email}</p></> },
            { key: "why", label: "Why", render: (r) => <><p className="font-semibold">{r.category_label || r.category}</p><p className="whitespace-pre-line break-words text-slate-600 dark:text-slate-300">{r.reason}</p></> },
            { key: "asked", label: "Asked", tdClass: "whitespace-nowrap", render: (r) => dateLabel(r.requested_at) },
            { key: "action", label: "Action", render: (r) => <RevocationDecision item={r} onDone={onChange} /> },
          ]} />
        </section>
      )}
      <section aria-label="Claims waiting for a decision" className="space-y-2">
        <div><h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Claims waiting for a decision</h2>
          <p className="text-[13px] text-slate-500">A person decides. Approving links the profile to the claimant's business; rejecting leaves the profile as it was.</p></div>
        <AdminTable caption="Claims waiting for a decision" minWidth={760} rows={queue.claims} emptyText="Nothing is waiting."
          expanded={(c) => (c.needs_another_reviewer
            ? <p className="text-[13px] text-amber-800 dark:text-amber-200">You made this claim, or you belong to a business it involves, so you can't see its evidence or decide it.</p>
            : open === c.id ? <ClaimReview claim={c} onDone={() => { setOpen(null); onChange(); }} /> : null)}
          columns={[
            { key: "business", label: "Business", render: (c) => <><p className="break-words font-semibold text-slate-900 dark:text-slate-100">{c.profile.name}</p><p className="text-[12px] text-slate-500">{c.profile.company_number ? `No. ${c.profile.company_number} · ` : ""}{c.profile.domain || "no website on record"}</p></> },
            { key: "claimant", label: "Claimant", tdClass: "break-all", render: (c) => c.claimant_email },
            { key: "links", label: "Links to", render: (c) => (c.target === "new" ? "A new business" : c.target ? "An existing business" : "Not chosen yet") },
            { key: "status", label: "Status", render: (c) => (c.needs_another_reviewer ? <Chip tone="amber">Needs another reviewer</Chip> : c.challenge ? <Chip tone="rose">Challenge</Chip> : <Chip tone="sky">{c.status.replace(/_/g, " ")}</Chip>) },
            { key: "started", label: "Started", tdClass: "whitespace-nowrap", render: (c) => dateLabel(c.created_at) },
            { key: "review", label: "", tdClass: "text-right", render: (c) => (!c.needs_another_reviewer ? <Btn className="!py-1.5 !text-[13px]" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Close" : "Review"}</Btn> : null) },
          ]} />
      </section>
    </div>
  );
}

const DECISION_TYPE = { claim: "Claim", verification: "Verification", listing: "New listing" };
const DECISION_EMAIL = {
  sent: ["emerald", "Email sent"],
  failed: ["rose", "Email failed"],
  not_needed: ["slate", "Told on screen"],
  before_emails: ["slate", "No email, decided earlier"],
};

/** Take back a claim that was approved. The reason is the team's; the person is only told it was removed after a review. */
function RevokeClaim({ item, categories, twoPeople, onDone }) {
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [state, setState] = useState({});
  async function revoke() {
    setState({ busy: true });
    try { await decideClaim(item.id, "revoke", reason, category); onDone(); } catch (e) { setState({ problem: directoryError(e).message }); }
  }
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-slate-600 dark:text-slate-300">The business loses this profile and its listing is unpublished. Requests it hasn't answered go back to the profile, which returns to unclaimed, and the person is emailed.{item.links_to === "A new business" ? " The workspace this claim created is closed too, and deleted after 30 days unless it is restored." : ""}{twoPeople ? " A second reviewer has to confirm before anything changes." : ""}</p>
      <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Why control is being removed
        <select className={`mt-1 ${inputClass}`} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose a reason</option>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>
      <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Reason for the decision (kept with the claim; the person sees a general message)
        <textarea rows={2} className={`mt-1 ${inputClass}`} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {state.problem && <p role="alert" className="text-[12px] font-medium text-rose-600">{state.problem}</p>}
      <Btn kind="danger" disabled={state.busy || !category || reason.trim().length < 5} onClick={revoke}>{twoPeople ? "Ask to revoke" : "Revoke claim"}</Btn>
      {(!category || reason.trim().length < 5) && <p className="text-[12px] text-slate-500">{!category ? "Choose why control is being removed." : "Write a reason of at least 5 characters."}</p>}
    </div>
  );
}

/** Everything already decided. Approved shows first, because that's what the team looks for. */
function Decided({ onChange }) {
  const [items, setItems] = useState(null);
  const [problem, setProblem] = useState(null);
  const [view, setView] = useState("approved");
  const [open, setOpen] = useState(null);
  const [extras, setExtras] = useState({ categories: [], twoPeople: false });
  const [loads, setLoads] = useState(0);
  const [note, setNote] = useState(null);
  useEffect(() => {
    let live = true;
    getDecisions().then((d) => { if (live) { setItems(d.items || []); setExtras({ categories: d.revoke_categories || [], twoPeople: Boolean(d.second_reviewer_required) }); } })
      .catch((e) => live && setProblem(directoryError(e, "The decisions couldn't be loaded.").message));
    return () => { live = false; };
  }, [loads]);
  async function restore(r) {
    setNote(null);
    try { await restoreClaimWorkspace(r.id); setLoads((n) => n + 1); } catch (e) { setNote(directoryError(e).message); }
  }
  function changed() {
    setOpen(null);
    setLoads((n) => n + 1);
    onChange?.();      // the tiles and the queue count
  }
  if (problem) return <Notice tone="rose" role="alert">{problem}</Notice>;
  if (!items) return <p role="status" className="text-sm text-slate-500">Loading…</p>;
  const approved = items.filter((i) => i.outcome === "approved");
  const others = items.filter((i) => i.outcome !== "approved");
  const rows = view === "approved" ? approved : others;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        <Btn kind={view === "approved" ? "primary" : undefined} className="!py-1.5 !text-[13px]" aria-pressed={view === "approved"} onClick={() => setView("approved")}>Approved ({approved.length})</Btn>
        <Btn kind={view === "others" ? "primary" : undefined} className="!py-1.5 !text-[13px]" aria-pressed={view === "others"} onClick={() => setView("others")}>Rejected or removed ({others.length})</Btn>
      </div>
      {note && <Notice tone="rose" role="alert">{note}</Notice>}
      <AdminTable caption={view === "approved" ? "Approved businesses" : "Rejected or removed"} minWidth={860} rows={rows} emptyText={view === "approved" ? "Nothing has been approved yet." : "Nothing has been rejected or removed."}
        expanded={(r) => {
          if (open !== r.id) return null;
          return r.revocation
            ? <div className="space-y-2"><p className="text-[13px] text-slate-600 dark:text-slate-300"><span className="font-semibold">{r.revocation.category_label}:</span> {r.revocation.reason}</p>
              <RevocationDecision item={{ id: r.id, profile: { name: r.name }, requested_by_you: r.revocation.requested_by_you, needs_another_reviewer: r.revocation.requested_by_you || r.needs_another_reviewer }} onDone={changed} /></div>
            : <RevokeClaim item={r} categories={extras.categories} twoPeople={extras.twoPeople} onDone={changed} />;
        }}
        columns={[
        { key: "business", label: "Business", render: (r) => <><p className="break-words font-semibold text-slate-900 dark:text-slate-100">{r.slug && r.outcome === "approved" ? <a href={`/marketplace/business/${r.slug}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.name}</a> : r.name}</p>
          <p className="text-[12px] text-slate-500">{[DECISION_TYPE[r.type], r.links_to].filter(Boolean).join(" · ")}</p></> },
        { key: "person", label: "Person told", tdClass: "break-all", render: (r) => r.person || "Not recorded" },
        { key: "by", label: "Decided by", tdClass: "break-all", render: (r) => <>{r.decided_by}{r.decided_at && <span className="block whitespace-nowrap text-[12px] text-slate-500">{dateLabel(r.decided_at)}</span>}</> },
        { key: "reason", label: "Reason", tdClass: "whitespace-pre-line break-words", render: (r) => r.reason || "None given" },
        { key: "email", label: "Email", render: (r) => { const [tone, label] = DECISION_EMAIL[r.email] || DECISION_EMAIL.before_emails; return <Chip tone={tone}>{label}</Chip>; } },
        ...(view === "others" ? [{ key: "workspace", label: "Workspace", render: (r) => {
          if (!r.workspace) return "Not affected";
          if (r.workspace.state === "closed") return <span className="inline-flex flex-col items-start gap-1"><Chip tone="amber">Closed until {dateLabel(r.workspace.until)}</Chip>
            <Btn className="!py-1.5 !text-[13px]" aria-label={`Restore the workspace for ${r.name}`} onClick={() => restore(r)}>Restore</Btn></span>;
          return { restored: <Chip tone="emerald">Restored</Chip>, deleted: <Chip tone="slate">Deleted</Chip>, failed: <Chip tone="rose">Couldn't be closed</Chip> }[r.workspace.state] || null;
        } }] : []),
        ...(view === "approved" ? [{ key: "action", label: "", tdClass: "text-right", render: (r) => {
          if (!r.revocable) return null;
          if (r.needs_another_reviewer && !r.revocation) return <Chip tone="amber">Needs another reviewer</Chip>;
          const close = open === r.id ? "Close" : null;
          return <span className="inline-flex flex-col items-end gap-1">{r.revocation && <Chip tone="amber">Revocation waiting</Chip>}
            <Btn kind={close || r.revocation ? undefined : "danger"} className="!py-1.5 !text-[13px]" aria-expanded={open === r.id} aria-label={`${close || (r.revocation ? "Review revocation" : "Revoke")} ${r.name}`} onClick={() => setOpen(open === r.id ? null : r.id)}>{close || (r.revocation ? "Review" : "Revoke")}</Btn></span>;
        } }] : []),
      ]} />
    </div>
  );
}

function Reports({ queue, onChange, setProblem }) {
  if (!queue) return <p role="status" className="text-sm text-slate-500">Loading…</p>;
  async function resolve(report, action) {
    try { await resolveReport(report.id, action, action === "suppress" ? "Unlisted after a report" : "No change needed"); onChange(); } catch (e) { setProblem(directoryError(e).message); }
  }
  return (
    <AdminTable caption="Corrections and unlist requests" minWidth={860} rows={queue.reports} emptyText="No open reports." columns={[
      { key: "business", label: "Business", render: (r) => <><p className="break-words font-semibold text-slate-900 dark:text-slate-100">{r.profile?.slug ? <a href={`/marketplace/business/${r.profile.slug}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.profile.name}</a> : r.profile?.name || "Not found"}</p>
        {r.profile?.location && <p className="text-[12px] text-slate-500">{r.profile.location}</p>}</> },
      { key: "kind", label: "Request", render: (r) => <Chip tone={r.kind === "unlist" ? "rose" : "slate"}>{r.kind === "unlist" ? "Asks to be removed" : r.kind === "correction" ? "Correction" : "Other"}</Chip> },
      { key: "message", label: "Message", tdClass: "whitespace-pre-line break-words", render: (r) => r.message },
      { key: "sender", label: "Sent by", tdClass: "break-all", render: (r) => (r.needs_another_reviewer ? "Hidden" : r.reporter_email || "No email given") },
      { key: "received", label: "Received", tdClass: "whitespace-nowrap", render: (r) => dateLabel(r.created_at) },
      { key: "action", label: "Action", render: (r) => (r.needs_another_reviewer
        ? <span><Chip tone="amber">Needs another reviewer</Chip><span className="mt-1 block text-[12px] text-amber-800 dark:text-amber-200">This is about a profile your own business manages.</span></span>
        : <span className="flex flex-wrap gap-2"><Btn kind="danger" className="!py-1.5 !text-[13px]" onClick={() => resolve(r, "suppress")}>Unlist the profile</Btn><Btn className="!py-1.5 !text-[13px]" onClick={() => resolve(r, "dismiss")}>No change needed</Btn></span>) },
    ]} />
  );
}

const MODERATE = { suppress: ["Suppress", "Suppress profile", "It disappears from the directory, its page and outreach, for everyone."],
  archive: ["Archive", "Archive profile", "Put away: hidden everywhere, and can be restored."],
  restore: ["Restore", "Restore profile", "It goes back to the state it was in before."] };

/** The requests kept for a business until it claims, in a popup over the list. */
function WaitingRequests({ data, onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close requests" onClick={onClose} className="absolute inset-0 bg-slate-900/40" />
      <div role="dialog" aria-modal="true" aria-label={`Requests for ${data.name}`} className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="min-w-0"><h2 className="break-words text-base font-bold text-slate-900 dark:text-slate-100">Requests for {data.name}</h2>
            <p className="text-[13px] text-slate-500">Private to the team. They go to the business when its claim is approved.</p></div>
          <Btn className="!py-1.5 !text-[13px]" onClick={onClose}>Close</Btn>
        </div>
        <div className="space-y-3 overflow-y-auto p-4">
          {data.items.length === 0 && <p className="text-sm text-slate-500">Nothing is waiting for this business now.</p>}
          {data.items.map((r) => (
            <article key={r.id} className="rounded-xl border border-slate-200 p-3 text-[13px] dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Chip tone={r.kind === "quote" ? "sky" : r.kind === "proposal" ? "emerald" : "slate"}>{r.kind === "quote" ? "Quote request" : r.kind === "proposal" ? (r.request_title ? "Reply to an RFP" : "Proposal") : "Question"}</Chip>
                <span className="text-[12px] text-slate-500">Received {dateLabel(r.received_at)}{r.needed_by ? ` · Needed by ${dateLabel(r.needed_by)}` : ""}</span>
              </div>
              {r.title && <p className="mt-2 break-words text-sm font-bold text-slate-900 dark:text-slate-100">{r.title}</p>}
              <p className="mt-2 break-words font-semibold text-slate-900 dark:text-slate-100">{r.name}{r.company ? ` · ${r.company}` : ""}</p>
              <p className="break-all text-slate-600 dark:text-slate-300">{r.email}</p>
              {r.items.length > 0 && <ul className="mt-2 space-y-1 text-slate-700 dark:text-slate-200">
                {r.items.map((it, i) => <li key={i} className="break-words">{it.name} × {it.quantity}{it.notes ? <span className="block text-[12px] text-slate-500">{it.notes}</span> : null}</li>)}
              </ul>}
              {r.details && <p className="mt-2 whitespace-pre-line break-words text-slate-600 dark:text-slate-300">{r.details}</p>}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Every unclaimed profile, for moderators, whatever the visibility level, with what the public can see of each. */
function Unclaimed({ onChange }) {
  const [list, setList] = useState(null);
  const [problem, setProblem] = useState(null);
  const [note, setNote] = useState(null);          // what just happened, in words
  const [asking, setAsking] = useState(null);      // { profile, action } waiting for a reason
  const [reason, setReason] = useState("");
  const [sources, setSources] = useState(null);
  const [requests, setRequests] = useState(null);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [vis, setVis] = useState(null);            // { profiles: [...], value, reason } being set
  const [writing, setWriting] = useState(null);    // { profile, rfps, title, description, budget_range, deadline, requirements, errors } an RFP being published
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => getUnclaimedProfiles().then((r) => { setList(r); setProblem(null); }).catch((e) => setProblem(directoryError(e, "The list couldn't be loaded.").message)), []);
  useEffect(() => { load(); }, [load]);

  async function invite(p, send) {
    setNote(null); setProblem(null);
    try {
      const reason = p.requests_waiting ? "opportunity" : "profile_control";      // someone has asked this business for something: the invitation says so
      const made = await createInvitation(p.slug, send ? { reason, send: true } : { reason, by_hand: true });
      if (send) { setNote({ text: made.status === "sent" ? `Invitation sent to the contact on record for ${p.name}.` : `No email went out for ${p.name}. Here is the link instead:`, link: made.status === "sent" ? null : `${window.location.origin}${made.link}` }); return; }
      const link = `${window.location.origin}${made.link}`;
      let copied = false;
      try { await navigator.clipboard.writeText(link); copied = true; } catch { copied = false; }
      setNote({ text: copied ? `Invitation link for ${p.name} copied.` : `Invitation link for ${p.name}:`, link });
    } catch (e) { setProblem(directoryError(e).message); }
  }
  async function showSources(p) {
    setProblem(null);
    try { setSources(await getProfileSources(p.slug)); } catch (e) { setProblem(directoryError(e).message); }
  }
  async function moderate() {
    setBusy(true); setProblem(null);
    try {
      const done = await moderateProfile(asking.profile.slug, asking.action, reason);
      setNote({ text: `${asking.profile.name}: ${done.public_state}.` });
      setAsking(null); setReason("");
      await load(); onChange?.();
    } catch (e) { setProblem(directoryError(e).message); } finally { setBusy(false); }
  }
  async function applyVisibility() {
    setBusy(true); setProblem(null);
    try {
      const done = await setProfileVisibility(vis.profiles.map((p) => p.slug), vis.value, vis.reason);
      setNote({ text: `Visibility set to "${VISIBILITY_OPTION[vis.value]}" for ${done.count} profile${done.count === 1 ? "" : "s"}.${vis.value === "public" ? " A profile appears in the directory once its Public state says Ready." : ""}${done.skipped?.length ? ` ${done.skipped.length} skipped.` : ""}` });
      setVis(null); setSelected(new Set());
      await load(); onChange?.();
    } catch (e) { setProblem(directoryError(e).message); } finally { setBusy(false); }
  }
  async function switchProposals(p) {
    setNote(null); setProblem(null);
    try {
      await setHeldProposals(p.slug, !p.proposals_open);
      setNote({ text: p.proposals_open ? `${p.name} is closed to proposals. Proposals already kept for it stay waiting.` : `${p.name} is open for proposals. They're kept for the business and go to its Proposals inbox once it claims the profile.` });
      await load(); onChange?.();
    } catch (e) { setProblem(directoryError(e).message); }
  }
  async function startRfp(p) {
    setProblem(null);
    const blank = { profile: p, rfps: [], title: "", description: "", budget_range: "", deadline: "", requirements: "", errors: {} };
    setWriting(blank);
    try { const r = await getProfileRfps(p.slug); setWriting((w) => (w && w.profile.id === p.id ? { ...w, rfps: r.items || [] } : w)); } catch { /* the form still works */ }
  }
  async function sendRfp() {
    setBusy(true); setProblem(null);
    try {
      const made = await publishProfileRfp(writing.profile.slug, { title: writing.title, description: writing.description, budget_range: writing.budget_range || null,
        deadline: writing.deadline || null, requirements: writing.requirements.split("\n").map((t) => t.trim()).filter(Boolean) });
      setNote({ text: `RFP published for ${writing.profile.name}. It's listed under Requests on the Marketplace.`, link: `${window.location.origin}/marketplace/request/${made.id}` });
      setWriting(null);
      await load(); onChange?.();
    } catch (e) {
      const p = directoryError(e);
      if (Object.keys(p.errors || {}).length) setWriting((w) => ({ ...w, errors: p.errors })); else setProblem(p.message);
    } finally { setBusy(false); }
  }
  async function closeRfp(r) {
    setProblem(null);
    try {
      await closeProfileRfp(writing.profile.slug, r.id);
      const fresh = await getProfileRfps(writing.profile.slug);
      setWriting((w) => (w ? { ...w, rfps: fresh.items || [] } : w));
    } catch (e) { setProblem(directoryError(e).message); }
  }
  const ask = (profile, action) => { setAsking({ profile, action }); setReason(""); };
  const chosen = (list?.items || []).filter((p) => selected.has(p.id));

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-slate-500">You see these at every visibility level. "Public state" is what the public can see of each one right now; "Visibility" is the profile's own setting, or the global one it follows.</p>
      {problem && <Notice tone="rose" role="alert">{problem}</Notice>}
      {note && <Notice tone="emerald">{note.text}{note.link && <span className="mt-1 block break-all font-mono text-[12px]">{note.link}</span>}</Notice>}
      {asking && (
        <form onSubmit={(e) => { e.preventDefault(); moderate(); }} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900" aria-label={`${MODERATE[asking.action][0]} ${asking.profile.name}`}>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{MODERATE[asking.action][0]} {asking.profile.name}</p>
          <p className="mt-0.5 text-[13px] text-slate-500">{MODERATE[asking.action][2]}</p>
          <label className="mt-2 block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Reason (kept with the profile)
            <input className={`mt-1 ${inputClass}`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind={asking.action === "restore" ? "primary" : "danger"} type="submit" disabled={busy || reason.trim().length < 5}>{busy ? "Saving…" : MODERATE[asking.action][1]}</Btn>
            <Btn onClick={() => { setAsking(null); setReason(""); }}>Cancel</Btn>
          </div>
        </form>
      )}
      {vis && (
        <form onSubmit={(e) => { e.preventDefault(); applyVisibility(); }} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900" aria-label="Set visibility">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Set visibility for {vis.profiles.length === 1 ? vis.profiles[0].name : `${vis.profiles.length} profiles`}</p>
          <p className="mt-0.5 text-[13px] text-slate-500">A profile's own setting wins over the global one. Suppressed profiles stay hidden whatever is chosen.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Visibility
              <select className={`mt-1 ${inputClass}`} value={vis.value} onChange={(e) => setVis({ ...vis, value: e.target.value })}>{Object.entries(VISIBILITY_OPTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Reason (optional, kept with the profile)
              <input className={`mt-1 ${inputClass}`} value={vis.reason} onChange={(e) => setVis({ ...vis, reason: e.target.value })} />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2"><Btn kind="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Apply"}</Btn><Btn onClick={() => setVis(null)}>Cancel</Btn></div>
        </form>
      )}
      {writing && (
        <form onSubmit={(e) => { e.preventDefault(); sendRfp(); }} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900" aria-label={`Publish an RFP for ${writing.profile.name}`}>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Publish an RFP for {writing.profile.name}</p>
          <p className="mt-0.5 text-[13px] text-slate-500">It's listed under Requests on the Marketplace in this business's name. Businesses reply with proposals, which are kept and go to its Proposals inbox once it claims the profile. The request goes to the business too, still open.</p>
          {writing.rfps?.length > 0 && (
            <ul aria-label={`RFPs for ${writing.profile.name}`} className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 text-[13px] dark:divide-slate-800 dark:border-slate-800">
              {writing.rfps.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0"><span className="block break-words font-semibold text-slate-900 dark:text-slate-100">{r.title}</span>
                    <span className="text-[12px] text-slate-500">{r.status === "PUBLISHED" ? "Open" : "Closed"} · published {dateLabel(r.published_at)}{r.deadline ? ` · deadline ${dateLabel(r.deadline)}` : ""} · {r.replies_waiting === 1 ? "1 reply waiting" : `${r.replies_waiting} replies waiting`}</span></span>
                  <span className="flex gap-2">
                    {r.status === "PUBLISHED" && <Btn kind="link" className="text-[12px]" onClick={() => window.open(`/marketplace/request/${r.id}`, "_blank", "noopener")}>View</Btn>}
                    {r.status === "PUBLISHED" && <Btn kind="link" className="text-[12px]" onClick={() => closeRfp(r)}>Close</Btn>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200 sm:col-span-2">Title
              <input className={`mt-1 ${inputClass}`} value={writing.title} maxLength={200} placeholder="What the business is looking for" onChange={(e) => setWriting({ ...writing, title: e.target.value })} />
              {writing.errors?.title && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{writing.errors.title}</span>}
            </label>
            <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200 sm:col-span-2">What's needed
              <textarea rows={5} className={`mt-1 ${inputClass}`} value={writing.description} maxLength={2000} onChange={(e) => setWriting({ ...writing, description: e.target.value })} />
              {writing.errors?.description && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{writing.errors.description}</span>}
            </label>
            <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Budget (optional)
              <input className={`mt-1 ${inputClass}`} value={writing.budget_range} maxLength={80} placeholder="5000 - 10000" onChange={(e) => setWriting({ ...writing, budget_range: e.target.value })} />
            </label>
            <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Deadline (optional)
              <input type="date" className={`mt-1 ${inputClass}`} value={writing.deadline} onChange={(e) => setWriting({ ...writing, deadline: e.target.value })} />
              {writing.errors?.deadline && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{writing.errors.deadline}</span>}
            </label>
            <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200 sm:col-span-2">Requirements (optional, one per line)
              <textarea rows={3} className={`mt-1 ${inputClass}`} value={writing.requirements} onChange={(e) => setWriting({ ...writing, requirements: e.target.value })} />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind="primary" type="submit" disabled={busy || writing.title.trim().length < 3 || writing.description.trim().length < 20}>{busy ? "Publishing…" : "Publish RFP"}</Btn>
            <Btn onClick={() => setWriting(null)}>Cancel</Btn>
          </div>
        </form>
      )}
      {editing && <EditBusinessForm profile={editing} options={list?.options} onClose={() => setEditing(null)}
        onSaved={async (done) => { setEditing(null); setNote({ text: `${editing.name} saved: ${done.public_state}.` }); await load(); onChange?.(); }} />}
      {requests && <WaitingRequests data={requests} onClose={() => setRequests(null)} />}
      {sources && (
        <section aria-label={`Sources for ${sources.name}`} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Sources for {sources.name}</p>
              <p className="text-[13px] text-slate-500">Quality {sources.quality ?? "—"} · fit {sources.fit_band || "—"}{sources.reasons?.length ? ` · ${sources.reasons.join(" ")}` : ""}{sources.edits?.length ? ` · edited ${sources.edits.length} time${sources.edits.length === 1 ? "" : "s"}` : ""}</p></div>
            <Btn className="!py-1.5 !text-[13px]" onClick={() => setSources(null)}>Close</Btn>
          </div>
          <div className="mt-2">
            <AdminTable caption={`Sources for ${sources.name}`} minWidth={520} rows={sources.fields} rowKey={(f) => f.field} emptyText="No source is recorded for this profile." columns={[
              { key: "field", label: "Field", render: (f) => f.field.replace(/_/g, " ") },
              { key: "provider", label: "Source", render: (f) => <>{f.provider}{f.previous ? <span className="block text-[12px] text-slate-500">before: {f.previous}</span> : null}</> },
              { key: "record_id", label: "Record", tdClass: "break-all" },
              { key: "retrieved_at", label: "Retrieved", tdClass: "whitespace-nowrap", render: (f) => dateLabel(f.retrieved_at) },
            ]} />
          </div>
        </section>
      )}
      {chosen.length > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-[13px] text-brand-800 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-200">
          <span>{chosen.length} selected</span>
          <span className="flex flex-wrap gap-2"><Btn className="!py-1.5 !text-[13px]" onClick={() => setVis({ profiles: chosen, value: "inherit", reason: "" })}>Set visibility</Btn><Btn kind="link" className="text-[13px]" onClick={() => setSelected(new Set())}>Clear</Btn></span>
        </div>
      )}
      {!list ? (!problem && <p role="status" className="text-sm text-slate-500">Loading…</p>) : (
        <AdminTable caption="Unclaimed profiles" minWidth={860} rows={list.items} emptyText="There are no unclaimed profiles." rowLabel={(p) => p.name}
          selection={{ selected, onChange: setSelected }}
          rowActions={(p) => {
            const live = ["published", "noindex"].includes(p.publication);
            const gone = p.publication === "suppressed";
            return [
              { label: "Copy invitation link", onClick: () => invite(p, false), disabled: !live },
              ...(list.invites_enabled ? [{ label: "Send invitation", onClick: () => invite(p, true), disabled: !live || !p.has_contact }] : []),
              { label: "Open profile (moderator view)", onClick: () => window.open(`/marketplace/business/${p.slug}`, "_blank", "noopener"), disabled: gone || p.publication === "unpublished" },
              { label: "Change visibility", onClick: () => setVis({ profiles: [p], value: p.visibility || "inherit", reason: "" }) },
              { label: p.proposals_open ? "Close to proposals" : "Open for proposals", onClick: () => switchProposals(p), disabled: gone && !p.proposals_open },
              { label: "Publish an RFP", onClick: () => startRfp(p), disabled: !live },
              { label: "Edit", onClick: () => setEditing(p), disabled: gone },
              ...(gone ? [{ label: "Restore", onClick: () => ask(p, "restore") }] : [{ label: "Archive", onClick: () => ask(p, "archive") }, { label: "Suppress", danger: true, onClick: () => ask(p, "suppress") }]),
              { label: "View sources", onClick: () => showSources(p) },
            ];
          }}
          columns={[
            { key: "name", label: "Business", render: (p) => <><p className="break-words font-semibold text-slate-900 dark:text-slate-100">{p.name}</p><p className="break-all text-[12px] text-slate-500">{p.slug}</p></> },
            { key: "category", label: "Category", render: (p) => p.category || "—" },
            { key: "location", label: "Location", render: (p) => p.location || "—" },
            // When a public profile is held back by quality, what is missing is on the chip (hover or focus) and read out with it.
            { key: "state", label: "Public state", render: (p) => (p.state_detail?.length
              ? <span tabIndex={0} title={`Missing: ${p.state_detail.join(" ")}`} className="inline-block rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">
                <Chip tone={p.state_tone}>{p.public_state}</Chip><span className="mt-1 block max-w-[16rem] whitespace-normal text-[11px] text-slate-500">{p.state_hint} Missing: {p.state_detail.join(" ")}</span></span>
              : <Chip tone={p.state_tone}>{p.public_state || p.publication}</Chip>) },
            { key: "visibility", label: "Visibility", render: (p) => p.visibility_label || "—" },
            { key: "requests", label: "Requests waiting", render: (p) => (p.requests_waiting
              ? <button type="button" aria-label={`Read ${p.requests_waiting === 1 ? "1 request" : `${p.requests_waiting} requests`} for ${p.name}`} className="rounded-full hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                onClick={() => getWaitingRequests(p.slug).then(setRequests).catch((e) => setProblem(directoryError(e).message))}><Chip tone="amber"><span className="underline">{p.requests_waiting}</span></Chip></button>
              : 0) },
            { key: "proposals", label: "Proposals", render: (p) => (p.proposals_open ? <Chip tone="emerald">Open</Chip> : <span className="text-slate-500">Closed</span>) },
            { key: "contact", label: "Contact on record", render: (p) => (p.has_contact ? "Yes" : "No") },
          ]} />
      )}
    </div>
  );
}

/** Who can see profiles nobody has claimed yet. The choice is kept on the server with who made it and when. */
function Visibility({ readOnly }) {
  const [setting, setSetting] = useState(null);
  const [state, setState] = useState({});
  useEffect(() => { getVisibility().then(setSetting).catch((e) => setState({ problem: directoryError(e).message })); }, []);
  async function choose(level) {
    setState({ busy: true });
    try { setSetting(await setVisibility(level)); setState({ saved: true }); } catch (e) { setState({ problem: directoryError(e).message }); }
  }
  if (!setting) return state.problem ? <Notice tone="rose" role="alert">{state.problem}</Notice> : <p role="status" className="text-sm text-slate-500">Loading…</p>;
  return (
    <Panel title="Who can see unclaimed profiles" description="Profiles a business has claimed or created are always public. This is about the ones nobody has claimed yet.">
      <fieldset className="grid gap-2 md:grid-cols-3" disabled={state.busy || readOnly}>
        <legend className="sr-only">Unclaimed profile visibility</legend>
        {setting.levels.map((l) => (
          <label key={l.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${setting.unclaimed_visibility === l.key ? "border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/20" : "border-slate-200 dark:border-slate-700"}`}>
            <input type="radio" name="unclaimed-visibility" className="mt-1" checked={setting.unclaimed_visibility === l.key} onChange={() => choose(l.key)} />
            <span><span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{l.label}</span><span className="block text-[12px] text-slate-500">{l.explanation}</span></span>
          </label>
        ))}
      </fieldset>
      <p role="status" className="mt-2 text-[12px] text-slate-500">
        {state.busy ? "Saving…" : setting.source === "moderator" ? `Set by ${setting.changed_by} on ${dateLabel(setting.changed_at)}.` : "This is the default. Nobody has changed it."}
        {state.saved && !state.busy ? " Saved." : ""}
        {readOnly ? " Only the administrator can change this. You can set one profile's own visibility under Unclaimed profiles." : ""}
      </p>
      {state.problem && <p role="alert" className="mt-1 text-[12px] font-medium text-rose-600">{state.problem}</p>}
    </Panel>
  );
}

function IndexAndInvites({ onChange, onTeam }) {
  const [json, setJson] = useState("");
  const [indexed, setIndexed] = useState(null);
  const [invite, setInvite] = useState({ ref: "", reason: "profile_control", opportunity_ref: "" });
  const [invited, setInvited] = useState(null);
  const [options, setOptions] = useState(null);      // categories and source providers for the form
  useEffect(() => { getUnclaimedProfiles().then((r) => setOptions(r.options || null)).catch(() => {}); }, []);
  async function addRecords() {
    setIndexed(null);
    try {
      const records = JSON.parse(json);
      setIndexed(await indexRecords(Array.isArray(records) ? records : [records]));
      onChange();
    } catch (e) { setIndexed({ problem: e instanceof SyntaxError ? "That isn't valid JSON." : directoryError(e).message }); }
  }
  async function tidy() {
    setIndexed(null);
    try { const r = await normaliseLocations(); setIndexed({ tidied: r.count }); onChange(); } catch (e) { setIndexed({ problem: directoryError(e).message }); }
  }
  async function makeInvite() {
    setInvited(null);
    try { setInvited(await createInvitation(invite.ref.trim(), { reason: invite.reason, opportunity_ref: invite.opportunity_ref.trim() || null })); }
    catch (e) { setInvited({ problem: directoryError(e).message }); }
  }
  return (
    <div className="space-y-4">
      <AddBusinesses options={options} onChange={onChange} />
      {!onTeam && <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <Btn onClick={tidy}>Tidy stored locations</Btn>
        <span className="text-[12px] text-slate-500">Reduces any stored street address or full postcode to its town. Old profile addresses keep working.</span>
        {indexed?.tidied !== undefined && <span role="status" className="w-full text-[13px] text-slate-600 dark:text-slate-300">{indexed.tidied === 0 ? "Every stored location is already a town or region." : `Tidied ${indexed.tidied} profile${indexed.tidied === 1 ? "" : "s"}. Their old addresses still open.`}</span>}
      </div>}
      {!onTeam && <details className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <summary className="cursor-pointer text-base font-bold text-slate-900 dark:text-slate-100">Advanced: paste records as JSON</summary>
        <p className="mb-2 mt-2 text-[13px] text-slate-500">Each record needs a name and a source (provider and record id). No account or business is created.</p>
        <textarea aria-label="Records as JSON" rows={6} className={`font-mono !text-[12px] ${inputClass}`} value={json} onChange={(e) => setJson(e.target.value)}
          placeholder='[{"name": "Example Advisory Ltd", "company_number": "12345678", "category": "Consulting", "location": "Leeds", "website": "https://example.co.uk", "service_tags": ["Pricing"], "description": "…", "source": {"provider": "Companies House", "record_id": "12345678"}}]' />
        <Btn className="mt-2" disabled={!json.trim()} onClick={addRecords}>Index records</Btn>
        {indexed?.problem && <p role="alert" className="mt-2 text-[12px] font-medium text-rose-600">{indexed.problem}</p>}
        {indexed?.summary && <p role="status" className="mt-2 text-[13px] text-slate-600 dark:text-slate-300">Created {indexed.summary.created}, updated {indexed.summary.updated}, excluded {indexed.summary.excluded}, invalid {indexed.summary.invalid}.</p>}
      </details>}
      <Panel title="Claim invitation link" description="Creates a link you can share. An opportunity invitation is refused unless a real, open request matches the business.">
        <div className="grid gap-2 sm:grid-cols-3">
          <input aria-label="Profile address or id" className={inputClass} value={invite.ref} onChange={(e) => setInvite({ ...invite, ref: e.target.value })} placeholder="profile address, e.g. example-advisory-ltd-leeds" />
          <select aria-label="Reason" className={inputClass} value={invite.reason} onChange={(e) => setInvite({ ...invite, reason: e.target.value })}>
            <option value="profile_control">Control your profile</option><option value="opportunity">A matching request exists</option>
          </select>
          <input aria-label="Request reference" className={inputClass} disabled={invite.reason !== "opportunity"} value={invite.opportunity_ref} onChange={(e) => setInvite({ ...invite, opportunity_ref: e.target.value })} placeholder="request id" />
        </div>
        <Btn className="mt-2" disabled={!invite.ref.trim()} onClick={makeInvite}>Create link</Btn>
        {invited?.problem && <p role="alert" className="mt-2 text-[12px] font-medium text-rose-600">{invited.problem}</p>}
        {invited?.link && <p role="status" className="mt-2 break-all text-[13px] text-slate-700 dark:text-slate-200">{window.location.origin}{invited.link}</p>}
      </Panel>
    </div>
  );
}

/** The internal team who add and manage profiles for claiming. Only the administrator sees this. */
function Team() {
  const [team, setTeam] = useState(null);
  const [email, setEmail] = useState("");
  const [state, setState] = useState({});
  useEffect(() => { getTeam().then(setTeam).catch((e) => setState({ problem: directoryError(e).message })); }, []);
  async function act(work) {
    setState({ busy: true });
    try {
      const result = await work();
      setTeam(result);
      setEmail("");
      setState(result?.invite_sent === false ? { problem: "The team member was added, but the email could not be sent. Add the same address again to send a fresh link." }
        : result?.invite_sent ? { note: "Invitation sent. The link verifies their email and opens Marketplace Claims without a separate sign-up or login." } : {});
    } catch (e) { setState({ problem: directoryError(e).message }); }
  }
  return (
    <Panel title="Marketplace team" description="Team members can add and import businesses, correct unclaimed profiles, make claim links, and decide claims and reports. They see nothing else in the admin area, and can't change who sees unclaimed profiles.">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) act(() => addTeamMember(email.trim())); }}>
        <input type="email" aria-label="Team member's email" className={`min-w-0 flex-1 ${inputClass}`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@enterprateai.com" />
        <Btn type="submit" disabled={state.busy || !email.trim()}>Add to team</Btn>
      </form>
      {state.problem && <p role="alert" className="mt-2 text-[12px] font-medium text-rose-600">{state.problem}</p>}
      {state.note && <p role="status" className="mt-2 text-[12px] font-medium text-emerald-700">{state.note}</p>}
      <p className="mt-2 text-[12px] text-slate-500">We email each invited teammate a secure link. Opening it verifies their email and takes them straight to Marketplace Claims.</p>
      {!team && !state.problem && <p role="status" className="mt-3 text-sm text-slate-500">Loading…</p>}
      {team && team.members.length === 0 && <p className="mt-3 text-sm text-slate-500">Nobody on the team yet.</p>}
      {team && team.members.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {team.members.map((m) => (
            <li key={m.email} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 break-all text-sm"><span className="font-semibold text-slate-800 dark:text-slate-100">{m.email}</span><span className="block text-[12px] text-slate-500">Added {dateLabel(m.added_at)}</span></span>
              <Btn disabled={state.busy} onClick={() => act(() => removeTeamMember(m.email))}>Remove</Btn>
            </li>
          ))}
        </ul>
      )}
      {team && team.history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-slate-700 dark:text-slate-200">Changes to the team</summary>
          <ul className="mt-2 space-y-1 text-[12px] text-slate-500">
            {team.history.map((h) => <li key={`${h.at}${h.email}`} className="break-all">{dateLabel(h.at)}: {h.email} {h.action} by {h.by}</li>)}
          </ul>
        </details>
      )}
    </Panel>
  );
}

/** `section` and `onSection` let the admin sidebar drive the tabs; without them the tabs keep their own place. */
export default function AdminClaims({ section, onSection, superadmin = false, onTeam = false }) {
  const tabs = superadmin ? [...MARKETPLACE_TABS, ["team", "Team"]] : MARKETPLACE_TABS;
  const known = (key) => tabs.some(([k]) => k === key);
  const [at, setAt] = useState(known(section) ? section : "index");
  useEffect(() => { if (known(section)) setAt(section); }, [section]);      // the sidebar moved us
  const go = (key) => { setAt(key); onSection?.(key); };
  const [queue, setQueue] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [problem, setProblem] = useState(null);

  const load = useCallback(async () => {
    try { const [q, f] = await Promise.all([getClaimQueue(), getFunnel()]); setQueue(q); setFunnel(f); setProblem(null); }
    catch (e) { setProblem(directoryError(e, "The review queue couldn't be loaded.").message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const events = funnel?.events || {};
  const counts = { queue: queue ? queue.claims.length + (queue.revocations?.length || 0) + (queue.new_listings?.length || 0) : undefined, reports: queue?.reports.length };
  return (
    <div className="space-y-4">
      {problem && <Notice tone="rose" role="alert">{problem}</Notice>}

      {funnel && (
        <section aria-label="Directory at a glance" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <KpiTile label="Indexed" value={funnel.profiles.total ?? 0} />
          <KpiTile label="Requests waiting" value={funnel.requests_waiting ?? 0} />
          <KpiTile label="Claims started" value={events.BusinessClaimStarted ?? 0} />
          <KpiTile label="Verified" value={funnel.profiles.claimed ?? 0} />
          <KpiTile label="Published" value={funnel.profiles.published ?? 0} />
          <KpiTile label="Suppressed" value={funnel.profiles.suppressed ?? 0} />
          <KpiTile label="Reports open" value={funnel.reports_open ?? queue?.reports?.length ?? 0} />
        </section>
      )}

      <div role="tablist" aria-label="Marketplace moderation" className="flex gap-1 overflow-x-auto border-b border-slate-200 [scrollbar-width:none] dark:border-slate-800 [&::-webkit-scrollbar]:hidden">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={at === key} onClick={() => go(key)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${at === key ? "border-brand-600 text-brand-700 dark:text-brand-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>
            {label}{counts[key] ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{counts[key]}</span> : null}
          </button>
        ))}
      </div>

      {at === "queue" && <Queue queue={queue} onChange={load} />}
      {at === "decided" && <Decided onChange={load} />}
      {at === "unclaimed" && <Unclaimed onChange={load} />}
      {at === "reports" && <Reports queue={queue} onChange={load} setProblem={setProblem} />}
      {at === "visibility" && <Visibility readOnly={onTeam} />}
      {at === "index" && <IndexAndInvites onChange={load} onTeam={onTeam} />}
      {at === "team" && superadmin && <Team />}
    </div>
  );
}
