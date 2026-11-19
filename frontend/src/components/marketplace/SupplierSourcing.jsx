import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { saveSourcingDraft } from "../../lib/sourcing";
import { InviteModal } from "../../pages/ProposalsPage";
import { submitAgentRequest } from "../../lib/agent";
import { apiRequest } from "../../api/client";
import { useWorkspaceStore } from "../../store/workspace";

const input = "mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-950";
const card = "space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-700 dark:bg-slate-900";
const primary = "rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50";


const actionErrors = {
  load: "We couldn't open this draft. Return to Procurement and try opening it again.",
  draft: "We couldn't generate a draft. Try again with the details you entered.",
  save: "We couldn't save your draft. Your edits are still here. Try saving again.",
  match: "We couldn't search for suppliers. Your search is still here. Try again.",
  publish: "We couldn't confirm publication. Check the request status in Procurement before trying again.",
  send: "We couldn't confirm that your RFQ was sent. Check Sent RFQs before trying again.",
};

function actionError(action, error) {
  if (error?.status === 401) return "Your session has expired. Sign in again to continue.";
  if (error?.status === 403) return "You don't have permission to do this in the current workspace.";
  return actionErrors[action];
}

export default function SupplierSourcing({ onSaved }) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const [params] = useSearchParams();
  const reopenId = params.get("sourcingDraft");
  const [requestId] = useState(() => reopenId || crypto.randomUUID());
  const [mode, setMode] = useState(reopenId || onSaved || params.get("mode") === "draft" || params.get("from") === "procurement" ? "draft" : "match");
  const [draftFailed, setDraftFailed] = useState(false);
  const [kind, setKind] = useState("");
  const [brief, setBrief] = useState("");
  const [messages, setMessages] = useState([]);
  const [continuing, setContinuing] = useState(false);
  const [draft, setDraft] = useState(null);
  const draftHeading = useRef(null);
  const messageInput = useRef(null);
  const latestReply = useRef(null);
  const draftReady = Boolean(draft);
  useEffect(() => {
    if (draftReady) draftHeading.current?.focus({ preventScroll: true });
  }, [draftReady]);

  useEffect(() => {
    if (mode !== "draft" || !messages.length) return;
    const latest = messages.at(-1);
    const target = latest.hasDraft ? draftHeading.current : latestReply.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
  }, [messages, mode]);
  const [service, setService] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [credentials, setCredentials] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [matches, setMatches] = useState(null);
  const [supplier, setSupplier] = useState("");
  const [quoteMatches, setQuoteMatches] = useState(null);
  const [quoteSearchFailed, setQuoteSearchFailed] = useState(false);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [sent, setSent] = useState(false);
  const [published, setPublished] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");

  async function run(action, work) {
    if (!workspaceId || busy) return;
    setBusy(action);
    setProblem("");
    try { await work(); } catch (error) { setProblem(actionError(action, error)); }
    finally { setBusy(""); }
  }

  const scope = "?workspace_id=" + encodeURIComponent(workspaceId || "");
  useEffect(() => {
    if (!reopenId || !workspaceId) return;
    setMode("draft");
    let active = true;
    setBusy("load");
    apiRequest("/proposals/sourcing/drafts/" + encodeURIComponent(reopenId) + scope, "GET").then(({ record, generation }) => {
      if (!active) return;
      setBrief("");
      if (!record) {
        setKind(generation.draft.recommendation);
        setDraft(generation.draft);
        return;
      }
      setKind(record.sourcing_kind);
      setDraft({ questions: [], ...generation?.draft, ...record, description: record.description || "",
        constraints: generation?.draft?.constraints || [] });
      setSaved(record.id);
      setSupplier(record.rfq_supplier_slug || "");
      setSendPending(record.status === "SENDING");
      setSent(record.status === "SENT");
      setPublished(record.status === "PUBLISHED");
    }).catch((error) => { if (active) setProblem(actionError("load", error)); })
      .finally(() => { if (active) setBusy(""); });
    return () => { active = false; };
  }, [reopenId, workspaceId, scope]);

  const quoteService = draft?.supplier_search || draft?.category?.split(/\s+[–—-]\s+/).at(-1) || "";
  const quoteLocation = draft?.location || "";
  const canSuggestSuppliers = Boolean(saved && workspaceId && !sent && !published && !sendPending && quoteService.trim().length >= 2);
  useEffect(() => {
    setQuoteMatches(null);
    setQuoteSearchFailed(false);
    if (!canSuggestSuppliers) return;
    let active = true;
    apiRequest("/proposals/sourcing/match-suppliers" + scope, "POST", {
      service: quoteService.trim().slice(0, 150), location: quoteLocation.trim().slice(0, 150), rfq_only: kind === "RFQ", include_related: true,
    }).then((result) => {
      if (active) setQuoteMatches(result.matches || []);
    }).catch(() => {
      if (active) setQuoteSearchFailed(true);
    });
    return () => { active = false; };
  }, [canSuggestSuppliers, saved, scope, quoteService, quoteLocation, quoteRetry, kind]);

  const split = (value) => value.split(",").map((part) => part.trim()).filter(Boolean);
  function sendDraftMessage() {
    if (!brief.trim()) return;
    run("draft", async () => {
      const text = brief.trim();
      function showReply(reply) {
        setMessages((current) => {
          const previous = current.at(-1);
          const turns = previous?.failed && previous.brief === text ? current.slice(0, -1) : current;
          return [...turns, { brief: text, ...reply }];
        });
      }

      function showFailure(message) {
        setDraftFailed(true);
        showReply({ reply: message, failed: true });
      }

      let reply;
      try {
        reply = await submitAgentRequest({ businessId: workspaceId, page: "procurement", text,
          sourceReference: requestId, params: { action: "draft", current_request: draft || undefined } });
      } catch (error) {
        showFailure(error?.code === "TIMEOUT"
          ? "I’m taking longer than expected. Your answer is still here. Send it again to retry."
          : actionError("draft", error));
        return;
      }
      const result = reply?.procurement;
      if (!["clarification", "draft", "answer"].includes(result?.status)) {
        showFailure(actionErrors.draft);
        return;
      }
      showReply({ reply: result.status === "draft" ? "Here is your draft. Tell me what to change, or save it to continue." : reply.message,
        hasDraft: result.status === "draft" });
      setDraftFailed(false);
      if (result.status !== "answer") setContinuing(result.status === "clarification");
      setBrief("");
      if (result.status !== "draft") return;
      setDraft((current) => ({ ...current, ...result.draft }));
      if (draft) draftHeading.current?.focus({ preventScroll: true });
      setKind((current) => current || result.draft.recommendation);
      setLocation(result.draft.location);
      setSaved(null);
    });
  }

  const draftConversation = (
    <form className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700" onSubmit={(event) => {
      event.preventDefault();
      sendDraftMessage();
    }}>
        <div className="flex flex-col gap-2">
          <label className="block text-sm font-medium">{continuing ? "Your answer" : draft ? "What would you like to change?" : "What service do you need?"}
            <textarea ref={messageInput} className={input} minLength={1} maxLength={5000} rows={4} placeholder={continuing ? "Add the missing details" : draft ? "e.g. Ask suppliers to include delivery in their price." : "e.g. We need packed lunches for 40 staff in Leeds every Friday."} value={brief} onChange={(e) => setBrief(e.target.value)} required />
          </label>
          <button type="button" onClick={sendDraftMessage} className={primary + " self-end"} disabled={!workspaceId || Boolean(busy) || !brief.trim() || sent || published || sendPending}>
            {busy === "draft" ? "Sending…" : "Send"}
          </button>
        </div>
          {draftFailed && !draft && <button type="button" className="ml-3 text-sm font-semibold text-brand-700 underline dark:text-brand-300"
          onClick={() => {
            const buyerBrief = messages.map((item) => item.brief).filter((value, index, all) => index === 0 || value !== all[index - 1]);
            setKind("RFP");
            setBrief("");
            setDraft({ title: buyerBrief[0]?.slice(0, 160) || "", description: buyerBrief.join("\n").slice(0, 3000), constraints: [], questions: [] });
          }}>Start an editable draft from my brief</button>}
      </form>
  );
  return (
    <section className="space-y-5 text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-20 rounded-2xl bg-gradient-to-br from-brand-700 to-indigo-900 px-5 py-6 text-white sm:px-8 sm:py-8">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Find Suppliers with Enterprate AI</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-indigo-100">Search the Marketplace for suppliers, or create a request for quotes or proposals.</p>
        <Link className="mt-4 inline-flex rounded-lg border border-white/30 px-3 py-2 text-sm font-medium hover:bg-white/10" to="/marketplace?tab=businesses">Browse directory</Link>
      </header>
      {!workspaceId && <p role="status" className={card}>Select a workspace to start sourcing.</p>}
      {problem && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{problem}</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Sourcing mode">
        {[["match", "Search for suppliers"], ["draft", "Draft a request"]].map(([key, label]) =>
          <button key={key} type="button" aria-pressed={mode === key} className={mode === key ? primary : "rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold dark:border-slate-700"}
            onClick={() => { setMode(key); setProblem(""); }}>{label}</button>)}
      </div>
      {mode === "draft" && <section className={card} aria-labelledby="procurement-conversation">
        <h3 id="procurement-conversation" className="text-lg font-semibold">Procurement conversation</h3>
        {!messages.length && !draft && <p className="text-sm text-slate-600 dark:text-slate-300">What would you like suppliers to quote on or propose? I’ll ask for any missing details and write a request you can review before sharing it.</p>}
        {messages.length > 0 && <ol aria-live="polite" className="space-y-3 text-sm">{messages.map((item, i) => <li key={i} ref={i === messages.length - 1 ? latestReply : null} className="space-y-2">
          <p className="ml-5 rounded-xl bg-brand-50 px-3 py-2.5 dark:bg-brand-950"><strong>You:</strong> {item.brief}</p>
          <p className="mr-5 rounded-xl bg-slate-100 px-3 py-2.5 dark:bg-slate-800"><strong>EnterprateAI:</strong> {item.reply}</p>
        </li>)}</ol>}
      {draft && <div className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/30 p-4 sm:p-5 dark:border-brand-800 dark:bg-brand-950/20">
        <h3 ref={draftHeading} tabIndex={-1} className="text-lg font-semibold">Review your {kind} draft</h3>
        {draft.recommendation && <p className="text-sm"><strong>Suggested {draft.recommendation === "RFQ" ? "request for quotation" : "request for proposal"}.</strong> {draft.rationale}</p>}
        <div className="space-y-3 text-sm" aria-label="Draft preview">
          <p className="font-semibold">{draft.title}</p>
          <p className="whitespace-pre-wrap leading-relaxed">{draft.description}</p>
          <dl className="grid gap-3 sm:grid-cols-2">
            {[["Budget", draft.budget_range], ["Submission deadline", draft.deadline], ["Location", draft.location],
              ["Timeline", draft.timeline], ["Submission cap", draft.submission_cap]].filter(([, value]) => value != null && value !== "").map(([label, value]) =>
                <div key={label}><dt className="font-medium">{label}</dt><dd>{value}</dd></div>)}
          </dl>
          {draft.constraints?.length > 0 && <div><h4 className="font-medium">Service details</h4><ul className="mt-1 list-disc space-y-1 pl-5">{draft.constraints.map((text,i)=><li key={i}>{text}</li>)}</ul></div>}
          {draft.requirements?.length > 0 && <div><h4 className="font-medium">What suppliers should submit</h4><ul className="mt-1 list-disc space-y-1 pl-5">{draft.requirements.map((requirement,i)=><li key={i}>{requirement.text}</li>)}</ul></div>}
        </div>
        {!saved && !sent && !published && <p className="text-sm">Tell me what to change, or save this {kind} draft to continue.</p>}
        <div className="flex flex-wrap gap-3">
          {!sent && !published && !sendPending && <button type="button"
            className="rounded-xl border border-brand-200 px-4 py-2.5 text-sm font-semibold text-brand-700 dark:border-brand-800 dark:text-brand-300"
            disabled={Boolean(busy)} onClick={() => {
              messageInput.current?.focus({ preventScroll: true });
              messageInput.current?.scrollIntoView({ block: "center", behavior: "smooth" });
            }}>Change something</button>}
          <button type="button" className={primary} disabled={Boolean(busy) || Boolean(saved) || sent || published || sendPending}
            onClick={() => run("save", async () => {
              const { title, description, type, budget_range, budget_currency, budget_visible, deadline, submission_cap,
                accepted_modes, accepted_categories, visibility, specific_criteria, invited_workspace_ids, invite_emails } = draft;
              const fields = { title, description, type, budget_range, budget_currency, budget_visible, deadline, submission_cap,
                accepted_modes, accepted_categories, visibility, specific_criteria, invited_workspace_ids, invite_emails };
              const record = await saveSourcingDraft(requestId, workspaceId, {
                ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
                kind, requirements: draft.requirements || [],
              });
              setDraft((current) => ({ ...current, ...record }));
              setSaved(record.id);
              onSaved?.();
            })}>{saved ? "Draft saved" : busy === "save" ? "Saving…" : "Save " + kind + " draft"}</button>
          {!sent && !published && !sendPending && <button type="button" className="text-sm font-semibold text-brand-700 underline dark:text-brand-300"
            disabled={Boolean(busy)} onClick={() => { setKind(kind === "RFQ" ? "RFP" : "RFQ"); setSaved(null); setConfirmPublish(false); }}>
            Use {kind === "RFQ" ? "RFP" : "RFQ"} instead
          </button>}
        </div>
        {saved && !sent && !published && <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <h4 className="text-sm font-semibold">Suggested suppliers</h4>
          {!sendPending && <>
            {canSuggestSuppliers && !quoteMatches && !quoteSearchFailed && <p role="status" className="text-sm">Finding relevant businesses…</p>}
            {quoteSearchFailed && <div><button type="button" className="text-sm font-semibold underline" onClick={() => setQuoteRetry(v => v + 1)}>Retry suggestions</button><p role="status" className="text-sm">Supplier suggestions are temporarily unavailable. You can retry, or use an RFP to publish your requirement and invite suppliers.</p></div>}
            {kind === "RFQ" && (quoteMatches && !quoteMatches.some(match => match.can_send_rfq !== false) || quoteSearchFailed) && <div className="space-y-2">
              {!quoteSearchFailed && <p role="status" className="text-sm">I recommend an RFP because no matching suppliers are available to receive this RFQ. Publish your requirement and invite suppliers to respond.</p>}
              <button type="button" className={primary} onClick={() => {
                setKind("RFP");
                setDraft((current) => ({ ...current, recommendation: "RFP",
                  rationale: quoteSearchFailed ? "Supplier suggestions are unavailable. An RFP lets you publish this requirement and invite suppliers to respond." : "No suitable suppliers are available for a direct RFQ. An RFP lets you publish this requirement and invite suppliers to respond." }));
                setSaved(null);
                setSupplier("");
                setConfirmPublish(false);
              }}>Use an RFP</button>
            </div>}
            {quoteMatches?.length > 0 && <ul className="space-y-2">
              {quoteMatches.map((match) => <li key={match.slug} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <Link className="font-semibold underline" to={"/marketplace/business/" + encodeURIComponent(match.slug)}>{match.name}</Link>
                  <p>{match.match_level === "related" ? "Related business — confirm suitability. " : ""}{[match.location, ...match.service_evidence].filter(Boolean).join(" · ")}</p>
                </div>
                {kind === "RFQ" && match.can_send_rfq !== false && <button type="button" className="font-semibold underline" aria-pressed={supplier === match.slug}
                  onClick={() => setSupplier(match.slug)}>{supplier === match.slug ? "Selected" : "Choose supplier"}</button>}
              </li>)}
            </ul>}
            {kind === "RFP" && quoteMatches?.length === 0 && <p className="text-sm">No related businesses found. You can publish this RFP and invite suppliers by email.</p>}
          </>}
          {supplier && <p className="text-sm">Selected supplier: {quoteMatches?.find((match) => match.slug === supplier)?.name || matches?.find((match) => match.slug === supplier)?.name || supplier}</p>}
          {kind === "RFQ" && supplier && <button type="button" className="rounded-lg border border-brand-600 px-3 py-2 text-sm font-semibold text-brand-600 disabled:opacity-50"
            disabled={Boolean(busy) || !supplier.trim()}
            onClick={() => {
              if (!window.confirm("Send this saved quote request to " + supplier.trim() + "?")) return;
              run("send", async () => {
                await apiRequest("/proposals/sourcing/drafts/" + requestId + "/send-rfq" + scope, "POST", { supplier_slug: supplier.trim() });
                setSent(true);
                onSaved?.();
              });
            }}>{busy === "send" ? "Sending..." : "Send RFQ to selected supplier"}</button>}
        </div>}
        {sent && <p role="status" className="text-sm">RFQ sent. <Link className="underline" to="/operations?tab=Procurement&sub=Sent%20RFQs">Open Sent RFQs</Link></p>}
        {saved && kind === "RFP" && !published && <div className="space-y-3">
          {!confirmPublish ? <button type="button" className={primary} disabled={Boolean(busy)}
            onClick={() => setConfirmPublish(true)}>Review and publish RFP</button> : <div role="group" aria-label="Confirm RFP publication" className="space-y-3 rounded-xl border border-brand-200 p-4 dark:border-brand-800">
            <p className="text-sm">Publish this RFP to Marketplace so suppliers can view it and submit proposals?</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={Boolean(busy)}
                onClick={() => run("publish", async () => {
                  await apiRequest("/proposals/requests/" + encodeURIComponent(saved) + "/publish" + scope, "POST");
                  setPublished(true);
                  setConfirmPublish(false);
                  onSaved?.();
                })}>{busy === "publish" ? "Publishing…" : "Approve and publish RFP"}</button>
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-700"
                disabled={Boolean(busy)} onClick={() => setConfirmPublish(false)}>Cancel</button>
            </div>
          </div>}
        </div>}
        {published && <div className="space-y-3">
          <p role="status" className="text-sm">Your RFP is published. You can share the link or invite suppliers to respond.</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="underline" to={"/marketplace?tab=requests&request=" + encodeURIComponent(saved)}>View published RFP</Link>
            <button type="button" className="font-semibold underline" onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.origin + "/marketplace?request=" + encodeURIComponent(saved));
                setCopied(true);
              } catch { setSharing(true); }
            }}>{copied ? "Link copied" : "Copy RFP link"}</button>
            <button type="button" className="font-semibold underline" onClick={() => setSharing(true)}>Invite suppliers by email</button>
          </div>
          {sharing && <InviteModal req={{ ...draft, id: saved, workspace_id: workspaceId }} onClose={() => setSharing(false)} />}
        </div>}
        {saved && !sent && !published && <p role="status" className="text-sm">Draft saved. <Link className="underline" to={"/operations?tab=Procurement&sub=Proposal%20Requests&sourcingDraft=" + saved}>Edit in Business Operations</Link></p>}
      </div>}
        {draftConversation}
      </section>}
      {mode === "match" && <div className="min-w-0 space-y-5">
      <form className={card} onSubmit={(event) => {
        event.preventDefault();
        run("match", async () => {
          setMatches(null);
          const reply = await submitAgentRequest({ businessId: workspaceId, page: "procurement",
            text: "Find suppliers for " + service.trim(), sourceReference: requestId, params: { action: "match",
              criteria: { category: category.trim(), service: service.trim(), location: location.trim(),
                required_evidence: split(credentials), excluded_slugs: split(exclusions), rfq_only: Boolean(saved && kind === "RFQ") } } });
          if (reply.procurement?.status !== "matches") throw new Error("Supplier matching did not complete.");
          setMatches(reply.procurement.matches);
        });
      }}>
        <div><h3 className="text-lg font-semibold">Search for suppliers</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Start with a service. Add a location or filters to narrow the results.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Service, category or business name<input className={input} placeholder="e.g. Catering or technology" value={service} onChange={(e) => setService(e.target.value)} minLength={2} maxLength={150} required /></label>
          <label className="text-sm">Location (optional)<input className={input} placeholder="e.g. Leeds" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={150} /></label>
        </div>
        <details open={category || credentials || exclusions ? true : undefined} className="rounded-xl border border-slate-200 px-3.5 py-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-semibold">Advanced filters</summary>
          <div className="mt-3 grid gap-3">
          <label className="text-sm">Directory category (optional)<input className={input} value={category} onChange={(e) => setCategory(e.target.value)} maxLength={100} /></label>
          <label className="text-sm">Essential credentials, separated by commas<input className={input} value={credentials} onChange={(e) => setCredentials(e.target.value)} maxLength={500} /></label>
          <label className="text-sm">Excluded profile slugs, separated by commas<input className={input} value={exclusions} onChange={(e) => setExclusions(e.target.value)} maxLength={1000} /></label>
          </div>
        </details>
        <button type="submit" className={primary} disabled={!workspaceId || Boolean(busy)}>
          {busy === "match" ? "Finding suppliers..." : "Find matching suppliers"}
        </button>
      </form>
      {matches && (matches.length ? <ul className="space-y-3" aria-label="Supplier matches">{matches.map((supplier) => <li key={supplier.slug} className={card + " text-sm"}>
        <Link className="text-base font-semibold text-brand-700 underline dark:text-brand-300" to={"/marketplace/business/" + encodeURIComponent(supplier.slug)}>{supplier.name}</Link>
        <p>{supplier.location} {supplier.category}</p>
        <p>Matched on: {supplier.service_evidence.join(", ")}</p>
        {saved && kind === "RFQ" && !sent && !sendPending && <button type="button" className="font-semibold underline" onClick={() => { setSupplier(supplier.slug); setMode("draft"); }}>Choose for RFQ</button>}
        <p>{supplier.owner_verified ? "Ownership verified. " : ""}Independent qualifications are not verified.</p>
      </li>)}</ul> : <p role="status" className={card + " text-sm"}>No suppliers matched. Try a shorter service name or broaden the location.</p>)}
      </div>}
    </section>
  );
}
