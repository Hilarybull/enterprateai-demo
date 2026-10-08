import { useState } from "react";
import { addEvidence, attachEvidenceFile, attest, dateLabel, downloadEvidenceFile, readinessError, reviewEvidence } from "../../lib/readiness";
import { todayLocal } from "../../lib/format";
import { Btn, Notice, Pill, inputClass } from "./Fields";

// Evidence, and the reviewer confirmations that qualitative checks depend on. Evidence keeps
// the date it is from; reviewing it later never changes that date.

const TYPES = [["research", "Market research"], ["interview", "Customer interview"], ["enquiry", "Customer enquiry"], ["letter_of_intent", "Letter of intent"],
  ["pilot", "Pilot"], ["sale", "Sale"], ["document", "Document"], ["permission", "Permission or licence"], ["dry_run", "Test run"], ["record", "Business record"], ["other", "Other"]];

function checkOptions(subject) {
  return (subject.profile_definition?.criteria || []).flatMap((c) => c.checks.map((ch) => ({ code: ch.code, label: `${c.title}: ${ch.label}` })));
}

export function AddEvidence({ businessId, feature, subject, defaultCheck, onAdded, onCancel }) {
  const [form, setForm] = useState({ title: "", type: "research", claim: "", effective_date: "", expires_on: "", kind: "note", reference: "", check: defaultCheck || "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const item = await addEvidence(businessId, feature, {
        title: form.title, type: form.type, claim: form.claim, effective_date: form.effective_date || null, expires_on: form.expires_on || null,
        source: { kind: form.kind, reference: form.reference }, links: form.check ? [{ subject_id: subject.id, check: form.check }] : [],
      });
      if (file) await attachEvidenceFile(businessId, feature, item.id, file);
      onAdded(item);
    } catch (err) {
      setProblem(readinessError(err, "The evidence couldn't be saved. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const err = (k) => problem?.errors?.[k] && <p role="alert" className="mt-1 text-[12px] font-medium text-rose-600">{problem.errors[k]}</p>;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700" aria-label="Add evidence">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">What is it?
          <input className={`mt-1 ${inputClass}`} value={form.title} onChange={set("title")} placeholder="For example: 40 customer interviews" />{err("title")}
        </label>
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Type
          <select className={`mt-1 ${inputClass}`} value={form.type} onChange={set("type")}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="block text-[13px] font-semibold text-slate-800 sm:col-span-2 dark:text-slate-100">What does it show?
          <textarea rows={2} className={`mt-1 ${inputClass}`} value={form.claim} onChange={set("claim")} />
        </label>
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Date it is from
          <input type="date" max={todayLocal()} className={`mt-1 ${inputClass}`} value={form.effective_date} onChange={set("effective_date")} />{err("effective_date")}
        </label>
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Expires on (if it does)
          <input type="date" className={`mt-1 ${inputClass}`} value={form.expires_on} onChange={set("expires_on")} />{err("expires_on")}
        </label>
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Source
          <select className={`mt-1 ${inputClass}`} value={form.kind} onChange={set("kind")}>
            <option value="note">A note</option><option value="link">A web link</option><option value="record">A business record</option><option value="file">An attached file</option>
          </select>
        </label>
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">{form.kind === "link" ? "Web address" : "Where it can be found"}
          <input className={`mt-1 ${inputClass}`} value={form.reference} onChange={set("reference")} placeholder={form.kind === "link" ? "https://" : ""} />{err("source")}
        </label>
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Which check does it support?
          <select className={`mt-1 ${inputClass}`} value={form.check} onChange={set("check")}>
            <option value="">None yet</option>
            {checkOptions(subject).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>{err("links")}
        </label>
        <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Attach a file (optional)
          <input type="file" className="mt-1 block w-full text-[13px]" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <span className="mt-0.5 block text-[12px] font-normal text-slate-500">PDF, image, Word, Excel, CSV or text, up to 10 MB.</span>{err("file")}
        </label>
      </div>
      {problem && !Object.keys(problem.errors || {}).length && <Notice tone="rose" role="alert">{problem.message}</Notice>}
      <div className="flex gap-2">
        <Btn kind="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Add evidence"}</Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </form>
  );
}

function ReviewForm({ businessId, feature, item, onDone }) {
  const [verification, setVerification] = useState("self_attested");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  async function submit(exception) {
    setBusy(true);
    setProblem(null);
    try {
      await reviewEvidence(businessId, feature, item.id, exception ? { exception: true, rationale } : { verification, rationale });
      onDone();
    } catch (e) { setProblem(readinessError(e)); } finally { setBusy(false); }
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
      <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">How was it verified?
        <select className={`mt-1 ${inputClass}`} value={verification} onChange={(e) => setVerification(e.target.value)}>
          <option value="self_attested">Self-attested (reviewed by us)</option><option value="independently_reviewed">Independently reviewed</option>
          <option value="corroborated">Backed by records</option><option value="unverified">Not reviewed</option>
        </select>
      </label>
      <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Why (kept with the review)
        <textarea rows={2} className={`mt-1 ${inputClass}`} value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </label>
      {problem && <p role="alert" className="text-[12px] font-medium text-rose-600">{problem.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Btn kind="primary" disabled={busy} onClick={() => submit(false)}>Record review</Btn>
        {item.freshness?.state !== "current" && !item.expires_on && <Btn disabled={busy} onClick={() => submit(true)}>Keep it current, with this reason</Btn>}
      </div>
    </div>
  );
}

export function EvidenceList({ businessId, feature, subject, checks, onChanged, emptyText = "No evidence attached yet." }) {
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState(null);
  const [problem, setProblem] = useState(null);
  const can = subject.can || {};
  const editable = can[`${feature}.edit`] && subject.status !== "archived";
  const items = (subject.evidence || []).filter((e) => !checks || (e.links || []).some((l) => l.subject_id === subject.id && checks.includes(l.check)));
  const labels = Object.fromEntries(checkOptions(subject).map((o) => [o.code, o.label]));

  async function upload(item, file) {
    if (!file) return;
    setProblem(null);
    try { await attachEvidenceFile(businessId, feature, item.id, file); onChanged(); } catch (e) { setProblem(readinessError(e).message); }
  }
  async function fetchFile(item) {
    setProblem(null);
    try { await downloadEvidenceFile(businessId, item.id, item.file_name); } catch (e) { setProblem(e.message); }
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-[13px] text-slate-500">{emptyText}</p>}
      <ul className="space-y-2">
        {items.map((e) => (
          <li key={e.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{e.title}</p>
                <p className="text-[12px] text-slate-500">
                  {e.type_label} · dated {dateLabel(e.effective_date)}{e.expires_on ? ` · expires ${dateLabel(e.expires_on)}` : ""}
                  {e.strength ? ` · supports the claim: ${e.strength}` : ""}
                </p>
                {e.claim && <p className="mt-1 break-words text-[13px] text-slate-600 dark:text-slate-300">{e.claim}</p>}
                {e.source?.reference && <p className="mt-1 break-words text-[12px] text-slate-500">Source: {e.source.reference}</p>}
                {(e.links || []).filter((l) => l.subject_id === subject.id).map((l) => <p key={l.check} className="mt-1 text-[12px] text-slate-500">Supports: {labels[l.check] || l.check}</p>)}
              </div>
              <div className="flex flex-col items-end gap-1">
                <Pill tone={e.freshness?.state === "current" ? "emerald" : "amber"} mark={e.freshness?.state === "current" ? "✓" : "!"}>
                  {e.freshness?.state === "current" ? "Current" : e.freshness?.state === "expired" ? "Expired" : "Out of date"}
                </Pill>
                <Pill>{e.verification_label}</Pill>
              </div>
            </div>
            {e.freshness?.state !== "current" && <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">{e.freshness.reason} Until it is refreshed, checks that rely on it are treated as not known.</p>}
            {e.reviewed_at && <p className="mt-1 text-[12px] text-slate-500">Reviewed {dateLabel(e.reviewed_at)} by {e.reviewed_by}{e.review_rationale ? `: ${e.review_rationale}` : ""}</p>}
            {e.freshness_exception && <p className="mt-1 text-[12px] text-slate-500">Kept current by {e.freshness_exception.actor}: {e.freshness_exception.rationale}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
              {e.has_file && <Btn kind="link" className="text-[12px]" onClick={() => fetchFile(e)}>Download {e.file_name}</Btn>}
              {editable && (
                <label className="cursor-pointer font-semibold text-brand-600 underline-offset-2 hover:underline">
                  {e.has_file ? "Replace file" : "Attach a file"}
                  <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx" onChange={(ev) => upload(e, ev.target.files?.[0])} />
                </label>
              )}
              {can[`${feature}.review`] && <Btn kind="link" className="text-[12px]" onClick={() => setReviewing(reviewing === e.id ? null : e.id)}>{reviewing === e.id ? "Close" : "Record a review"}</Btn>}
            </div>
            {reviewing === e.id && <ReviewForm businessId={businessId} feature={feature} item={e} onDone={() => { setReviewing(null); onChanged(); }} />}
          </li>
        ))}
      </ul>
      {problem && <Notice tone="rose" role="alert">{problem}</Notice>}
      {editable && !adding && <Btn onClick={() => setAdding(true)}>Add evidence</Btn>}
      {adding && <AddEvidence businessId={businessId} feature={feature} subject={subject} defaultCheck={checks?.[0]} onCancel={() => setAdding(false)} onAdded={() => { setAdding(false); onChanged(); }} />}
    </div>
  );
}

/** A qualitative check: it passes only when an authorised person confirms it and says why. */
export function Attestation({ businessId, feature, subject, code, onChanged }) {
  const check = (subject.profile_definition?.criteria || []).flatMap((c) => c.checks).find((ch) => ch.code === code);
  const recorded = subject.data?.attestations?.[code];
  const assessed = (subject.assessment?.result?.criteria || []).flatMap((c) => c.checks).find((ch) => ch.code === code);
  const [open, setOpen] = useState(false);
  const [rationale, setRationale] = useState("");
  const [independent, setIndependent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const canReview = subject.can?.[`${feature}.review`] && subject.status !== "archived";
  if (!check) return null;

  async function submit(passed) {
    setBusy(true);
    setProblem(null);
    try {
      onChanged(await attest(businessId, feature, subject.id, { code, passed, rationale, independent }));
      setOpen(false);
      setRationale("");
    } catch (e) { setProblem(readinessError(e)); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Reviewer confirmation: {check.label}</p>
      {recorded ? (
        <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">
          <Pill tone={recorded.passed ? "emerald" : "rose"} mark={recorded.passed ? "✓" : "✕"}>{recorded.passed ? "Confirmed" : "Recorded as not in place"}</Pill>{" "}
          {recorded.independent ? "Independent review" : "Self-attested"} by {recorded.actor_name} on {dateLabel(recorded.at)}: {recorded.rationale}
        </p>
      ) : <p className="mt-1 text-[13px] text-slate-500">Not confirmed yet. Until someone confirms it, this check is treated as not known.</p>}
      {assessed?.stale && <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">{assessed.reason}</p>}
      {!canReview && <p className="mt-1 text-[12px] text-slate-500">Only the owner, or a member who can approve, can confirm this.</p>}
      {canReview && !open && <Btn className="mt-2" onClick={() => setOpen(true)}>{recorded ? "Review again" : "Review this"}</Btn>}
      {open && (
        <div className="mt-2 space-y-2">
          <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Your reasons (kept with the confirmation)
            <textarea rows={2} className={`mt-1 ${inputClass}`} value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={independent} onChange={(e) => setIndependent(e.target.checked)} />
            This is an independent review (not by the person who prepared it)
          </label>
          <p className="text-[12px] text-slate-500">If you created or filled in any of this yourself, your review is recorded as self-attested even when this is ticked.</p>
          {problem && <p role="alert" className="text-[12px] font-medium text-rose-600">{problem.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Btn kind="primary" disabled={busy} onClick={() => submit(true)}>Confirm it is in place</Btn>
            <Btn disabled={busy} onClick={() => submit(false)}>Record that it is not in place</Btn>
            <Btn kind="link" onClick={() => setOpen(false)}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
