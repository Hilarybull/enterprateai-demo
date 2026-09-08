import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Button from "../components/Button";
import Badge from "../components/Badge";
import Spinner from "../components/Spinner";
import ApplyModal from "../components/proposals/ApplyModal";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";
import enterprateLogo from "../logo.png";

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export default function ProposalRequestDetailPage() {
  const { requestId } = useParams();
  const token = useAuthStore((s) => s.token);
  const [request, setRequest] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applyOpen, setApplyOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest(`/proposals/public/requests/${requestId}`, "GET")
      .then((d) => { if (!cancelled) { setRequest(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message.replace(/^HTTP \d+:\s*/i, "") : "Request not found"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestId]);

  const deadline = fmtDate(request?.deadline);
  const closed = request && request.status !== "PUBLISHED";

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f8fafc_45%,#f8fafc_100%)] dark:bg-slate-950">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/marketplace" className="flex items-center gap-2">
            <img src={enterprateLogo} alt="EnterprateAI" className="h-6 w-auto max-w-[130px] object-contain sm:h-7" />
          </Link>
          <Link to="/marketplace" className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400">Browse marketplace</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
        {loading ? (
          <div className="flex justify-center py-20"><Spinner size={24} /></div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-white px-5 py-6 text-center dark:border-rose-900/50 dark:bg-slate-900">
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">This request isn't available</div>
            <p className="mt-2 text-sm text-slate-500">{error}</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{String(request.type || "general").replace(/^\w/, (c) => c.toUpperCase())}</Badge>
                {closed ? <Badge tone="slate">Closed</Badge> : <Badge tone="success">Accepting proposals</Badge>}
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{request.title}</h1>
              {request.company_name ? (
                <p className="mt-1 text-sm text-slate-500">Posted by {request.company_name}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600 dark:text-slate-300">
                {deadline ? <span>Deadline: <strong>{deadline}</strong></span> : null}
                {request.budget_visible && request.budget_range ? (
                  <span>Budget: <strong>{request.budget_range}</strong></span>
                ) : null}
                {request.submission_cap ? <span>Submissions accepted: {request.submission_count}/{request.submission_cap}</span> : null}
              </div>

              {request.description ? (
                <div className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {request.description}
                </div>
              ) : null}

              {(request.requirements || []).length ? (
                <div className="mt-6">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requirements</div>
                  <ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                    {request.requirements.map((r, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-brand-500">•</span>
                        <span>{r.text}{r.mandatory ? <span className="ml-1 text-xs text-rose-500">(required)</span> : null}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-800">
                {request.is_owner ? (
                  <p className="text-sm text-slate-500">This is your request. Manage submissions in <Link className="text-brand-600 hover:underline" to="/proposals">Proposals</Link>.</p>
                ) : closed ? (
                  <p className="text-sm text-slate-500">This request is no longer accepting proposals.</p>
                ) : (
                  <Button onClick={() => setApplyOpen(true)}>
                    {token ? "Submit a proposal" : "Sign in to submit a proposal"}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {applyOpen && request ? (
        <ApplyModal
          recipientWorkspaceId={request.workspace_id}
          recipientName={request.company_name}
          request={{
            id: request.id,
            title: request.title,
            description: request.description,
            requirements: request.requirements || [],
          }}
          onClose={() => setApplyOpen(false)}
          onSubmitted={() => {}}
        />
      ) : null}
    </div>
  );
}
