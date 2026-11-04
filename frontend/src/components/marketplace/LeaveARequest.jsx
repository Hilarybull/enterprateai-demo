import { useEffect, useRef, useState } from "react";
import { Btn, Notice, inputClass } from "../readiness/Fields";
import { directoryError, leaveRequest } from "../../lib/directory";
import { humanCheck } from "../../lib/turnstile";
import { useAuthStore } from "../../store/auth";

// A quote or a question for a business that hasn't claimed its profile. It follows the same template as a
// request on a listing (the business's services, one line each, with a quantity). It is kept and handed to the
// business when a claim is verified, and buyers are told what a request on any listing tells them, nothing about the profile being unclaimed (the owner, 4 Nov).

const WAYS = [
  ["quote", "Request a quote", "Choose what you need and they can price it."],
  ["enquiry", "Ask a question", "Send a message for the business to answer."],
];
const OTHER = "__other__";

function Line({ label, error, children }) {
  return (
    <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
      {label}
      {children}
      {error && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{error}</span>}
    </label>
  );
}

export default function LeaveARequest({ slug, name, via, services = [], startQuoteFor = null }) {
  const token = useAuthStore((st) => st.token);
  const signedInEmail = useAuthStore((st) => st.email);
  const [kind, setKind] = useState(startQuoteFor ? "quote" : null);
  const box = useRef(null);
  useEffect(() => { if (startQuoteFor) box.current?.scrollIntoView?.({ block: "center" }); }, []);      // arrived from a service's Request Quotation button
  const [form, setForm] = useState({ name: "", email: signedInEmail || "", company: "", details: "" });
  const [items, setItems] = useState([{ name: startQuoteFor && (services.includes(startQuoteFor) || !services.length) ? startQuoteFor : services[0] || "", quantity: "1", custom: "" }]);
  const [state, setState] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const errors = state.errors || {};
  const change = (at, patch) => setItems((all) => all.map((it, i) => (i === at ? { ...it, ...patch } : it)));
  const chosen = new Set(items.map((it) => it.name).filter((n) => n && n !== OTHER));

  async function send(e) {
    e.preventDefault();
    setState({ busy: true });
    const lines = kind === "quote"
      ? items.map((it) => ({ name: (it.name === OTHER ? it.custom : it.name).trim(), quantity: Number(it.quantity) || 1 })).filter((it) => it.name)
      : [];
    try {
      await leaveRequest(slug, { kind, ...form, items: lines }, via, token ? undefined : await humanCheck());
      setState({ sent: true });
    } catch (err) {
      const p = directoryError(err, "Your request couldn't be sent. Please try again.");
      setState({ errors: p.errors, problem: Object.keys(p.errors || {}).length ? null : p.message });
    }
  }

  if (state.sent) {
    return (
      <Notice tone="emerald" data-request-sent>
        <span className="block font-bold">Request sent!</span>
        {kind === "quote" ? `${name} will review your request and send a quotation to your email.` : `${name} will review your question and reply to your email.`}
      </Notice>
    );
  }

  return (
    <div ref={box} data-leave-request>
      {!kind ? (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
          {WAYS.map(([key, label, line]) => (
            <li key={key} className="flex flex-wrap items-center gap-3 py-3 last:pb-0">
              <span className="min-w-[12rem] flex-1">
                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
                <span className="block text-[13px] text-slate-600 dark:text-slate-300">{line}</span>
              </span>
              <Btn className="!py-2 max-sm:w-full" onClick={() => setKind(key)}>{label}</Btn>
            </li>
          ))}
        </ul>
      ) : (
        <form onSubmit={send} noValidate aria-label={kind === "quote" ? "Request a quote" : "Ask a question"} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Line label="Your name" error={errors.name}><input className={`mt-1 ${inputClass}`} value={form.name} onChange={set("name")} autoComplete="name" /></Line>
            <Line label="Your email" error={errors.email}><input type="email" className={`mt-1 ${inputClass}`} value={form.email} onChange={set("email")} autoComplete="email" /></Line>
          </div>
          <Line label="Company (optional)"><input className={`mt-1 ${inputClass}`} value={form.company} onChange={set("company")} autoComplete="organization" /></Line>
          {kind === "quote" && (
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Products / services</p>
                {items.length < 20 && <Btn kind="link" className="text-[12px]" onClick={() => setItems((all) => [...all, { name: services.find((s) => !chosen.has(s)) || "", quantity: "1", custom: "" }])}>+ Add item</Btn>}
              </div>
              <div className="mt-1 space-y-2">
                {items.map((it, at) => (
                  <div key={at} className="space-y-1">
                    <div className="grid grid-cols-[1fr,5rem,auto] items-center gap-2">
                      {services.length > 0 ? (
                        <select aria-label={`Item ${at + 1}`} className={inputClass} value={it.name} onChange={(e) => change(at, { name: e.target.value })}>
                          <option value="">Select a product / service</option>
                          {services.map((s) => <option key={s} value={s} disabled={chosen.has(s) && it.name !== s}>{s}</option>)}
                          <option value={OTHER}>Other…</option>
                        </select>
                      ) : <input aria-label={`Item ${at + 1}`} className={inputClass} placeholder="Product or service" value={it.name} onChange={(e) => change(at, { name: e.target.value })} />}
                      <input type="number" min="1" aria-label={`Quantity for item ${at + 1}`} className={inputClass} value={it.quantity} onChange={(e) => change(at, { quantity: e.target.value })} />
                      {items.length > 1 ? <Btn kind="link" aria-label={`Remove item ${at + 1}`} className="text-[12px]" onClick={() => setItems((all) => all.filter((_, i) => i !== at))}>Remove</Btn> : <span />}
                    </div>
                    {it.name === OTHER && <input aria-label="What you need" className={inputClass} placeholder="Describe what you need" value={it.custom} onChange={(e) => change(at, { custom: e.target.value })} />}
                  </div>
                ))}
              </div>
              {errors.items && <p role="alert" className="mt-1 text-[12px] font-medium text-rose-600">{errors.items}</p>}
            </div>
          )}
          <Line label={kind === "quote" ? "Message (optional)" : "Your question"} error={errors.details}><textarea rows={3} className={`mt-1 ${inputClass}`} value={form.details} onChange={set("details")} /></Line>
          <p className="text-[12px] text-slate-500">Your details are kept private and only shared with the business once it has proved it manages this profile.</p>
          {state.problem && <p role="alert" className="text-[12px] font-medium text-rose-600">{state.problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Btn kind="primary" type="submit" disabled={state.busy}>{state.busy ? "Sending…" : "Send request"}</Btn>
            <Btn disabled={state.busy} onClick={() => { setKind(null); setState({}); }}>Back</Btn>
          </div>
        </form>
      )}
    </div>
  );
}
