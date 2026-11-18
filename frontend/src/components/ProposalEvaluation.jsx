import { useEffect, useState } from "react";
import { submitAgentRequest } from "../lib/agent";
import { apiRequest } from "../api/client";

const terms = {
  price: "Quoted price", scope: "Scope", pricing_basis: "Pricing basis", units: "Units",
  currency: "Currency", vat: "VAT treatment", exclusions: "Exclusions", timeline: "Timeline",
};
const button = "rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-slate-700";
const field = "rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm dark:border-slate-700";

function Evidence({ items }) {
  return items?.length ? <ul className="space-y-2">
    {items.map((item, index) => <li key={index}>
      <blockquote className="whitespace-pre-wrap break-words">{item.quote}</blockquote>
      <small className="break-all text-slate-500">Proposal {item.proposal_id} · {item.source}</small>
    </li>)}
  </ul> : <span className="text-slate-500">Unknown</span>;
}

function ScoreReview({ finding, confirmed, disabled, onConfirm }) {
  const [score, setScore] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form className="mt-2 space-y-2" onSubmit={(event) => {
      event.preventDefault();
      onConfirm(score === "" ? null : Number(score), reason);
    }}>
      {confirmed && <p><strong>Buyer confirmed {confirmed.score}/100.</strong> {confirmed.reason}</p>}
      <label className="flex flex-wrap items-center gap-2">Review score
        <input type="number" min={0} max={100} step={1} className={field + " w-24"} value={score} onChange={(e) => setScore(e.target.value)}
          required={finding?.score == null} placeholder={finding?.score == null ? undefined : String(finding.score)} />
      </label>
      <label className="block">Review reason
        <input className={field + " mt-1 w-full"} required minLength={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button className={button} disabled={disabled || reason.trim().length < 3} type="submit">{score === "" ? "Apply suggested score" : "Confirm score"}</button>
    </form>
  );
}

export default function ProposalEvaluation({ request, workspaceId, onClose }) {
  const [review, setReview] = useState(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const base = "/proposals/requests/" + encodeURIComponent(request.id) + "/evaluation";
  const scope = "?workspace_id=" + encodeURIComponent(workspaceId);

  useEffect(() => {
    let active = true;
    apiRequest(base + scope, "GET").then((data) => { if (active) setReview(data); })
      .catch((error) => { if (active) setProblem(error.message); });
    return () => { active = false; };
  }, [base, scope]);

  async function act(path, data) {
    setBusy(true);
    setProblem("");
    try {
      if (path.startsWith("/assist/")) {
        const reply = await submitAgentRequest({ businessId: workspaceId, page: "procurement", text: "Evaluate this proposal",
          params: { action: "evaluation", request_id: request.id, proposal_id: decodeURIComponent(path.slice(8)) } });
        if (!reply.procurement?.evaluation) throw new Error(reply.message || "Procurement could not evaluate this proposal.");
        setReview(reply.procurement.evaluation);
      } else {
        setReview(await apiRequest(base + path + scope, "POST", data));
      }
    }
    catch (error) {
      setProblem(error.message);
      if (error.status === 409) {
        try { setReview(await apiRequest(base + scope, "GET")); } catch { /* Retain the original error. */ }
      }
    }
    finally { setBusy(false); }
  }

  return (
    <section className="my-4 space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" aria-label="Proposal evaluation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Evaluate proposals for {request.title}</h3>
        <button type="button" className={button} onClick={onClose}>Close evaluation</button>
      </div>
      {problem && <p role="alert" className="text-sm text-rose-600">{problem}</p>}
      {!review && !problem && <p role="status">Loading evaluation...</p>}
      {review?.stale && <p className="text-sm text-amber-700">A proposal or criterion changed. Review the current evidence before confirming scores again.</p>}
      {review?.proposals.length === 0 && <p>No eligible proposals are linked to this request.</p>}
      {review?.proposals.length > 0 && <>
        <h4 className="font-semibold">Evaluation summary</h4>
        <ul className="space-y-2 text-sm">{review.proposals.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-2">
          <strong>{p.supplier || p.title || p.id}</strong>
          <span>{Object.keys(p.confirmed).length} of {review.criteria.length} scores confirmed.</span>
          {p.weighted_score != null && <span>Buyer weighted score {p.weighted_score}/100.</span>}
          {p.suggestion && <span>{p.suggestion.findings.filter((f) => f.state !== "supported").length} criteria need evidence or clarification.</span>}
          <button type="button" className={button} disabled={busy} onClick={() => act("/assist/" + encodeURIComponent(p.id))}>{p.suggestion ? "Regenerate suggestions" : "Generate AI suggestions"}</button>
          {p.attachment_count > 0 && <span className="text-slate-500">{p.attachment_count} attachments. Check the originals in the Inbox, especially PDFs and linked files.</span>}
        </li>)}</ul>
        <p className="text-xs text-slate-500">Weighted score = sum of confirmed scores multiplied by their criterion weights, divided by the sum of the weights.</p>
        <h4 className="font-semibold">Commercial comparison</h4>
        <p className="text-sm text-slate-600 dark:text-slate-300">AI extracts the quoted terms below. Compare currency, units, scope and VAT before comparing prices. These figures have no currency or tax conversions.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr><th scope="col" className="p-2">Term</th>{review.proposals.map((p) => <th scope="col" key={p.id} className="min-w-48 p-2">{p.supplier || p.title || p.id}</th>)}</tr></thead>
            <tbody>{Object.entries(terms).map(([key, label]) => <tr key={key} className="border-t border-slate-200 dark:border-slate-700">
              <th scope="row" className="p-2 align-top">{label}{review.commercial_flags?.[key] && <small className="block font-normal text-amber-700 dark:text-amber-300">{review.commercial_flags[key]}</small>}</th>
              {review.proposals.map((p) => <td key={p.id} className="p-2 align-top"><Evidence items={p.suggestion?.terms[key]} />
                {key === "price" && review.comparable_prices?.[p.id] && <p className="mt-1 text-xs">
                  {review.comparable_prices[p.id].formatted} ? {review.comparable_prices[p.id].calculation}
                </p>}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <h4 className="font-semibold">Buyer criteria</h4>
        {review.criteria.length === 0 && <p className="text-sm">Add requirements to the proposal request to score it here.</p>}
        {review.criteria.map((criterion, index) => <div key={index} className="space-y-2">
          <p className="text-sm font-semibold">{criterion.text} · Weight {criterion.weight}{criterion.mandatory ? " · Required" : ""}</p>
          <div className="grid gap-3 md:grid-cols-2">{review.proposals.map((p) => {
            const finding = p.suggestion?.findings[index];
            return <div key={p.id} className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
              <h5 className="font-semibold">{p.supplier || p.title || p.id}</h5>
              {finding && <>
                <p><strong>AI suggestion · {finding.state}</strong>{finding.score != null ? " · " + finding.score + "/100" : ""}</p>
                <p>{finding.explanation}</p>
                <Evidence items={finding.evidence} />
              </>}
              <ScoreReview key={review.snapshot + (p.confirmed[index]?.created_at || "")} finding={finding}
                confirmed={p.confirmed[index]} disabled={busy}
                onConfirm={(score, reason) => act("/confirm", { proposal_id: p.id, criterion: index,
                  snapshot: review.snapshot, suggestion_id: finding?.score == null ? null : review.suggestion_id, score, reason })} />
            </div>;
          })}</div>
        </div>)}
      </>}
    </section>
  );
}
