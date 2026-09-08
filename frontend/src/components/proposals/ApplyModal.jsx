import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../Button";
import Input from "../Input";
import Spinner from "../Spinner";
import InlineAlert from "../InlineAlert";
import { useAuthStore } from "../../store/auth";
import { useProposalStore } from "../../store/proposals";
import { hasPaidAccess } from "../../lib/plans";
import { apiRequest, getApiBaseUrl } from "../../api/client";

function errText(e) {
  const m = e instanceof Error ? e.message : String(e || "");
  return m.replace(/^HTTP \d+:\s*/i, "") || "Something went wrong.";
}

/**
 * ApplyModal — submit a proposal to a business, optionally against a request.
 *
 * props:
 *   recipientWorkspaceId  (required)
 *   recipientName
 *   request               optional { id, title, description, requirements: [{id,text,mandatory}] }
 *   onClose()
 *   onSubmitted(proposal)
 */
export default function ApplyModal({ recipientWorkspaceId, recipientName, request, onClose, onSubmitted }) {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const subscription = useAuthStore((s) => s.subscription);
  const submitProposal = useMemo(() => (payload) => apiRequest("/proposals/submit", "POST", payload), []);
  const fetchActivity = useProposalStore((s) => s.fetchActivity);

  const isLoggedIn = Boolean(token);
  const canSubmit = hasPaidAccess(subscription?.plan_key, subscription?.status);

  const initialStep = !isLoggedIn ? "signup" : !canSubmit ? "upgrade" : "write";
  const [step, setStep] = useState(initialStep);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const fileRef = useRef(null);

  const [form, setForm] = useState({
    title: request?.title ? `Proposal: ${request.title}` : "",
    summary: "",
    responses: Object.fromEntries((request?.requirements || []).map((r) => [r.id, ""])),
    attachments: [],
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function generateCoverLetter() {
    setAiBusy(true);
    setError(null);
    try {
      const { cover_letter } = await apiRequest("/proposals/generate-cover-letter", "POST", {
        recipient_workspace_id: recipientWorkspaceId,
        recipient_name: recipientName || null,
        request_title: request?.title || null,
        request_description: request?.description || null,
        generation_id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      });
      if (cover_letter) set({ summary: cover_letter });
    } catch (e) {
      setError(errText(e));
    } finally {
      setAiBusy(false);
    }
  }

  async function uploadFiles(files) {
    setError(null);
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${getApiBaseUrl()}/proposals/upload-attachment`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || "Upload failed");
        const meta = await res.json();
        set({ attachments: [...form.attachments, meta] });
      } catch (e) {
        setError(errText(e));
      }
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        recipient_workspace_id: recipientWorkspaceId,
        request_id: request?.id || null,
        title: form.title.trim() || null,
        summary: form.summary.trim() || null,
        requirement_responses: Object.entries(form.responses)
          .filter(([, v]) => (v || "").trim())
          .map(([requirement_id, response]) => ({ requirement_id, response: response.trim() })),
        attachments: form.attachments,
      };
      const proposal = await submitProposal(payload);
      fetchActivity();
      setStep("success");
      onSubmitted?.(proposal);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const mandatoryUnanswered = (request?.requirements || []).some(
    (r) => r.mandatory && !(form.responses[r.id] || "").trim()
  );

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {step === "success" ? "Proposal sent" : `Submit a proposal${recipientName ? ` to ${recipientName}` : ""}`}
            </h2>
            {request?.title && step !== "success" ? (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">For “{request.title}”</p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? <div className="mb-3"><InlineAlert kind="error" message={error} /></div> : null}

          {step === "signup" ? (
            <div className="py-6 text-center">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Create a free account first</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                You need an EnterprateAI workspace to submit proposals. It only takes a minute.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={() => navigate("/login")}>Sign up / Sign in</Button>
                <Button variant="secondary" onClick={onClose}>Not now</Button>
              </div>
            </div>
          ) : null}

          {step === "upgrade" ? (
            <div className="py-6 text-center">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Upgrade to submit proposals</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                Submitting proposals is included from the Starter plan. Receiving proposals is always free.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={() => navigate("/pricing")}>See plans</Button>
                <Button variant="secondary" onClick={onClose}>Not now</Button>
              </div>
            </div>
          ) : null}

          {step === "write" ? (
            <div className="space-y-4 text-sm">
              <div>
                <div className="ea-label">Proposal title</div>
                <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="A short name for this proposal" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <div className="ea-label">Cover letter</div>
                  <button type="button" className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400" onClick={generateCoverLetter} disabled={aiBusy}>
                    {aiBusy ? "Writing…" : "Draft with AI"}
                  </button>
                </div>
                <textarea rows={5} className="ea-input" value={form.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="Introduce your business and why you're a fit." />
              </div>

              {(request?.requirements || []).length ? (
                <div className="space-y-3">
                  <div className="ea-label">Requirements</div>
                  {request.requirements.map((r) => (
                    <div key={r.id}>
                      <div className="mb-1 text-xs text-slate-600 dark:text-slate-300">
                        {r.text} {r.mandatory ? <span className="text-rose-500">*</span> : null}
                      </div>
                      <textarea
                        rows={2}
                        className="ea-input"
                        value={form.responses[r.id] || ""}
                        onChange={(e) => set({ responses: { ...form.responses, [r.id]: e.target.value } })}
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              <div>
                <div className="ea-label">Attachments</div>
                <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { uploadFiles([...e.target.files]); e.target.value = ""; }} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>Add files</Button>
                  {form.attachments.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                      {a.filename}
                      <button type="button" className="text-slate-400 hover:text-rose-500" onClick={() => set({ attachments: form.attachments.filter((_, j) => j !== i) })}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === "preview" ? (
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{form.title || "Proposal"}</div>
                <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300">{form.summary || <span className="text-slate-400">No cover letter</span>}</p>
              </div>
              {(request?.requirements || []).filter((r) => (form.responses[r.id] || "").trim()).map((r) => (
                <div key={r.id}>
                  <div className="text-xs font-semibold text-slate-500">{r.text}</div>
                  <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{form.responses[r.id]}</p>
                </div>
              ))}
              {form.attachments.length ? (
                <div className="text-xs text-slate-500">{form.attachments.length} attachment{form.attachments.length === 1 ? "" : "s"}</div>
              ) : null}
            </div>
          ) : null}

          {step === "success" ? (
            <div className="py-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
              </div>
              <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">Your proposal is on its way</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                Track its status any time under Proposals → Activity.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={() => navigate("/proposals?tab=activity")}>View activity</Button>
                <Button variant="secondary" onClick={onClose}>Close</Button>
              </div>
            </div>
          ) : null}
        </div>

        {step === "write" || step === "preview" ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4 dark:border-slate-700">
            {step === "preview" ? (
              <Button variant="secondary" onClick={() => setStep("write")}>Back</Button>
            ) : <span />}
            {step === "write" ? (
              <Button
                onClick={() => { if (mandatoryUnanswered) { setError("Answer the required questions first."); return; } setError(null); setStep("preview"); }}
                disabled={!form.summary.trim()}
              >
                Preview
              </Button>
            ) : (
              <Button onClick={submit} disabled={busy}>{busy ? <Spinner size={14} /> : "Submit proposal"}</Button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
