import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";
import { getPath, setPath } from "../../lib/readiness";
import { Field } from "../readiness/Fields";
import ThinkingProgress from "./ThinkingProgress";
import { RequiredDocuments } from "../readiness/Panels";
import ForecastEditor from "../readiness/ForecastEditor";
import { Attestation, EvidenceList } from "../readiness/Evidence";

const button = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const primary = "min-h-11 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50";
const cardStyle = "min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white";
const headerStyle = "border-b border-slate-100 bg-slate-50 px-4 py-3";
const bodyStyle = "whitespace-pre-line break-words px-4 py-3 leading-6 text-slate-700";
const footerStyle = "flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3";
const clean = text => String(text || "").replace(/\bId:\s*[a-f\d-]{10,};?\s*/gi, "");
const normalized = text => String(text || "").toLowerCase().replace(/[_\s]+/g, " ").trim();
const draftPath = (subject, draft) => draft.path || (subject.profile_definition?.sections || []).flatMap(s => s.fields || [])
  .find(field => normalized(field.label) === normalized(draft.label) || normalized(field.key.split(".").at(-1)) === normalized(draft.label))?.key;

export default function ReadinessTasks({ item: initialItem, businessId, busy, onSend, onUpdated }) {
  const [hydrated, setHydrated] = useState(null);
  const [panel, setPanel] = useState(null);
  const item = hydrated && (!initialItem.revision || hydrated.revision >= initialItem.revision) ? hydrated : initialItem;
  useEffect(() => {
    let live = true;
    apiRequest(`/businesses/${encodeURIComponent(businessId)}/agent/readiness-items/${initialItem.topic}/${encodeURIComponent(initialItem.case_id)}`)
      .then(card => { if (live && card?.type === "readiness_tasks") setHydrated(card); }).catch(() => {});
    return () => { live = false; };
  }, [businessId, initialItem.case_id, initialItem.topic, initialItem.revision]);
  const keyFor = (target, draft = false) => draft ? `draft:${target.path || target.label}` : `step:${target.code || target.title}`;
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [drafting, setDrafting] = useState(null);
  const base = `/businesses/${encodeURIComponent(businessId)}/${item.topic === "launch" ? "launch-initiatives" : "funding-cases"}/${encodeURIComponent(item.case_id)}`;
  const locked = busy || saving || drafting !== null;
  async function agentHelp(step, index, draft = false) {
    setProblem(""); setNote(""); setDrafting(index);
    if (draft) step = { ...step, title: `Edit ${step.label}`, detail: `Current proposed value: ${step.value}` };
    try {
      await onSend(`Help me resolve this ${item.topic} item: ${step.title}.${step.detail ? ` The issue is: ${step.detail}` : ""} Use my saved business data and existing research. Show any proposed changes for review. If information is missing, ask me for what you need.`,
        { readinessItem: { topic: item.topic, case_id: item.case_id, title: step.title, detail: step.detail || "", section: step.section || "", ...(draft ? { path: step.path } : {}) } });
    } catch (error) { setProblem(error.message || "I couldn't start work on this item. Try again."); }
    finally { setDrafting(null); }
  }
  async function refresh() {
    const card = await apiRequest(`/businesses/${encodeURIComponent(businessId)}/agent/readiness-items/${item.topic}/${encodeURIComponent(item.case_id)}`);
    if (card?.type === "readiness_tasks") setHydrated(card);
    onUpdated?.(card);
  }
  async function openReview(target, draft = false) {
    setSaving(true); setProblem(""); setEditor(null);
    try {
      const card = await apiRequest(`/businesses/${encodeURIComponent(businessId)}/agent/readiness-items/${item.topic}/${encodeURIComponent(item.case_id)}`);
      if (card?.type === "readiness_tasks") { setHydrated(card); onUpdated?.(card); }
      setPanel({key:keyFor(target,draft),mode:"review"});
    } catch (error) { setProblem(error.message || "The latest values couldn't load. Try again."); }
    finally { setSaving(false); }
  }
  async function edit(target, draft = false) {
    setProblem(""); setNote(""); setSaving(true);
    try {
      const editorKey = keyFor(target, draft);
      const subject = await apiRequest(base);
      const sections = subject.profile_definition?.sections || [];
      const liveItem = (subject.actions || []).find(action => action.title === target.title);
      const section = target.section || liveItem?.section || liveItem?.tool?.section;
      const code = liveItem?.code || target.code;
      let review = item.topic === "funding" && ["C8.A", "G4"].includes(code) ? "documents"
        : ["C3.A", "C3.B", "G3"].includes(code) || section === "cash" ? "forecast"
        : sections.some(s => (s.attest || []).includes(code)) ? "attestation"
        : sections.some(s => (s.evidence || []).includes(code)) ? "evidence" : null;
      if (review === "attestation" && !target.has_values && !sections.some(s => (s.attest || []).includes(code) && s.evidence?.length)) review = null;
      if (!draft && review) {
        setEditor({ key: editorKey, target, subject, review, code, fields: [], changes: {} }); setPanel(null); return;
      }
      if (draft) target = { ...target, path: draftPath(subject, target) };
      const fields = draft ? sections.flatMap(s => s.fields || []).filter(f => f.key === target.path)
        : sections.filter(s => s.key === section).flatMap(s => s.fields || []);
      if (!fields.length) throw new Error("These details need a guided answer. Tell me which part you want to update in the chat.");
      let data = { ...subject.data, agent_drafts: {} };
      if (draft && subject.data?.agent_drafts?.[target.path]) data = setPath(data, target.path, subject.data.agent_drafts[target.path].value);
      setEditor({ key: editorKey, target, subject, fields, data, changes: {}, draft }); setPanel(null);
    } catch (e) { setProblem(e.message || "The inputs couldn't load. Try again."); }
    finally { setSaving(false); }
  }
  async function save() {
    setSaving(true); setProblem("");
    try {
      const drafts = editor.subject.data?.agent_drafts || {};
      const changes = editor.draft ? { agent_drafts: { ...drafts, [editor.target.path]: { ...drafts[editor.target.path], value: getPath(editor.data, editor.target.path), source: "Edited by you; awaiting approval" } } }
        : { ...editor.changes, agent_drafts: Object.fromEntries(Object.entries(drafts).filter(([path]) => !editor.fields.some(field => field.key === path && getPath(editor.changes, path) !== undefined))) };
      await apiRequest(base, "PATCH", { revision: editor.subject.revision, changes });
      setEditor(null); setNote(editor.draft ? "Draft updated. Review it before approving." : "Your changes are saved.");
      if (!editor.draft) await apiRequest(`${base}/assessments`, "POST", {});
      await refresh();
    } catch (e) { setProblem(e.message || "Your changes couldn't be saved. Try again."); }
    finally { setSaving(false); }
  }
  async function decide(draft, approve) {
    setSaving(true); setProblem(""); setNote("");
    try {
      const subject = await apiRequest(base);
      if (item.revision != null && item.revision !== subject.revision) throw new Error("These values changed. Refresh and review the latest draft before deciding.");
      draft = { ...draft, path: draftPath(subject, draft) };
      if (!draft.path) { onSend(`${approve ? "Approve" : "Reject"} the ${draft.label} draft on my ${item.topic} case`); return; }
      const held = subject.data?.agent_drafts || {};
      if (!held[draft.path]) { await refresh(); return; }
      let changes = { agent_drafts: Object.fromEntries(Object.entries(held).filter(([p]) => p !== draft.path)) };
      if (approve) {
        changes = setPath(changes, draft.path, held[draft.path].value);
        if (draft.path === "receipt_date") changes.timing_confirmed = true;
        if (draft.path === "milestones") {
          const first = (held[draft.path].value || []).find(m => m?.id)?.id;
          if (first && !subject.data.purpose_milestone_id) changes.purpose_milestone_id = first;
          if (first && !subject.data.market?.acquisition_milestone_id) changes = setPath(changes, "market.acquisition_milestone_id", first);
        }
      } else changes.rejected_drafts = [...new Set([...(subject.data.rejected_drafts || []), draft.path])];
      await apiRequest(base, "PATCH", { revision: subject.revision, changes });
      setNote(approve ? "Draft approved and saved." : "Draft rejected.");
      await apiRequest(`${base}/assessments`, "POST", {});
      await refresh();
    } catch (e) { setProblem(e.message || "That decision couldn't be saved. Try again."); }
    finally { setSaving(false); }
  }
  async function decideStep(step, approve) {
    setSaving(true); setProblem(""); setNote("");
    try {
      const result = await apiRequest(`/businesses/${encodeURIComponent(businessId)}/agent/readiness-items/${item.topic}/${encodeURIComponent(item.case_id)}/decision`, "POST", {code: step.code, revision: item.revision, approve});
      setPanel(null); setEditor(null); setNote(result.message);
      if (result.card) { setHydrated(result.card); onUpdated?.(result.card); }
    } catch (error) { setProblem(error.message || "That decision couldn't be saved. Review the latest values and try again."); }
    finally { setSaving(false); }
  }
  function reviewPanel(target, draft, key) {
    if (panel?.key !== key) return null;
    if (!draft && (!target.has_values || !target.values?.length)) return null;
    if (panel.mode === "choose") return <div className="space-y-3 border-t border-slate-100 bg-slate-50 p-4" aria-label="Choose how to edit">
      <p className="font-medium">How would you like to edit this?</p><div className="flex flex-wrap gap-2">
        <button type="button" disabled={locked} onClick={() => edit(target, draft)} className={button}>I’ll edit it myself</button>
        <button type="button" disabled={locked} onClick={() => agentHelp(target, key, draft)} className={primary}>Help me edit this</button>
      </div><button type="button" onClick={() => setPanel({key,mode:"review"})} className="min-h-11 text-sm text-slate-500">Back to review</button></div>;
    const values = draft ? [{label: target.label, value: target.value}] : target.values || [];
    return <div className="space-y-4 border-t border-slate-100 bg-slate-50 p-4" aria-label="Review values">
      <dl className="space-y-3">{values.map((value, i) => <div key={value.path || i}><dt className="text-xs font-semibold text-slate-500">{value.label}</dt><dd className="mt-1 whitespace-pre-line break-words text-sm text-slate-800">{clean(value.value)}</dd></div>)}</dl>
      {target.detail && <p className="text-sm text-slate-500">Still needed: {target.detail}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={locked} onClick={() => setPanel({key,mode:"choose"})} className={button}>Edit</button><button type="button" onClick={() => setPanel(null)} className={button}>Close review</button></div>
    </div>;
  }
  async function reviewUpdated() {
    try {
      await apiRequest(`${base}/assessments`, "POST", {});
      const subject = await apiRequest(base);
      setEditor(old => old ? { ...old, subject } : old);
      await refresh();
    } catch (error) { setProblem(error.message || "The review couldn't refresh. Try again."); }
  }
  const editorPanel = editor && <div className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/30 p-4" aria-label="Update this item">
      <h4 className="font-semibold">{editor.draft ? `Edit ${editor.target.label}` : editor.target.title}</h4>
      {editor.review === "forecast" && <ForecastEditor businessId={businessId} feature={item.topic} subject={editor.subject} evidence={editor.subject.evidence} disabled={locked} onSaved={reviewUpdated} />}
      {editor.review === "documents" && <RequiredDocuments businessId={businessId} subject={editor.subject} onChanged={reviewUpdated} />}
      {(editor.review === "attestation" || editor.review === "evidence") && <>
        <EvidenceList startAdding={!editor.target.has_values} businessId={businessId} feature={item.topic} subject={editor.subject} checks={(editor.subject.profile_definition?.sections || []).find(s => [...(s.attest || []), ...(s.evidence || [])].includes(editor.code))?.evidence || []} onChanged={reviewUpdated} />
        {editor.review === "attestation" && editor.target.has_values && <Attestation businessId={businessId} feature={item.topic} subject={editor.subject} code={editor.code} onChanged={reviewUpdated} />}
      </>}
      {editor.fields.map(field => <Field key={field.key} field={field} data={editor.data} evidence={editor.subject.evidence} disabled={locked}
        idBase={`chat-${item.case_id}`} onChange={(path, value) => setEditor(old => ({ ...old, data: setPath(old.data, path, value), changes: setPath(old.changes, path, value) }))} />)}
      <div className="flex flex-wrap gap-2">{!editor.review && <button type="button" disabled={locked || !Object.keys(editor.changes).length} onClick={save} className={primary}>{saving ? "Saving…" : "Save changes"}</button>}
        <button type="button" disabled={locked} onClick={() => setEditor(null)} className={button}>{editor.review ? "Close review" : "Cancel"}</button></div>
    </div>;
  return <section data-readiness-tasks aria-label={item.title} className="w-full max-w-2xl space-y-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:p-5">
    <div className="flex items-start justify-between gap-3"><h3 className="text-base font-semibold text-slate-900">{item.title}</h3><button type="button" disabled={locked} aria-label="Refresh pending items" onClick={async () => { setSaving(true); setProblem(""); try { await refresh(); } catch (error) { setProblem(error.message || "The list couldn't refresh."); } finally { setSaving(false); } }} className="flex min-h-11 shrink-0 items-center rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50">Refresh</button></div>
    {problem && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{problem}</p>}
    {note && <p role="status" className="text-emerald-700">{note}</p>}
    {!!item.drafts?.length && <div className="space-y-3"><p className="text-sm font-medium text-slate-500">Ready for your review</p>
      {item.drafts.map((draft, i) => <article key={draft.path || i} aria-label={draft.label} className={cardStyle}>
        <div className={headerStyle}><h4 className="break-words font-semibold text-slate-900">{draft.label}</h4></div>
        <div className={footerStyle}>
          <button type="button" disabled={locked} onClick={() => openReview(draft,true)} className={button}>Review</button>
          <button type="button" disabled={locked} onClick={() => decide(draft, true)} className={primary}>Approve</button>
          <button type="button" disabled={locked} onClick={() => decide(draft, false)} className="min-h-11 rounded-lg px-3 py-2 font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Reject</button>
          {drafting === keyFor(draft,true) && <ThinkingProgress label="Working on this draft…" />}
          <span className="w-full text-xs text-slate-500 sm:ml-auto sm:w-auto">{draft.source || "Suggested by the agent"}</span>
        </div>
        {reviewPanel(draft, true, keyFor(draft,true))}
        {editor?.key === keyFor(draft,true) ? <div className="border-t border-slate-100 p-4">{editorPanel}</div> : null}
      </article>)}
    </div>}
    {!!item.items?.length && <ol className="space-y-3">{item.items.map((step, i) => <li key={i} className={cardStyle}>
      <div className={headerStyle}><h4 className="break-words font-semibold text-slate-900">{i + 1}. {step.title}</h4></div>
      {step.detail && <p className={bodyStyle}>{step.detail}</p>}
      {step.has_values && step.values?.length > 0 && <div className="space-y-2 px-4 pb-3 text-sm text-slate-700" aria-label="Available information">
        <p className="font-medium">{step.values.some(value => value.draft) ? "Proposed information to review" : "Saved information to review"}</p>
        {step.values.slice(0, 2).map((value,index) => <p key={index} className="break-words"><span className="font-medium">{value.label}: </span>{String(value.value).slice(0,240)}{String(value.value).length > 240 ? "…" : ""}</p>)}
        {(step.values.length > 2 || step.values.some(value => String(value.value).length > 240)) && <p className="text-slate-500">Review to see all the information.</p>}
      </div>}
      <div className={footerStyle}>
        {step.has_values && step.values?.length ? <>
          <button type="button" disabled={locked} onClick={() => openReview(step)} className={button}>Review</button>
          <button type="button" disabled={locked} onClick={() => decideStep(step,true)} className={primary}>Approve</button>
          <button type="button" disabled={locked} onClick={() => decideStep(step,false)} className="min-h-11 rounded-lg px-3 py-2 font-semibold text-rose-700 hover:bg-rose-50">Reject</button>
        </> : <>
          <button type="button" disabled={locked} onClick={() => agentHelp(step, i)} className={primary}>Help me fill this</button>
          <button type="button" disabled={locked} onClick={() => edit(step)} className={button}>I’ll fill it myself</button>
        </>}
        {(drafting === i || drafting === keyFor(step)) && <ThinkingProgress label="Working on this item…" />}
      </div>
      {reviewPanel(step, false, keyFor(step))}
      {editor?.key === keyFor(step) ? <div className="border-t border-slate-100 p-4">{editorPanel}</div> : null}
    </li>)}</ol>}
    {!item.items?.length && !item.drafts?.length && <p className="text-slate-500">No outstanding items on this check.</p>}

  </section>;
}
