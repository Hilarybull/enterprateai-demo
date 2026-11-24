import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMarketplaceProfile } from "../lib/directory";
import { useWorkspaceStore } from "../store/workspace";

/** The plan for winning more customers (the owner, 26 Oct: "so where is the plan?"): the weekly target, then each step with
 *  why, how many, and the words ready to edit and copy (Copy only for now: the owner, 26 Oct). */
export default function CustomerPlan({ plan }) {
  if (!plan?.steps?.length) return null;
  return (
    <section id="customer-plan" className="mt-6 scroll-mt-24 space-y-3" data-customer-plan>
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">Your plan to win more customers</h3>
      {plan.goal && <p className="text-[13.5px] font-semibold text-slate-700 dark:text-slate-200" data-plan-goal>{plan.goal}</p>}
      <ol className="space-y-3">
        {plan.steps.map((s, n) => <Step key={s.key} step={s} n={n + 1} />)}
      </ol>
    </section>
  );
}

function Step({ step, n }) {
  const navigate = useNavigate();
  const [text, setText] = useState(step.draft || "");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the text stays to select */ }
  };
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-plan-step={step.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[14.5px] font-semibold text-slate-900 dark:text-slate-100">{n}. {step.title}</p>
        {step.target && <span className="rounded bg-brand-50 px-2 py-0.5 text-[12px] font-semibold text-brand-800" data-plan-target>{step.target}</span>}
      </div>
      <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">{step.why}</p>
      {step.draft && (
        <>
          <textarea aria-label={`Your message: ${step.title}`} value={text} onChange={(e) => setText(e.target.value)} rows={3}
            className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-[13px] leading-5 text-slate-800 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={copy} data-plan-copy
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200">{copied ? "Copied" : "Copy"}</button>
          </div>
        </>
      )}
      {step.share && <ShareLink />}
      {step.to && (
        <a href={step.to} onClick={(e) => { e.preventDefault(); navigate(step.to); }} data-plan-go
          className="mt-2 inline-block rounded-lg bg-brand-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-700">{step.cta || "Open"}</a>
      )}
    </li>
  );
}

/** The public listing's own address, to copy into the messages above (the owner, 26 Oct: "Share" opened the edit page). */
function ShareLink() {
  const businessId = useWorkspaceStore((s) => s.workspaceId);
  const [url, setUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!businessId) return undefined;
    let live = true;
    getMarketplaceProfile(businessId).then((p) => {
      if (live && p?.directory?.public !== false && p?.directory?.slug) setUrl(`${window.location.origin}/marketplace/business/${p.directory.slug}`);
    }).catch(() => {});
    return () => { live = false; };
  }, [businessId]);
  if (!url) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the link stays to select */ }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-plan-share>
      <input readOnly value={url} aria-label="Your Marketplace link" onFocus={(e) => e.target.select()}
        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
      <button type="button" onClick={copy} data-plan-share-copy
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200">{copied ? "Copied" : "Copy link"}</button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold text-brand-700 underline-offset-2 hover:underline">Preview</a>
    </div>
  );
}
