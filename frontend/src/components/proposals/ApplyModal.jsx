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

function genId() {
  return (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + Math.random());
}

const BRIEF_EXTS = [".pdf", ".doc", ".docx", ".txt", ".rtf", ".md"];

/**
 * ApplyModal — submit a proposal to a business, against a request or unsolicited.
 *
 * Step machine:  signup? → upgrade? → choose → (upload | write) → preview → success
 *   - auth check runs before the plan check (an unauthenticated user should never
 *     see an "upgrade" prompt).
 *
 * props:
 *   recipientWorkspaceId  (required)
 *   recipientName
 *   request   optional { id, title, description, requirements: [{id,text,mandatory}] }
 *   onClose()
 *   onSubmitted(proposal)
 */
export default function ApplyModal({ recipientWorkspaceId, recipientName, request, onClose, onSubmitted }) {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const subscription = useAuthStore((s) => s.subscription);
  const platformGrants = useAuthStore((s) => s.platformGrants);
  const submitProposal = useMemo(() => (payload) => apiRequest("/proposals/submit", "POST", payload), []);
  const fetchActivity = useProposalStore((s) => s.fetchActivity);

  const currentPath = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/marketplace";
  const isLoggedIn = Boolean(token);
  // A paid plan OR an admin platform grant covering proposals — mirrors the
  // backend _can_submit_proposals check, which maps feature "proposal_section"
  // to module "blueprint" and matches any grant on that module.
  const hasProposalGrant = (platformGrants || []).some((g) => g.module_key === "blueprint");
  const canSubmit =
    hasPaidAccess(subscription?.plan_key, subscription?.status) || hasProposalGrant;
  const isUnsolicited = !request?.id;
  const requirements = request?.requirements || [];

  const [step, setStep] = useState(!isLoggedIn ? "signup" : !canSubmit ? "upgrade" : "choose");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const briefRef = useRef(null);
  const fileRef = useRef(null);

  const [form, setForm] = useState({
    title: request?.title ? `Proposal: ${request.title}` : "",
    summary: "",
    sections: [],
    responses: Object.fromEntries(requirements.map((r) => [r.id, ""])),
    attachments: [],
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // ── AI cover letter ──────────────────────────────────────────────────────
  async function generateCoverLetter() {
    setAiBusy(true);
    setError(null);
    try {
      const { cover_letter } = await apiRequest("/proposals/generate-cover-letter", "POST", {
        recipient_workspace_id: recipientWorkspaceId,
        recipient_name: recipientName || null,
        request_title: request?.title || null,
        request_description: request?.description || null,
        generation_id: genId(),
      });
      if (cover_letter) set({ summary: cover_letter });
    } catch (e) {
      setError(errText(e));
    } finally {
      setAiBusy(false);
    }
  }

  // ── Attachment upload ────────────────────────────────────────────────────
  async function uploadOne(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${getApiBaseUrl()}/proposals/upload-attachment`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || "Upload failed");
    return res.json();
  }

  async function addAttachments(files) {
    setError(null);
    for (const file of files) {
      try {
        const meta = await uploadOne(file);
        setForm((f) => ({ ...f, attachments: [...f.attachments, meta] }));
      } catch (e) {
        setError(errText(e));
      }
    }
  }

  // ── Upload-first flow: extract a brief, pre-fill the cover letter ─────────
  async function handleBriefFile(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!BRIEF_EXTS.some((ext) => name.endsWith(ext))) {
      setError("Upload a PDF, Word, or text document.");
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${getApiBaseUrl()}/proposals/extract-brief`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || "Could not read that file");
      const { text } = await res.json();
      // Keep the original file as an attachment too (best-effort).
      let meta = null;
      try { meta = await uploadOne(file); } catch { /* non-blocking */ }
      setForm((f) => ({
        ...f,
        summary: text || f.summary,
        attachments: meta ? [...f.attachments, meta] : f.attachments,
      }));
      setStep("write");
    } catch (e) {
      setError(errText(e));
    } finally {
      setExtracting(false);
    }
  }

  // ── Sections ─────────────────────────────────────────────────────────────
  const addSection = () => set({ sections: [...form.sections, { _k: genId(), heading: "", content: "" }] });
  const updateSection = (i, patch) => set({ sections: form.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const removeSection = (i) => set({ sections: form.sections.filter((_, j) => j !== i) });

  // ── Submit ───────────────────────────────────────────────────────────────
  const cleanSections = () =>
    form.sections
      .map((s) => ({ heading: (s.heading || "").trim(), content: (s.content || "").trim() }))
      .filter((s) => s.heading || s.content);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        recipient_workspace_id: recipientWorkspaceId,
        request_id: request?.id || null,
        title: form.title.trim() || null,
        summary: form.summary.trim() || null,
        sections: cleanSections(),
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
      const msg = errText(e);
      // Backend 402 — plan/grant check failed server-side (e.g. state changed
      // since the modal opened). Route to the upgrade gate rather than an alert.
      if (/HTTP 402/i.test(e?.message || "") || /Starter plan or above/i.test(msg)) {
        setStep("upgrade");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const mandatoryUnanswered = requirements.some((r) => r.mandatory && !(form.responses[r.id] || "").trim());
  const hasContent = form.summary.trim() || cleanSections().length > 0 || form.attachments.length > 0;

  function goPreview() {
    if (mandatoryUnanswered) { setError("Answer the required questions first."); return; }
    if (!hasContent) { setError("Add a cover letter, a section, or an attachment before previewing."); return; }
    setError(null);
    setStep("preview");
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const headerTitle = step === "success"
    ? "Proposal sent"
    : `Submit a proposal${recipientName ? ` to ${recipientName}` : ""}`;

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{headerTitle}</h2>
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
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Sign up for free first</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                You need a free EnterprateAI workspace to submit a proposal. It takes a minute, and you come straight back here.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button onClick={() => navigate(`/login?signup=1&next=${encodeURIComponent(currentPath)}`)}>Create free account</Button>
                <Button variant="secondary" onClick={() => navigate(`/login?next=${encodeURIComponent(currentPath)}`)}>Sign in</Button>
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

          {step === "choose" ? (
            <div className="py-2">
              <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">How would you like to start your proposal?</p>
              <input ref={briefRef} type="file" accept=".pdf,.doc,.docx,.txt,.rtf,.md" className="hidden" onChange={(e) => { handleBriefFile(e.target.files?.[0]); e.target.value = ""; }} />
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={extracting}
                  onClick={() => briefRef.current?.click()}
                  className="rounded-2xl border border-slate-200 p-4 text-left transition hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-brand-900/10"
                >
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                    {extracting ? <Spinner size={16} /> : (
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M12 18v-6M9 15h6" /></svg>
                    )}
                  </div>
                  <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{extracting ? "Reading your brief…" : "Upload a brief"}</div>
                  <div className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">We read a PDF, Word, or text file and pre-fill your cover letter.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("write")}
                  className="rounded-2xl border border-slate-200 p-4 text-left transition hover:border-brand-300 hover:bg-brand-50/40 dark:border-slate-700 dark:hover:bg-brand-900/10"
                >
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </div>
                  <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Write it myself</div>
                  <div className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">Start from a blank form with a cover letter, sections, and attachments.</div>
                </button>
              </div>
            </div>
          ) : null}

          {step === "write" ? (
            <div className="space-y-4 text-sm">
              <div>
                <div className="ea-label">
                  Proposal title <span className="font-normal text-slate-400">{isUnsolicited ? "(recommended)" : "(optional)"}</span>
                </div>
                <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="A short name for this proposal" />
                {isUnsolicited ? (
                  <div className="mt-1 text-[11px] text-slate-400">There's no request title for context, so this is how the recipient will identify your proposal.</div>
                ) : null}
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <div className="ea-label">Cover letter <span className="font-normal text-slate-400">(optional)</span></div>
                  <button type="button" className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400" onClick={generateCoverLetter} disabled={aiBusy}>
                    {aiBusy ? "Writing…" : "Draft with AI"}
                  </button>
                </div>
                <textarea rows={5} className="ea-input" value={form.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="A 3–4 sentence introduction: who you are and why you're a fit." />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <div className="ea-label">Proposal sections <span className="font-normal text-slate-400">(optional)</span></div>
                  <button type="button" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={addSection}>+ Add section</button>
                </div>
                {form.sections.length ? (
                  <div className="space-y-3">
                    {form.sections.map((s, i) => (
                      <div key={s._k || i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <div className="flex items-center gap-2">
                          <input
                            className="ea-input flex-1"
                            value={s.heading}
                            onChange={(e) => updateSection(i, { heading: e.target.value })}
                            placeholder="Section heading (e.g. Approach, Timeline, Pricing)"
                          />
                          <button type="button" className="shrink-0 text-slate-400 hover:text-rose-500" onClick={() => removeSection(i)}>
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                          </button>
                        </div>
                        <textarea
                          rows={3}
                          className="ea-input mt-2"
                          value={s.content}
                          onChange={(e) => updateSection(i, { content: e.target.value })}
                          placeholder="Section content"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-slate-400">Break your proposal into headed sections — approach, timeline, pricing, team, and so on.</p>
                )}
              </div>

              {requirements.length ? (
                <div className="space-y-3">
                  <div className="ea-label">Requirement responses</div>
                  {requirements.map((r) => (
                    <div key={r.id}>
                      <div className="mb-1 text-xs text-slate-600 dark:text-slate-300">
                        {r.text} {r.mandatory ? <span className="font-semibold text-rose-500">*</span> : null}
                      </div>
                      <textarea
                        rows={2}
                        className="ea-input"
                        value={form.responses[r.id] || ""}
                        onChange={(e) => set({ responses: { ...form.responses, [r.id]: e.target.value } })}
                        placeholder={r.mandatory ? "Required" : "Optional"}
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              <div>
                <div className="ea-label">Attachments <span className="font-normal text-slate-400">(optional)</span></div>
                <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addAttachments([...e.target.files]); e.target.value = ""; }} />
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
                <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                  {form.summary.trim() || <span className="text-slate-400">No cover letter</span>}
                </p>
              </div>
              {cleanSections().map((s, i) => (
                <div key={i}>
                  <div className="text-xs font-semibold text-slate-500">{s.heading || `Section ${i + 1}`}</div>
                  <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{s.content}</p>
                </div>
              ))}
              {requirements.filter((r) => (form.responses[r.id] || "").trim()).map((r) => (
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
                Track its status under <span className="font-medium text-slate-600 dark:text-slate-300">Financials → Proposals → Activity</span>.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={() => navigate("/financials?tab=proposals")}>Go to Proposals</Button>
                <Button variant="secondary" onClick={onClose}>Close</Button>
              </div>
            </div>
          ) : null}
        </div>

        {step === "choose" || step === "write" || step === "preview" ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4 dark:border-slate-700">
            {step === "choose" ? (
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
            ) : step === "preview" ? (
              <Button variant="secondary" onClick={() => setStep("write")}>Back</Button>
            ) : (
              <Button variant="secondary" onClick={() => setStep("choose")}>Back</Button>
            )}
            {step === "write" ? (
              <Button onClick={goPreview}>Preview</Button>
            ) : step === "preview" ? (
              <Button onClick={submit} disabled={busy}>{busy ? <Spinner size={14} /> : "Submit proposal"}</Button>
            ) : <span />}
          </div>
        ) : null}
      </div>
    </div>
  );
}
