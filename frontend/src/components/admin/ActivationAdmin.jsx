import { useCallback, useEffect, useState } from "react";
import { AdminTable, Chip, KpiTile } from "./AdminUI";
import { Btn, Notice, Panel, inputClass } from "../readiness/Fields";
import { activationError, getActivation, getActivationDryRun, getActivationUser, notSetUp, recordPermission } from "../../lib/activation";
import { dateLabel } from "../../lib/readiness";

// Activation and education emails, for administrators: whether the job is on and for whom, what
// has gone out step by step, what it has changed (against people who were deliberately sent
// nothing), a dry run, and one user's journey with the evidence for emailing them. Nothing here
// shows what is inside anyone's business.

const STATE_TONE = { sent: "emerald", scheduled: "sky", sending: "sky", uncertain: "amber", cancelled: "slate", holdout: "slate", failed: "rose" };
/** For a step held until the sending hours: when they next begin, in that person's own time. */
function opens(row) {
  if (row.result !== "would_defer" || !row.until) return "";
  const zone = row.timezone || "Europe/London";
  let when;
  try { when = new Date(row.until).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: zone }); } catch { return ""; }
  return ` · next window opens ${when} ${zone.split("/").pop().replace(/_/g, " ")}`;
}

const WHY = { not_in_rollout: "Not in the current rollout", waiting_in_backlog: "Older account, waiting for its batch", journey_already_run: "Has already had this journey",
  already_in_journey: "Already in this journey", no_tip_due: "No tip is due", workspace_created: "Created a workspace", first_task_completed: "Completed a first task", unsubscribed: "Unsubscribed", suppressed: "Address suppressed", holdout: "In the holdout",
  no_permission_recorded: "No permission on record", not_verified: "Email not verified", no_longer_relevant: "No longer relevant", account_deleted: "Account deleted", recipient_rejected: "Address refused" };
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");

function Mode({ config }) {
  const text = !config.enabled ? "Switched off. Nothing is scheduled or sent."
    : config.dry_run ? "Dry run. Steps are scheduled and reported, but no email is sent." : "Live. Emails are being sent.";
  const who = config.cohort === "all" ? "all eligible accounts" : config.cohort === "sample" ? `${config.sample_percent}% of eligible accounts` : `${config.internal_accounts} internal account${config.internal_accounts === 1 ? "" : "s"}`;
  return (
    <Notice tone={!config.enabled ? "slate" : config.dry_run ? "amber" : "emerald"}>
      <span className="font-semibold">{text}</span> Rollout: {who}. {config.holdout_percent}% of them are held back and sent nothing, to measure what the emails change.
      {!config.one_click_unsubscribe && " One-click unsubscribe in mail clients is not set up yet (the link in each email still works)."}
    </Notice>
  );
}

function UserLookup() {
  const [email, setEmail] = useState("");
  const [found, setFound] = useState(null);
  const [state, setState] = useState({});
  const [evidence, setEvidence] = useState({ status: "subscribed", source: "" });
  async function look(e) {
    e?.preventDefault();
    setState({ busy: true });
    try { setFound(await getActivationUser(email.trim().toLowerCase())); setState({}); }
    catch (err) { setFound(null); setState({ problem: activationError(err, "That account couldn't be loaded.") }); }
  }
  async function record(e) {
    e.preventDefault();
    setState({ busy: true });
    try { setFound(await recordPermission(found.user.email, evidence.status, evidence.source)); setState({ saved: true }); setEvidence({ status: "subscribed", source: "" }); }
    catch (err) { setState({ problem: activationError(err, "That couldn't be saved.") }); }
  }
  const p = found?.permission;
  return (
    <Panel title="One user's journey" description="Steps, template versions, delivery, and the evidence for emailing them. Nothing from inside their business.">
      <form onSubmit={look} className="flex flex-wrap gap-2" aria-label="Find a user">
        <input type="email" aria-label="Account email" className={`${inputClass} max-w-sm`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" />
        <Btn kind="primary" type="submit" disabled={state.busy || !email.trim()}>Look up</Btn>
      </form>
      {state.problem && <p role="alert" className="mt-2 text-[13px] font-medium text-rose-600">{state.problem}</p>}
      {found && (
        <div className="mt-4 space-y-3">
          <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
            <div><dt className="font-semibold text-slate-700 dark:text-slate-200">May be emailed</dt><dd className="text-slate-600 dark:text-slate-300">{p.may_email ? "Yes" : `No: ${WHY[p.reason] || p.reason}`}</dd></div>
            <div><dt className="font-semibold text-slate-700 dark:text-slate-200">Permission</dt><dd className="break-words text-slate-600 dark:text-slate-300">{p.status}{p.source ? ` · ${p.source}` : ""}{p.collected_at ? ` · ${dateLabel(p.collected_at)}` : ""}</dd></div>
            <div><dt className="font-semibold text-slate-700 dark:text-slate-200">Verified</dt><dd className="text-slate-600 dark:text-slate-300">{found.user.verified ? `Yes${found.user.verified_at ? ` · ${dateLabel(found.user.verified_at)}` : ""}` : "No"} · {found.user.timezone}</dd></div>
            <div><dt className="font-semibold text-slate-700 dark:text-slate-200">Rollout</dt><dd className="text-slate-600 dark:text-slate-300">{found.cohort.in_rollout ? "In the current rollout" : "Not in the current rollout"}{found.cohort.holdout ? " · holdout (sent nothing)" : ""}</dd></div>
            {p.unsubscribed_at && <div><dt className="font-semibold text-slate-700 dark:text-slate-200">Unsubscribed</dt><dd className="text-slate-600 dark:text-slate-300">{dateLabel(p.unsubscribed_at)}</dd></div>}
            {p.suppression_reason && <div><dt className="font-semibold text-slate-700 dark:text-slate-200">Suppressed because</dt><dd className="text-slate-600 dark:text-slate-300">{p.suppression_reason}</dd></div>}
          </dl>
          <AdminTable caption="Journey steps" minWidth={680} rows={found.steps} rowKey={(s) => `${s.journey}-${s.step}`} emptyText="This account has not entered a journey." columns={[
            { key: "step", label: "Step", render: (s) => <><span className="font-semibold">{s.journey} · {s.step}</span><span className="block text-[12px] text-slate-500">{s.subject}</span></> },
            { key: "state", label: "State", render: (s) => <Chip tone={STATE_TONE[s.state] || "slate"}>{s.state}</Chip> },
            { key: "when", label: "Due / sent", tdClass: "whitespace-nowrap", render: (s) => (s.sent_at ? `Sent ${dateLabel(s.sent_at)}` : `Due ${dateLabel(s.due_at)}`) },
            { key: "delivery", label: "Delivery", render: (s) => s.delivery_status || "—" },
            { key: "why", label: "Stopped because", render: (s) => WHY[s.stopped_reason] || s.stopped_reason || "—" },
            { key: "version", label: "Template", render: (s) => s.template_version || "—" },
          ]} />
          <form onSubmit={record} aria-label="Record permission" className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Record permission for this account</p>
            <p className="text-[12px] text-slate-500">Only after checking the evidence. Creating an account is not permission. One account at a time, on purpose.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[180px_1fr_auto]">
              <select aria-label="Status" className={inputClass} value={evidence.status} onChange={(e) => setEvidence({ ...evidence, status: e.target.value })}>
                <option value="subscribed">Consent given</option><option value="soft_opt_in">Soft opt-in applies</option><option value="unsubscribed">Unsubscribed</option><option value="suppressed">Suppress</option>
              </select>
              <input aria-label="Evidence" className={inputClass} value={evidence.source} onChange={(e) => setEvidence({ ...evidence, source: e.target.value })} placeholder="Where and how it was given, e.g. sign-up form v2, 12 Sept" />
              <Btn type="submit" disabled={state.busy || evidence.source.trim().length < 5}>Record</Btn>
            </div>
            {state.saved && <p role="status" className="mt-2 text-[12px] text-slate-500">Recorded.</p>}
          </form>
        </div>
      )}
    </Panel>
  );
}

export default function ActivationAdmin() {
  const [board, setBoard] = useState(null);
  const [dry, setDry] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [asAt, setAsAt] = useState("");      // a local date and time to preview; empty means now
  const [missing, setMissing] = useState(false);
  const load = useCallback(() => getActivation().then((b) => { setBoard(b); setProblem(null); })
    .catch((e) => (notSetUp(e) ? setMissing(true) : setProblem(activationError(e, "The activation figures couldn't be loaded.")))), []);
  useEffect(() => { load(); }, [load]);
  async function runDry() {
    setBusy(true);
    const chosen = Boolean(asAt);      // kept with the result, so the wording describes the table on show and not the field
    try { setDry({ ...(await getActivationDryRun(chosen ? new Date(asAt).toISOString() : null)), chosen }); } catch (e) { setProblem(activationError(e, "The dry run couldn't be worked out.")); } finally { setBusy(false); }
  }
  if (missing) return <Notice tone="amber" role="alert"><span className="font-semibold">Activation emails aren't set up on this server: run migration 033.</span> Until then nothing is scheduled or sent, and people don't see the email tips setting.</Notice>;
  if (problem && !board) return <Notice tone="rose" role="alert">{problem}</Notice>;
  if (!board) return <p role="status" className="text-sm text-slate-500">Loading…</p>;
  const { emailed, holdout } = board;
  const preview = dry ? [...dry.selected.map((s) => ({ ...s, kind: "selector" })), ...dry.due.map((s) => ({ ...s, kind: "due" }))] : [];
  return (
    <div className="space-y-4">
      {problem && <Notice tone="rose" role="alert">{problem}</Notice>}
      <Mode config={board.config} />
      <section aria-label="Activation at a glance" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="May be emailed" value={board.eligible_users} hint="Verified, with permission on record" />
        <KpiTile label="No permission on record" value={board.no_permission_recorded} hint="Never emailed" />
        <KpiTile label="Eligible, no workspace" value={board.eligible_without_workspace} />
        <KpiTile label="Workspace in 7 days" value={pct(emailed.workspace_7d, emailed.users)} hint={`Holdout: ${pct(holdout.workspace_7d, holdout.users)}`} />
        <KpiTile label="Workspace in 14 days" value={pct(emailed.workspace_14d, emailed.users)} hint={`Holdout: ${pct(holdout.workspace_14d, holdout.users)}`} />
        <KpiTile label="First task in 14 days" value={pct(emailed.first_task_14d, emailed.users)} hint={`Holdout: ${pct(holdout.first_task_14d, holdout.users)}`} />
      </section>
      <p className="text-[12px] text-slate-500">Activation is read from workspaces and records, never from opens or clicks. Emailed: {emailed.users} accounts. Holdout: {holdout.users}.
        {" "}Guardrails: {board.guardrails.unsubscribed} unsubscribed, {board.guardrails.bounced} bounced, {board.guardrails.complained} complaints, {board.guardrails.suppressed} suppressed.</p>

      <section aria-label="By step" className="space-y-2">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">By step</h2>
        <AdminTable caption="Sends by step" minWidth={760} pageSize={20} rows={board.steps} rowKey={(s) => s.step} columns={[
          { key: "step", label: "Step", render: (s) => <><span className="font-semibold">{s.journey} · {s.step}</span><span className="block text-[12px] text-slate-500">{s.subject}</span></> },
          { key: "scheduled", label: "Waiting" }, { key: "sent", label: "Sent" }, { key: "delivered", label: "Delivered" },
          { key: "cancelled", label: "Stopped" }, { key: "holdout", label: "Holdout" },
          { key: "bad", label: "Bounced / complaints", render: (s) => `${s.bounced} / ${s.complained}` }, { key: "failed", label: "Failed" },
        ]} />
      </section>

      <Panel title="Dry run" description={`Who would be enrolled, stopped or emailed if the job ran ${(dry ? dry.chosen : asAt) ? "at the chosen time" : "now"}, and why. Nothing is written or sent.`} actions={(
          <>
            <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700 dark:text-slate-200">As at
              <input type="datetime-local" aria-label="As at" className={`${inputClass} !w-auto !py-1.5 !text-[13px]`} value={asAt} onChange={(e) => { setAsAt(e.target.value); setDry(null); }} />      {/* a different time: the old answer no longer applies */}
            </label>
            <Btn onClick={runDry} disabled={busy}>{busy ? "Working it out…" : "Run a dry run"}</Btn>
          </>
        )}>
        {dry && <p role="status" className="mb-2 text-[13px] text-slate-600 dark:text-slate-300">As at {new Date(dry.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} (your time). Emails only go between 09:00 and 18:00 where each person is.</p>}
        {dry && (
          <AdminTable caption="Dry run" minWidth={760} rows={preview} rowKey={(r, i) => i} emptyText={dry.chosen ? "Nothing would happen at that time." : "Nothing would happen right now."} columns={[
            { key: "user_id", label: "Account", render: (r) => <span title={r.user_id} className="block w-[260px] overflow-hidden text-ellipsis whitespace-nowrap">{r.user_id}</span> },
            { key: "what", label: "What", tdClass: "whitespace-nowrap", render: (r) => (r.kind === "selector" ? `${r.action}${r.journey ? ` journey ${r.journey}` : ""}${r.steps ? ` (${r.steps.join(", ")})` : ""}` : `${r.journey} · ${r.step}: ${String(r.result).replace(/_/g, " ")}`) },
            { key: "why", label: "Why", className: "w-full", render: (r) => `${WHY[r.why] || r.why}${opens(r)}` },
          ]} />
        )}
      </Panel>

      <UserLookup />

      <details className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <summary className="cursor-pointer text-base font-bold text-slate-900 dark:text-slate-100">Where the copy differs from the brief</summary>
        <ul className="mt-2 space-y-2 text-[13px] text-slate-600 dark:text-slate-300">
          {board.copy_notes.map((n) => <li key={n.step}><span className="font-semibold">{n.step}:</span> "{n.was}" became "{n.now}". {n.why}</li>)}
        </ul>
      </details>
    </div>
  );
}
