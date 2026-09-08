import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import SectionCard from "../SectionCard";
import SegmentedTabs from "../SegmentedTabs";
import Button from "../Button";
import Input from "../Input";
import Badge from "../Badge";
import Spinner from "../Spinner";
import InlineAlert from "../InlineAlert";
import ConfirmDialog from "../ConfirmDialog";
import { useProposalStore, PROPOSAL_ACTIVE_STATUSES } from "../../store/proposals";
import { useWorkspaceStore } from "../../store/workspace";
import { apiRequest } from "../../api/client";

// ── Status presentation ────────────────────────────────────────────────────
const STATUS_TONE = {
  SUBMITTED: "brand", VIEWED: "brand", UNDER_REVIEW: "brand",
  CLARIFICATION_REQUESTED: "warn", REVISION_REQUESTED: "warn",
  SHORTLISTED: "brand", PREFERRED: "brand", NEGOTIATION: "brand",
  AWARDED: "success", CONTRACT_DRAFTED: "success", CONTRACTED: "success",
  DECLINED: "danger", WITHDRAWN: "slate", EXPIRED: "slate", ARCHIVED: "slate",
};
const label = (s) => String(s || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// Recipient-driven transitions → button labels
const RECIPIENT_ACTIONS = {
  SUBMITTED: [["UNDER_REVIEW", "Start review"], ["DECLINED", "Decline"]],
  VIEWED: [["UNDER_REVIEW", "Start review"], ["DECLINED", "Decline"]],
  UNDER_REVIEW: [["SHORTLISTED", "Shortlist"], ["CLARIFICATION_REQUESTED", "Request clarification"], ["DECLINED", "Decline"]],
  CLARIFICATION_REQUESTED: [["UNDER_REVIEW", "Back to review"]],
  REVISION_REQUESTED: [["UNDER_REVIEW", "Back to review"], ["DECLINED", "Decline"]],
  SHORTLISTED: [["PREFERRED", "Mark preferred"], ["DECLINED", "Decline"]],
  PREFERRED: [["NEGOTIATION", "Move to negotiation"], ["DECLINED", "Decline"]],
  NEGOTIATION: [["AWARDED", "Award"], ["DECLINED", "Decline"]],
  AWARDED: [["CONTRACT_DRAFTED", "Draft contract"]],
  CONTRACT_DRAFTED: [["CONTRACTED", "Mark contracted"]],
};

function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONE[status] || "slate"}>{label(status)}</Badge>;
}

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function errText(e) {
  const m = e instanceof Error ? e.message : String(e || "");
  return m.replace(/^HTTP \d+:\s*/i, "") || "Something went wrong.";
}

// ── Proposal detail modal ─────────────────────────────────────────────────
function ProposalDetail({ proposal, role, onClose, onChanged }) {
  const transitionStatus = useProposalStore((s) => s.transitionStatus);
  const reviseProposal = useProposalStore((s) => s.reviseProposal);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState("");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseText, setReviseText] = useState(proposal.summary || "");
  const [full, setFull] = useState(proposal);

  useEffect(() => {
    // Opening as recipient marks it viewed / returns latest server state.
    let cancelled = false;
    apiRequest(`/proposals/${proposal.id}`, "GET")
      .then((d) => { if (!cancelled) { setFull(d); onChanged?.(d); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [proposal.id]); // eslint-disable-line

  const p = full;
  const actions = role === "recipient" ? (RECIPIENT_ACTIONS[p.status] || []) : [];
  const canWithdraw = role === "proposer" && PROPOSAL_ACTIVE_STATUSES.includes(p.status);
  const canRevise = role === "proposer" && p.status === "CLARIFICATION_REQUESTED";

  async function move(target) {
    setBusy(target);
    setError(null);
    try {
      const row = await transitionStatus(p.id, target, reason.trim() || null);
      setFull((prev) => ({ ...prev, ...row }));
      setReason("");
      onChanged?.(row);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function submitRevision() {
    setBusy("revise");
    setError(null);
    try {
      const row = await reviseProposal(p.id, { summary: reviseText, note: reason.trim() || null });
      setFull((prev) => ({ ...prev, ...row }));
      setReviseOpen(false);
      setReason("");
      onChanged?.(row);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {p.title || p.request_title || "Proposal"}
              </h2>
              <StatusBadge status={p.status} />
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {role === "recipient" ? `From ${p.proposer_name}` : `To ${p.recipient_name}`}
              {" · "}Submitted {fmtDate(p.submitted_at)}
              {p.version > 1 ? ` · v${p.version}` : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {role === "recipient" && p.proposer_email ? (
            <div className="text-xs text-slate-500 dark:text-slate-400">Contact: {p.proposer_email}</div>
          ) : null}

          {p.summary ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Cover letter</div>
              <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{p.summary}</p>
            </div>
          ) : null}

          {(p.sections || []).map((sec, i) => (
            <div key={i}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{sec.heading || `Section ${i + 1}`}</div>
              <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{sec.content}</p>
            </div>
          ))}

          {(p.requirement_responses || []).length ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Requirement responses</div>
              <ul className="space-y-2">
                {p.requirement_responses.map((r, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 p-2 text-slate-700 dark:border-slate-700 dark:text-slate-300">
                    {r.response}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {(p.attachments || []).length ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Attachments</div>
              <ul className="space-y-1">
                {p.attachments.map((a, i) => (
                  <li key={i}>
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline dark:text-brand-400">
                      {a.filename || `Attachment ${i + 1}`}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {(p.events || []).length ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">History</div>
              <ol className="space-y-1.5 border-l border-slate-200 pl-3 dark:border-slate-700">
                {p.events.map((ev, i) => (
                  <li key={i} className="text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{label(ev.status)}</span>
                    {" · "}{ev.actor}{" · "}{fmtDate(ev.timestamp)}
                    {ev.reason ? <div className="text-slate-500">{ev.reason}</div> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>

        {(actions.length || canWithdraw || canRevise) ? (
          <div className="space-y-2 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
            {error ? <InlineAlert kind="error" message={error} /> : null}
            {(actions.length || reviseOpen) ? (
              <input
                className="ea-input"
                placeholder="Optional note to the other party"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            ) : null}
            {reviseOpen ? (
              <textarea
                rows={4}
                className="ea-input"
                placeholder="Updated cover letter / clarification"
                value={reviseText}
                onChange={(e) => setReviseText(e.target.value)}
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              {actions.map(([target, text]) => (
                <Button
                  key={target}
                  size="sm"
                  variant={target === "DECLINED" ? "danger" : "primary"}
                  disabled={busy != null}
                  onClick={() => move(target)}
                >
                  {busy === target ? <Spinner size={14} /> : text}
                </Button>
              ))}
              {canRevise && !reviseOpen ? (
                <Button size="sm" onClick={() => setReviseOpen(true)}>Submit revision</Button>
              ) : null}
              {reviseOpen ? (
                <>
                  <Button size="sm" disabled={busy != null} onClick={submitRevision}>
                    {busy === "revise" ? <Spinner size={14} /> : "Send revision"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setReviseOpen(false)}>Cancel</Button>
                </>
              ) : null}
              {canWithdraw ? (
                <Button size="sm" variant="secondary" disabled={busy != null} onClick={() => move("WITHDRAWN")}>
                  {busy === "WITHDRAWN" ? <Spinner size={14} /> : "Withdraw"}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Inbox tab ─────────────────────────────────────────────────────────────
function InboxTab() {
  const { inbox, inboxLoading, inboxError, fetchInbox, removeFromInbox, linkToRequest } = useProposalStore();
  const requests = useProposalStore((s) => s.requests);
  const fetchRequests = useProposalStore((s) => s.fetchRequests);
  const [open, setOpen] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [linkFor, setLinkFor] = useState(null);

  useEffect(() => { fetchInbox(); fetchRequests(); }, []); // eslint-disable-line

  if (inboxLoading) return <div className="flex justify-center py-10"><Spinner size={22} /></div>;
  if (inboxError) return <InlineAlert kind="error" message={inboxError} />;
  if (!inbox.length) {
    return <p className="py-8 text-center text-sm text-slate-500">No proposals received yet. Publish a request to attract submissions.</p>;
  }

  return (
    <div className="space-y-2">
      {inbox.map((p) => (
        <div key={p.id} className="ea-card p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <button type="button" className="min-w-0 text-left" onClick={() => setOpen(p)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{p.proposer_name}</span>
                <StatusBadge status={p.status} />
                {p.status === "SUBMITTED" && !p.viewed_at ? <Badge tone="brand">New</Badge> : null}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {p.title || p.request_title || "Unsolicited proposal"} · {fmtDate(p.submitted_at)}
              </div>
            </button>
            <div className="flex shrink-0 gap-1.5">
              {!p.request_id ? (
                <Button size="sm" variant="ghost" onClick={() => setLinkFor(p)}>Link to request</Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(p)}>Remove</Button>
            </div>
          </div>
        </div>
      ))}

      {open ? (
        <ProposalDetail
          proposal={open}
          role="recipient"
          onClose={() => setOpen(null)}
          onChanged={() => fetchInbox()}
        />
      ) : null}

      {linkFor ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setLinkFor(null); }}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Link to a request</h3>
            <div className="space-y-1.5">
              {requests.filter((r) => r.status !== "DRAFT").map((r) => (
                <button
                  key={r.id}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  onClick={async () => { await linkToRequest(linkFor.id, r.id); setLinkFor(null); }}
                >
                  {r.title}
                </button>
              ))}
              {!requests.filter((r) => r.status !== "DRAFT").length ? (
                <p className="text-xs text-slate-500">No published requests to link to.</p>
              ) : null}
            </div>
            <div className="mt-3 text-right">
              <Button size="sm" variant="secondary" onClick={() => setLinkFor(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmRemove ? (
        <ConfirmDialog
          message="Hide this proposal from your inbox? The proposer keeps their copy."
          confirmLabel="Remove"
          danger
          onConfirm={async () => { await removeFromInbox(confirmRemove.id); setConfirmRemove(null); }}
          onCancel={() => setConfirmRemove(null)}
        />
      ) : null}
    </div>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────
function ActivityTab() {
  const { activity, activityLoading, activityError, fetchActivity } = useProposalStore();
  const [open, setOpen] = useState(null);

  useEffect(() => { fetchActivity(); }, []); // eslint-disable-line

  if (activityLoading) return <div className="flex justify-center py-10"><Spinner size={22} /></div>;
  if (activityError) return <InlineAlert kind="error" message={activityError} />;
  if (!activity.length) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        You haven't submitted any proposals yet.{" "}
        <Link to="/marketplace/requests" className="text-brand-600 hover:underline dark:text-brand-400">Browse open requests</Link>.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {activity.map((p) => (
        <button key={p.id} type="button" className="ea-card block w-full p-3 text-left sm:p-4" onClick={() => setOpen(p)}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{p.recipient_name}</span>
            <StatusBadge status={p.status} />
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {p.title || p.request_title || "Unsolicited proposal"} · {fmtDate(p.submitted_at)}
            {p.version > 1 ? ` · v${p.version}` : ""}
          </div>
        </button>
      ))}
      {open ? (
        <ProposalDetail proposal={open} role="proposer" onClose={() => setOpen(null)} onChanged={() => fetchActivity()} />
      ) : null}
    </div>
  );
}

// ── Request form ──────────────────────────────────────────────────────────
const EMPTY_REQUEST = {
  title: "", description: "", type: "general", budget_range: "", budget_currency: "GBP",
  budget_visible: false, deadline: "", submission_cap: "", visibility: "marketplace",
  requirements: [],
};

function RequestForm({ initial, onSaved, onCancel }) {
  const createRequest = useProposalStore((s) => s.createRequest);
  const updateRequest = useProposalStore((s) => s.updateRequest);
  const [form, setForm] = useState(() => ({ ...EMPTY_REQUEST, ...(initial || {}), requirements: (initial?.requirements || []).map((r) => ({ ...r })) }));
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState(null);
  const editing = !!initial?.id;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function generateDescription() {
    if (!form.title.trim()) { setError("Add a title first."); return; }
    setAiBusy(true);
    try {
      const { description } = await apiRequest("/proposals/generate-description", "POST", { title: form.title.trim() });
      if (description) set({ description });
    } catch { /* non-blocking */ } finally { setAiBusy(false); }
  }

  async function save() {
    if (!form.title.trim()) { setError("A title is required."); return; }
    setBusy(true);
    setError(null);
    const payload = {
      type: form.type,
      title: form.title.trim(),
      description: form.description || null,
      budget_range: form.budget_range || null,
      budget_currency: form.budget_currency || null,
      budget_visible: !!form.budget_visible,
      deadline: form.deadline || null,
      submission_cap: form.submission_cap ? Number(form.submission_cap) : null,
      visibility: form.visibility,
      requirements: (form.requirements || []).filter((r) => (r.text || "").trim()).map((r) => ({
        id: r.id, text: r.text.trim(), mandatory: !!r.mandatory, weight: Number(r.weight) || 1,
      })),
    };
    try {
      const row = editing ? await updateRequest(initial.id, payload) : await createRequest(payload);
      onSaved(row);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title={editing ? "Edit request" : "New proposal request"}>
      <div className="space-y-3">
        {error ? <InlineAlert kind="error" message={error} /> : null}
        <div>
          <div className="ea-label">Title</div>
          <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Brand refresh for a fintech startup" />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <div className="ea-label">Description</div>
            <button type="button" className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400" onClick={generateDescription} disabled={aiBusy}>
              {aiBusy ? "Generating…" : "Draft with AI"}
            </button>
          </div>
          <textarea rows={4} className="ea-input" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What you need, context, and how proposals will be judged." />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="ea-label">Type</div>
            <select className="ea-input" value={form.type} onChange={(e) => set({ type: e.target.value })}>
              {["general", "technical", "financial", "creative", "consulting"].map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </div>
          <div>
            <div className="ea-label">Deadline</div>
            <Input type="date" value={form.deadline || ""} onChange={(e) => set({ deadline: e.target.value })} />
          </div>
          <div>
            <div className="ea-label">Budget (optional)</div>
            <Input value={form.budget_range} onChange={(e) => set({ budget_range: e.target.value })} placeholder="e.g. £10k–£20k" />
          </div>
          <div>
            <div className="ea-label">Max submissions (optional)</div>
            <Input type="number" min="1" value={form.submission_cap} onChange={(e) => set({ submission_cap: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.budget_visible} onChange={(e) => set({ budget_visible: e.target.checked })} />
            Show budget to proposers
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.visibility === "private"} onChange={(e) => set({ visibility: e.target.checked ? "private" : "marketplace" })} />
            Invite-only (hide from marketplace)
          </label>
        </div>

        <div>
          <div className="ea-label">Requirements</div>
          <div className="space-y-2">
            {(form.requirements || []).map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="ea-input flex-1"
                  value={r.text}
                  onChange={(e) => set({ requirements: form.requirements.map((x, j) => j === i ? { ...x, text: e.target.value } : x) })}
                  placeholder="e.g. Minimum 3 years in B2B SaaS"
                />
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  <input type="checkbox" checked={!!r.mandatory} onChange={(e) => set({ requirements: form.requirements.map((x, j) => j === i ? { ...x, mandatory: e.target.checked } : x) })} />
                  Required
                </label>
                <button type="button" className="text-slate-400 hover:text-rose-500" onClick={() => set({ requirements: form.requirements.filter((_, j) => j !== i) })}>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => set({ requirements: [...(form.requirements || []), { text: "", mandatory: false, weight: 1 }] })}>
              Add requirement
            </Button>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button onClick={save} disabled={busy}>{busy ? <Spinner size={14} /> : editing ? "Save changes" : "Create request"}</Button>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ── Requests tab ──────────────────────────────────────────────────────────
function RequestsTab() {
  const { requests, requestsLoading, requestsError, fetchRequests, requestAction, deleteRequest, inviteToRequest } = useProposalStore();
  const [editing, setEditing] = useState(null); // request obj or "new" or null
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [inviteFor, setInviteFor] = useState(null);
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteResult, setInviteResult] = useState(null);
  const [rowError, setRowError] = useState(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => { fetchRequests(); }, []); // eslint-disable-line

  async function act(id, action) {
    setRowError(null);
    try { await requestAction(id, action); }
    catch (e) { setRowError(errText(e)); }
  }

  if (editing) {
    return (
      <RequestForm
        initial={editing === "new" ? null : editing}
        onSaved={() => setEditing(null)}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <p className="text-sm text-slate-500">Publish a brief and receive structured proposals.</p>
        <Button size="sm" onClick={() => setEditing("new")}>New request</Button>
      </div>
      {rowError ? <InlineAlert kind="error" message={rowError} /> : null}
      {requestsError ? <InlineAlert kind="error" message={requestsError} /> : null}
      {requestsLoading ? (
        <div className="flex justify-center py-10"><Spinner size={22} /></div>
      ) : !requests.length ? (
        <p className="py-8 text-center text-sm text-slate-500">No requests yet.</p>
      ) : (
        requests.map((r) => (
          <div key={r.id} className="ea-card p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{r.title}</span>
                  <Badge tone={r.status === "PUBLISHED" ? "success" : r.status === "CLOSED" ? "slate" : "warn"}>{label(r.status)}</Badge>
                  {r.visibility === "private" ? <Badge tone="slate">Invite-only</Badge> : null}
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {r.submission_count} submission{r.submission_count === 1 ? "" : "s"}
                  {r.deadline ? ` · closes ${fmtDate(r.deadline)}` : ""}
                  {r.submission_cap ? ` · cap ${r.submission_cap}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {r.status === "DRAFT" ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
                    <Button size="sm" onClick={() => act(r.id, "publish")}>Publish</Button>
                  </>
                ) : null}
                {r.status === "PUBLISHED" ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(`${origin}/marketplace/request/${r.id}`); }}>Copy link</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setInviteFor(r); setInviteEmails(""); setInviteResult(null); }}>Invite</Button>
                    <Button size="sm" variant="secondary" onClick={() => act(r.id, "close")}>Close</Button>
                  </>
                ) : null}
                {r.status === "CLOSED" ? (
                  <Button size="sm" onClick={() => act(r.id, "reopen")}>Reopen</Button>
                ) : null}
                {r.status !== "PUBLISHED" ? (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r)}>Delete</Button>
                ) : null}
              </div>
            </div>
          </div>
        ))
      )}

      {inviteFor ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setInviteFor(null); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <h3 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Invite proposers</h3>
            <p className="mb-2 text-xs text-slate-500">They get an email with a link to “{inviteFor.title}”.</p>
            <textarea rows={3} className="ea-input" placeholder="name@company.com, another@company.com" value={inviteEmails} onChange={(e) => setInviteEmails(e.target.value)} />
            {inviteResult ? (
              <p className="mt-2 text-xs text-slate-500">
                Sent to {inviteResult.sent.length}. {inviteResult.failed.length ? `Failed: ${inviteResult.failed.join(", ")}` : ""}
              </p>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setInviteFor(null)}>Close</Button>
              <Button
                size="sm"
                onClick={async () => {
                  const emails = inviteEmails.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
                  if (!emails.length) return;
                  try {
                    const res = await inviteToRequest(inviteFor.id, emails);
                    setInviteResult(res);
                  } catch (e) { setInviteResult({ sent: [], failed: [errText(e)] }); }
                }}
              >
                Send invites
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          message="Permanently delete this request? Submissions already received are kept."
          confirmLabel="Delete"
          danger
          onConfirm={async () => { await deleteRequest(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────
function SettingsTab() {
  const { preferences, preferencesLoading, preferencesError, fetchPreferences, savePreferences } = useProposalStore();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { fetchPreferences(); }, []); // eslint-disable-line
  useEffect(() => { if (preferences) setForm(preferences); }, [preferences]);

  if (preferencesLoading || !form) return <div className="flex justify-center py-10"><Spinner size={22} /></div>;

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setSaved(false); };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await savePreferences({
        enabled: !!form.enabled,
        accepted_modes: form.accepted_modes?.length ? form.accepted_modes : ["general"],
        accepted_categories: form.accepted_categories || null,
        proposal_cap: form.proposal_cap ? Number(form.proposal_cap) : null,
        visibility: form.visibility || "marketplace",
      });
      setSaved(true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const MODES = ["general", "technical", "financial", "creative", "consulting"];

  return (
    <SectionCard title="Proposal preferences" subtitle="Control whether other businesses can send you proposals.">
      <div className="space-y-4">
        {error ? <InlineAlert kind="error" message={error} /> : null}
        {preferencesError ? <InlineAlert kind="error" message={preferencesError} /> : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span className="font-medium">Accept proposals from other businesses</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.visibility === "private"}
            onChange={(e) => set({ visibility: e.target.checked ? "private" : "marketplace" })}
          />
          Keep my workspace off the public marketplace (link/invite only)
        </label>
        <div>
          <div className="ea-label">Proposal types I accept</div>
          <div className="flex flex-wrap gap-3 text-sm">
            {MODES.map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={(form.accepted_modes || []).includes(m)}
                  onChange={(e) => set({
                    accepted_modes: e.target.checked
                      ? [...(form.accepted_modes || []), m]
                      : (form.accepted_modes || []).filter((x) => x !== m),
                  })}
                />
                {label(m)}
              </label>
            ))}
          </div>
        </div>
        <div className="max-w-[220px]">
          <div className="ea-label">Max concurrent proposals (optional)</div>
          <Input type="number" min="1" value={form.proposal_cap || ""} onChange={(e) => set({ proposal_cap: e.target.value })} />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>{busy ? <Spinner size={14} /> : "Save preferences"}</Button>
          {saved ? <span className="text-sm text-emerald-600">Saved</span> : null}
        </div>
      </div>
    </SectionCard>
  );
}

// ── Panel (rendered as a tab inside Financials) ───────────────────────────
export default function ProposalsPanel() {
  const [tab, setTab] = useState("inbox");
  const inboxUnread = useProposalStore((s) => s.inboxUnread);
  const fetchInbox = useProposalStore((s) => s.fetchInbox);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  useEffect(() => { fetchInbox(); }, [workspaceId]); // eslint-disable-line

  const options = useMemo(() => ([
    { value: "inbox", label: inboxUnread ? `Inbox (${inboxUnread})` : "Inbox" },
    { value: "activity", label: "Activity" },
    { value: "requests", label: "Requests" },
    { value: "settings", label: "Settings" },
  ]), [inboxUnread]);

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        Receive structured proposals for your requests, and submit proposals to other businesses.
      </p>
      <div className="max-w-md"><SegmentedTabs value={tab} onChange={setTab} options={options} size="sm" /></div>
      <div className="mt-4">
        {tab === "inbox" ? <InboxTab /> : null}
        {tab === "activity" ? <ActivityTab /> : null}
        {tab === "requests" ? <RequestsTab /> : null}
        {tab === "settings" ? <SettingsTab /> : null}
      </div>
    </div>
  );
}
