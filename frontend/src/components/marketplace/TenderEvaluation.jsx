import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { submitAgentRequest } from "../../lib/agent";
import { ensureWorkspaceId, useWorkspaceStore } from "../../store/workspace";

const labels = { aligned: "Aligned", partial: "Partial fit", gap: "Gap to address", unknown: "Information needed", unsupported: "Unverified finding" };
const button = "w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50";

export default function TenderEvaluation({ notice, token, workspaceId }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const generation = useRef(0);
  const panel = useRef(null);
  useEffect(() => { setResult(null); setProblem(""); }, [notice.id, workspaceId]);
  useEffect(() => { generation.current += 1; setBusy(false); return () => { generation.current += 1; }; }, [notice.id]);
  useEffect(() => { if (result) panel.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [result]);
  async function evaluate() {
    if (busy) return;
    const version = ++generation.current;
    setBusy(true); setProblem("");
    try {
      const selectedWorkspace = workspaceId || await ensureWorkspaceId();
      if (!selectedWorkspace) { setProblem("Choose a business workspace before evaluating this tender."); return; }
      const response = await submitAgentRequest({ businessId: selectedWorkspace, page: "procurement", sourceChannel: "ui_action",
        sourceReference: notice.id, text: "Explain this tender, its requirements and how to respond. Compare with my business information where available and tell me what to do next.",
        params: { action: "tender_evaluation", tender_id: notice.id } });
      if (version !== generation.current || useWorkspaceStore.getState().workspaceId !== selectedWorkspace) return;
      const assessment = response.procurement?.tender_evaluation;
      if (!assessment || assessment.notice_id !== notice.id || assessment.workspace_id !== selectedWorkspace) {
        setProblem(response.message || "We couldn’t evaluate this tender. Try again."); return;
      }
      setResult(assessment);
    } catch {
      if (version === generation.current) setProblem("We couldn’t evaluate this tender right now. Please try again. Your business records are unchanged.");
    } finally { if (version === generation.current) setBusy(false); }
  }
  return <section ref={panel} className="scroll-mt-24 space-y-4 rounded-xl border border-brand-200 bg-brand-50/30 p-4 sm:p-6 dark:border-brand-800 dark:bg-brand-950/20" aria-label="Tender evaluation">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-semibold">Understand this tender</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Understand what the buyer needs, how to respond and what to do next. Check the fit with your business where information is available.</p></div>
      <div className="shrink-0 sm:max-w-xs">{!token ? <Link className={button + " block text-center"} to={"/login?next=" + encodeURIComponent("/marketplace?tab=tenders&tender=" + encodeURIComponent(notice.id))}>Evaluate This Tender for Me</Link> : <button type="button" className={button} disabled={busy} onClick={evaluate}>{busy ? "Analysing tender…" : result ? "Refresh tender evaluation" : "Evaluate This Tender for Me"}</button>}</div>
    </div>
    {busy && <p role="status" className="text-sm">Reading the tender requirements and preparing your next steps…</p>}
    {problem && <p role="alert" className="text-sm text-rose-700">{problem}</p>}
    {result && <div className="space-y-4" aria-live="polite">
      {result.overview?.length > 0 && <section className="space-y-3 rounded-xl bg-white p-4 dark:bg-slate-900"><h4 className="font-semibold">Tender explained</h4>{result.overview.map((item,index)=><article key={index} className="space-y-1 text-sm"><h5 className="font-semibold">{item.heading}</h5><p>{item.explanation}</p><details className="text-xs text-slate-500"><summary>Source evidence</summary>{item.evidence.map((ref,i)=><p key={i}><q>{ref.quote}</q> ({ref.source})</p>)}</details></article>)}</section>}
      <div className="rounded-xl bg-white p-4 dark:bg-slate-900"><p className="text-xs text-slate-500">Evaluation for {result.business_name}</p><h4 className="mt-1 font-semibold">{result.verdict}</h4></div>
      <div className="space-y-3">{result.findings.map((finding,index)=><article key={index} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="font-semibold">{finding.requirement}</h4><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-slate-800">{labels[finding.alignment] || "Information needed"}</span></div>
        <p>{finding.explanation}</p>
        <dl className="grid min-w-0 gap-3 md:grid-cols-2">{[["Tender evidence",finding.tender_evidence],["Your business evidence",finding.business_evidence]].map(([label,items])=><div key={label} className="min-w-0"><dt className="font-medium">{label}</dt><dd className="mt-1 space-y-2 break-words text-slate-600 dark:text-slate-300">{items?.length ? items.map((item,i)=><p key={i}><q>{item.quote}</q><span className="mt-1 block text-xs">Source: {item.source}</span></p>) : "No supporting evidence recorded."}</dd></div>)}</dl>
      </article>)}</div>
      <section className="space-y-3 rounded-xl border border-brand-200 bg-white p-4 dark:border-brand-800 dark:bg-slate-900"><h4 className="font-semibold">What to do next</h4><ol className="list-decimal space-y-2 pl-5 text-sm">{result.findings.map((finding,index)=><li key={index}>{finding.next_step}</li>)}</ol><Link className="inline-block text-sm font-semibold text-brand-700 underline" to="/account?section=workspace">Update your business profile</Link></section>
      <div className="space-y-1 text-xs text-slate-500">{result.limitations?.map((line,i)=><p key={i}>{line}</p>)}</div>
    </div>}
  </section>;
}
