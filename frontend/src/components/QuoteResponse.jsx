import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiRequest } from "../api/client";

// The customer's side of a shared quotation: where it stands, and accepting, asking or declining.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function fmtLongDate(value) {
  if (!value) return "";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtMoney(value, currency = "GBP") {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value || 0));
  } catch {
    return `${Number(value || 0).toFixed(2)} ${currency}`;
  }
}

function friendly(e) {
  const raw = e instanceof Error ? e.message : String(e || "");
  if (raw === "NETWORK_ERROR" || e?.code === "NETWORK_ERROR") return "We couldn't reach the server. Check your connection and try again.";
  const said = e?.data?.detail;
  return typeof said === "string" ? said : "Something went wrong. Please try again.";
}

const Spin = () => (
  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
);

/** Total, validity and time left, at the top of the page. */
export function QuoteSummaryBar({ info }) {
  if (!info) return null;
  const open = info.state === "open";
  const left = info.days_left;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-5 py-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">Total</div>
        <div className="text-2xl font-bold tabular-nums text-indigo-950">
          {fmtMoney(info.total, info.currency)} <span className="text-sm font-semibold text-indigo-400">({info.currency})</span>
        </div>
      </div>
      {info.valid_until && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">Valid until</div>
          <div className="text-[15px] font-semibold text-indigo-950">{fmtLongDate(info.valid_until)}</div>
        </div>
      )}
      {open && left != null && left >= 0 && (
        <span className={`rounded-full px-3 py-1 text-[13px] font-semibold ${left <= 3 ? "bg-amber-100 text-amber-800" : "bg-white text-indigo-700"}`}>
          {left === 0 ? "Last day" : `${left} day${left === 1 ? "" : "s"} left`}
        </span>
      )}
      <div className="ml-auto text-right text-[13px] text-indigo-700">
        <div className="font-semibold">{info.reference}</div>
        <div>Version {info.version}</div>
      </div>
    </div>
  );
}

const BANNER = {
  accepted: { tone: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: "M20 6L9 17l-5-5" },
  declined: { tone: "border-slate-200 bg-slate-50 text-slate-800", icon: "M6 6l12 12M18 6L6 18" },
  expired: { tone: "border-amber-200 bg-amber-50 text-amber-900", icon: "M12 8v4l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" },
  cancelled: { tone: "border-slate-200 bg-slate-50 text-slate-800", icon: "M6 6l12 12M18 6L6 18" },
  superseded: { tone: "border-indigo-200 bg-indigo-50 text-indigo-900", icon: "M4 4v6h6M20 20v-6h-6M5 19A9 9 0 0 0 19 5" },
};

/** Where a closed quotation stands; the response buttons are not shown. */
export function QuoteStatusBanner({ info }) {
  if (!info || info.state === "open") return null;
  const seller = info.seller?.name || "the business";
  const on = fmtLongDate(info.acceptance?.accepted_at || info.responded_at);
  const text = {
    accepted: { title: `Accepted${on ? ` on ${on}` : ""}`, body: `${info.acceptance?.name ? `Accepted by ${info.acceptance.name}. ` : ""}${seller} has been told and will be in touch about next steps.` },
    declined: { title: `Declined${on ? ` on ${on}` : ""}`, body: `Thank you for letting ${seller} know.` },
    expired: { title: `Expired on ${fmtLongDate(info.valid_until)}`, body: `This quotation is no longer valid. Contact ${seller} for an updated quote.` },
    cancelled: { title: "Withdrawn", body: `${seller} has withdrawn this quotation.` },
    superseded: { title: `Replaced by version ${Number(info.version) + 1}`, body: `${seller} has sent a newer version of this quotation. Please use the latest link.` },
  }[info.state];
  const style = BANNER[info.state];
  return (
    <div role="status" className={`flex items-start gap-3 rounded-2xl border px-5 py-4 ${style.tone}`}>
      <svg className="mt-0.5 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d={style.icon} /></svg>
      <div>
        <div className="text-[15px] font-bold">{text.title}</div>
        <p className="mt-0.5 text-sm leading-6 opacity-90">{text.body}</p>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:max-w-md sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function QuestionThread({ questions, seller }) {
  return (
    <>
      <h3 className="text-sm font-bold text-slate-900">Your questions</h3>
      <ol className="mt-3 space-y-2.5">
        {questions.map((q, i) => (
          <li key={i} className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className="whitespace-pre-wrap text-sm text-slate-800">{q.message}</p>
            <p className="mt-1 text-[12px] text-slate-400">Sent {fmtLongDate(q.asked_at)} · {seller} replies by email</p>
          </li>
        ))}
      </ol>
    </>
  );
}

const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100";

/** Accept (with signer and terms), ask a question (with the thread), or decline (with a reason). */
export function QuoteResponsePanel({ token, info, viewerEmail, onChanged, openRef, onModalChange }) {
  const [modal, setModal] = useState(null);       // "accept" | "ask" | "decline"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");            // typed by the signer; never filled in for them
  const [agree, setAgree] = useState(false);
  const [question, setQuestion] = useState("");
  const [reason, setReason] = useState("");
  const [sentNote, setSentNote] = useState("");
  const seller = info?.seller?.name || "the business";

  // The sticky mobile bar hides while a dialog is open, so it never covers the dialog's buttons.
  useEffect(() => { onModalChange?.(Boolean(modal)); }, [modal, onModalChange]);

  // The sticky mobile bar opens the same dialogs.
  useEffect(() => { if (openRef) openRef.current = (which) => { setError(""); setModal(which); }; }, [openRef]);

  async function respond(body) {
    setBusy(true);
    setError("");
    try {
      const res = await apiRequest(`/blueprint/share/${token}/respond`, "POST", { email: viewerEmail || null, ...body });
      setModal(null);
      if (body.action === "question") {
        setQuestion("");
        setSentNote(`Your question has been sent to ${seller}. They'll reply by email, and this quotation stays open until you decide.`);
      }
      await onChanged?.(res);
      // Each open of the dialog starts with an empty signature.
      setName("");
      setAgree(false);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  if (!info) return null;
  const questions = info.questions || [];
  if (info.state !== "open") {
    // Decided or closed: no actions, but what was asked stays on the page.
    if (!questions.length) return null;
    return (
      <section aria-label="Your questions" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] sm:p-7">
        <QuestionThread questions={questions} seller={seller} />
      </section>
    );
  }
  return (
    <section aria-label="Respond to this quotation" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] sm:p-7">
      <h2 className="text-lg font-bold text-slate-900">Ready to respond?</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">Accept the quotation, ask {seller} a question first, or decline it.</p>
      {sentNote && <div role="status" className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">{sentNote}</div>}
      {error && !modal && <div role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="mt-5 grid gap-2.5 sm:grid-cols-[1.3fr_1fr_auto]">
        <button type="button" onClick={() => { setError(""); setModal("accept"); }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
          Accept quotation
        </button>
        <button type="button" onClick={() => { setError(""); setModal("ask"); }}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-3 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          Ask a question
        </button>
        <button type="button" onClick={() => { setError(""); setModal("decline"); }}
          className="rounded-xl px-5 py-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700">
          Decline
        </button>
      </div>

      {questions.length > 0 && (
        <div className="mt-6 border-t border-slate-100 pt-5">
          <QuestionThread questions={questions} seller={seller} />
        </div>
      )}

      {modal === "accept" && (
        <Modal title="Accept this quotation" onClose={() => setModal(null)}>
          <form onSubmit={(e) => { e.preventDefault(); respond({ action: "accept", signer_name: name.trim(), accepted_terms: agree }); }}>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <div className="flex justify-between gap-3"><span>{info.reference} · Version {info.version}</span><b className="tabular-nums">{fmtMoney(info.total, info.currency)}</b></div>
            </div>
            <label htmlFor="signer" className="mb-1.5 mt-4 block text-sm font-semibold text-slate-800">Your full name</label>
            <input id="signer" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus required minLength={2} maxLength={120}
              placeholder="Type your full name" aria-describedby="signer-help" className={inputCls} />
            <p id="signer-help" className="mt-1.5 text-[12px] text-slate-500">Typing your name is your signature on this acceptance.</p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-slate-700">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-600" />
              <span>I accept the quotation and its terms on behalf of {info.customer?.name || "my organisation"}.</span>
            </label>
            {error && <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={busy || name.trim().length < 2 || !agree}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy ? <><Spin /> Accepting…</> : "Accept quotation"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "ask" && (
        <Modal title={`Ask ${seller} a question`} onClose={() => setModal(null)}>
          <form onSubmit={(e) => { e.preventDefault(); if (question.trim().length >= 3) respond({ action: "question", message: question.trim() }); }}>
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} rows={5} autoFocus aria-label="Your question"
              placeholder="For example: can the work start next month, or is a smaller package available?" className={`${inputCls} resize-y`} />
            <div className="mt-1 text-right text-[11px] text-slate-400">{question.length}/2000</div>
            <p className="mt-2 text-[13px] text-slate-500">{seller} will reply by email. The quotation stays open while you decide.</p>
            {error && <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={busy || question.trim().length < 3}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {busy ? <><Spin /> Sending…</> : "Send question"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "decline" && (
        <Modal title="Decline this quotation?" onClose={() => setModal(null)}>
          <form onSubmit={(e) => { e.preventDefault(); respond({ action: "reject", reason: reason.trim() || null }); }}>
            <label htmlFor="decline-reason" className="mb-1.5 block text-sm font-semibold text-slate-800">
              Reason <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3}
              placeholder="It helps the business to know why." className={`${inputCls} resize-y`} />
            <p className="mt-2 text-[13px] text-slate-500">If something isn't right, you can ask a question instead and keep the quotation open.</p>
            {error && <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setModal("ask")} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Ask a question instead</button>
              <button type="submit" disabled={busy}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                {busy ? <><Spin /> Declining…</> : "Decline quotation"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

/** Phones: the actions stay within reach while reading the quotation. */
export function QuoteMobileBar({ info, onOpen }) {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      // Hidden once the full response panel is on screen, so the two never overlap.
      const panel = document.querySelector('[aria-label="Respond to this quotation"]');
      const r = panel?.getBoundingClientRect();
      setVisible(!(r && r.top < window.innerHeight - 40));
      lastY.current = window.scrollY;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);
  if (!info || info.state !== "open" || !visible) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:hidden">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="text-slate-500">Total</span>
        <b className="tabular-nums text-slate-900">{fmtMoney(info.total, info.currency)}</b>
      </div>
      <div className="grid grid-cols-[1.4fr_1fr_auto] gap-2">
        <button type="button" onClick={() => onOpen("accept")} className="rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white">Accept</button>
        <button type="button" onClick={() => onOpen("ask")} className="rounded-xl border border-indigo-200 bg-indigo-50 py-2.5 text-sm font-semibold text-indigo-700">Ask</button>
        <button type="button" onClick={() => onOpen("decline")} className="px-3 py-2.5 text-sm font-semibold text-slate-500">Decline</button>
      </div>
    </div>
  );
}
