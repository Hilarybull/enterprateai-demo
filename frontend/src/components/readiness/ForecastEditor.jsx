import { useEffect, useMemo, useState } from "react";
import { dateLabel, linkForecast, listForecasts, moneyLabel, monthLabel, newKey, readinessError, saveForecast } from "../../lib/readiness";
import { todayLocal } from "../../lib/format";
import { Btn, Notice, inputClass } from "./Fields";

// The monthly cash forecast both checks share. Blank means unknown and stays blank. The
// baseline counts only money that is received, or committed with evidence; anything proposed
// is kept out of it. Saving records that the figures were confirmed today.

function addMonths(key, n) {
  const total = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function startingPoint(subject, feature) {
  const f = subject.forecast;
  const data = f?.data || {};
  const first = data.start_month || todayLocal().slice(0, 7);
  const needed = f?.required_months?.length ? f.required_months : Array.from({ length: feature === "funding" ? 12 : 6 }, (_, i) => addMonths(first, i));
  const byMonth = Object.fromEntries((data.months || []).map((m) => [m.month, m]));
  const all = [...new Set([...needed, ...Object.keys(byMonth)])].sort();
  const line = (applies) => (data.assumptions || []).find((a) => a.applies_to === applies) || { applies_to: applies, text: "", source: "" };
  return {
    start_month: first, opening_cash: data.opening_cash ?? "", opening_cash_as_of: data.opening_cash_as_of || "", currency: data.currency || subject.data?.currency || "",
    months: all.map((month) => ({ month, receipts: byMonth[month]?.receipts ?? "", payments: byMonth[month]?.payments ?? "", basis: byMonth[month]?.basis || "forecast" })),
    assumptions: [line("receipts"), line("payments")],
    financing_items: data.financing_items || [], commitments: data.commitments || [], no_commitments: Boolean(data.no_commitments),
  };
}

export default function ForecastEditor({ businessId, feature, subject, evidence, onSaved, disabled }) {
  const [form, setForm] = useState(() => startingPoint(subject, feature));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState(null);
  const [others, setOthers] = useState([]);
  const forecast = subject.forecast;
  const computed = forecast?.computed;
  const currency = form.currency || subject.data?.currency || "GBP";
  const closing = useMemo(() => Object.fromEntries((computed?.months || []).map((m) => [m.month, m.closing])), [computed]);

  useEffect(() => { if (!dirty) setForm(startingPoint(subject, feature)); }, [subject.forecast?.revision, subject.forecast?.id]);      // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    listForecasts(businessId).then((r) => { if (live) setOthers((r.items || []).filter((x) => x.id !== forecast?.id)); }).catch(() => {});
    return () => { live = false; };
  }, [businessId, forecast?.id]);

  const change = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const setMonth = (i, key, value) => change({ months: form.months.map((m, n) => (n === i ? { ...m, [key]: value } : m)) });
  const setRow = (list, i, key, value) => change({ [list]: form[list].map((x, n) => (n === i ? { ...x, [key]: value } : x)) });

  async function save() {
    setSaving(true);
    setProblem(null);
    try {
      const payload = { ...form, months: form.months.map((m) => ({ ...m, receipts: m.receipts === "" ? null : m.receipts, payments: m.payments === "" ? null : m.payments })),
        opening_cash: form.opening_cash === "" ? null : form.opening_cash, assumptions: form.assumptions.filter((a) => a.text || a.source) };
      const detail = await saveForecast(businessId, feature, subject.id, payload, forecast?.revision);
      setDirty(false);
      onSaved(detail);
    } catch (e) {
      setProblem(readinessError(e, "The forecast couldn't be saved. Your figures are still here; try again."));
    } finally {
      setSaving(false);
    }
  }

  async function useExisting(id) {
    if (!id) return;
    try { onSaved(await linkForecast(businessId, feature, subject.id, id)); setDirty(false); } catch (e) { setProblem(readinessError(e)); }
  }

  const money = (i, key, label, value, onChange) => (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:sr-only">{label}</span>
      <input type="text" inputMode="decimal" aria-label={`${label}, ${monthLabel(form.months[i]?.month) || ""}`.replace(/, $/, "")} disabled={disabled}
        className={inputClass} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="Not known" />
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Opening cash</span>
          <span className="mt-0.5 block text-[12px] text-slate-500">Cash you actually have. Not funding you hope for.</span>
          <input type="text" inputMode="decimal" className={`mt-1 ${inputClass}`} disabled={disabled} value={form.opening_cash} onChange={(e) => change({ opening_cash: e.target.value })} placeholder="Not known" />
        </label>
        <label className="block">
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Cash figure is from</span>
          <span className="mt-0.5 block text-[12px] text-slate-500">The date of that balance.</span>
          <input type="date" className={`mt-1 ${inputClass}`} disabled={disabled} max={todayLocal()} value={form.opening_cash_as_of} onChange={(e) => change({ opening_cash_as_of: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Forecast starts</span>
          <span className="mt-0.5 block text-[12px] text-slate-500">The first month below.</span>
          <input type="month" className={`mt-1 ${inputClass}`} disabled value={form.months[0]?.month || form.start_month} readOnly />
        </label>
      </div>

      <div role="group" aria-label="Monthly receipts and payments">
        <div className="hidden grid-cols-[7rem_1fr_1fr_8rem_7rem] gap-2 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
          <span>Month</span><span>Cash receipts</span><span>Cash payments</span><span>Basis</span><span className="text-right">Closing cash</span>
        </div>
        <ul className="space-y-2">
          {form.months.map((m, i) => (
            <li key={m.month} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-2 sm:grid-cols-[7rem_1fr_1fr_8rem_7rem] sm:items-center sm:border-0 sm:p-0 dark:border-slate-700">
              <span className="col-span-2 text-sm font-semibold text-slate-800 sm:col-span-1 dark:text-slate-100">{monthLabel(m.month)}</span>
              {money(i, "receipts", "Receipts", m.receipts, (v) => setMonth(i, "receipts", v))}
              {money(i, "payments", "Payments", m.payments, (v) => setMonth(i, "payments", v))}
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:sr-only">Basis</span>
                <select aria-label={`Basis, ${monthLabel(m.month)}`} className={inputClass} disabled={disabled} value={m.basis} onChange={(e) => setMonth(i, "basis", e.target.value)}>
                  <option value="actual">Actual</option><option value="forecast">Forecast</option><option value="estimate">Estimate</option>
                </select>
              </label>
              <span className="self-center text-right text-sm tabular-nums text-slate-700 dark:text-slate-200">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:hidden">Closing </span>
                {!dirty && closing[m.month] !== undefined ? moneyLabel(closing[m.month], currency) : "—"}
              </span>
            </li>
          ))}
        </ul>
        {!disabled && (
          <Btn className="mt-2" onClick={() => change({ months: [...form.months, { month: addMonths(form.months[form.months.length - 1]?.month || form.start_month, form.months.length ? 1 : 0), receipts: "", payments: "", basis: "forecast" }] })}>
            Add a month
          </Btn>
        )}
        <p className="mt-2 text-[12px] text-slate-500">Closing cash = opening cash + receipts + financing − payments. Each month opens on the one before. Leave a figure blank if you don't know it: blank is not zero.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {form.assumptions.map((a, i) => (
          <div key={a.applies_to} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Assumption behind your {a.applies_to}</p>
            <textarea aria-label={`Assumption behind your ${a.applies_to}`} rows={2} className={`mt-1 ${inputClass}`} disabled={disabled} value={a.text} onChange={(e) => setRow("assumptions", i, "text", e.target.value)} placeholder="What the figures assume" />
            <input type="text" aria-label={`Source for your ${a.applies_to}`} className={`mt-2 ${inputClass}`} disabled={disabled} value={a.source} onChange={(e) => setRow("assumptions", i, "source", e.target.value)} placeholder="Where it comes from" />
          </div>
        ))}
      </div>

      <div>
        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Financing</p>
        <p className="text-[12px] text-slate-500">Only money received, or committed with a document or business record attached (a signed agreement, a bank statement), counts as cash. A letter of intent is interest, not a commitment. Proposed funding is shown but left out of the baseline.</p>
        <ul className="mt-2 space-y-2">
          {form.financing_items.map((x, i) => (
            <li key={x.id} className="grid gap-2 rounded-xl border border-slate-200 p-2 sm:grid-cols-[1fr_8rem_8rem_9rem_1fr_auto] dark:border-slate-700">
              <input type="text" aria-label="Financing description" className={inputClass} disabled={disabled} value={x.label || ""} onChange={(e) => setRow("financing_items", i, "label", e.target.value)} placeholder="What it is" />
              <input type="month" aria-label="Financing month" className={inputClass} disabled={disabled} value={x.month || ""} onChange={(e) => setRow("financing_items", i, "month", e.target.value)} />
              <input type="text" inputMode="decimal" aria-label="Financing amount" className={inputClass} disabled={disabled} value={x.amount ?? ""} onChange={(e) => setRow("financing_items", i, "amount", e.target.value)} placeholder="Amount" />
              <select aria-label="Financing status" className={inputClass} disabled={disabled} value={x.status || "proposed"} onChange={(e) => setRow("financing_items", i, "status", e.target.value)}>
                <option value="proposed">Proposed</option><option value="committed">Committed</option><option value="received">Received</option>
              </select>
              <select aria-label="Financing evidence" className={inputClass} disabled={disabled} value={x.evidence_id || ""} onChange={(e) => setRow("financing_items", i, "evidence_id", e.target.value || null)}>
                <option value="">No evidence attached</option>
                {(evidence || []).filter((e) => ["document", "record", "other"].includes(e.type) || e.id === x.evidence_id).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
              {!disabled && <Btn kind="link" className="text-[12px] !text-rose-600" onClick={() => change({ financing_items: form.financing_items.filter((_, n) => n !== i) })}>Remove</Btn>}
            </li>
          ))}
        </ul>
        {!disabled && <Btn className="mt-2" onClick={() => change({ financing_items: [...form.financing_items, { id: newKey(), status: "proposed" }] })}>Add financing</Btn>}
      </div>

      {feature === "launch" && (
        <div>
          <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Setup and operating commitments</p>
          <p className="text-[12px] text-slate-500">What you are committed to paying. Mark each as evidenced or as an assumption.</p>
          <ul className="mt-2 space-y-2">
            {form.commitments.map((x, i) => (
              <li key={x.id} className="grid gap-2 rounded-xl border border-slate-200 p-2 sm:grid-cols-[1fr_7rem_8rem_8rem_9rem_1fr_auto] dark:border-slate-700">
                <input type="text" aria-label="Commitment" className={inputClass} disabled={disabled} value={x.label || ""} onChange={(e) => setRow("commitments", i, "label", e.target.value)} placeholder="What it is" />
                <select aria-label="Commitment kind" className={inputClass} disabled={disabled} value={x.kind || "operating"} onChange={(e) => setRow("commitments", i, "kind", e.target.value)}>
                  <option value="setup">Setup</option><option value="operating">Operating</option>
                </select>
                <input type="month" aria-label="Commitment month" className={inputClass} disabled={disabled} value={x.month || ""} onChange={(e) => setRow("commitments", i, "month", e.target.value)} />
                <input type="text" inputMode="decimal" aria-label="Commitment amount" className={inputClass} disabled={disabled} value={x.amount ?? ""} onChange={(e) => setRow("commitments", i, "amount", e.target.value)} placeholder="Amount" />
                <select aria-label="Commitment basis" className={inputClass} disabled={disabled} value={x.basis || ""} onChange={(e) => setRow("commitments", i, "basis", e.target.value || null)}>
                  <option value="">Not labelled</option><option value="evidenced">Evidenced</option><option value="assumption">Assumption</option>
                </select>
                <select aria-label="Commitment evidence" className={inputClass} disabled={disabled} value={x.evidence_id || ""} onChange={(e) => setRow("commitments", i, "evidence_id", e.target.value || null)}>
                  <option value="">No evidence attached</option>
                  {(evidence || []).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
                {!disabled && <Btn kind="link" className="text-[12px] !text-rose-600" onClick={() => change({ commitments: form.commitments.filter((_, n) => n !== i) })}>Remove</Btn>}
              </li>
            ))}
          </ul>
          {!disabled && <Btn className="mt-2" onClick={() => change({ commitments: [...form.commitments, { id: newKey(), kind: "operating" }] })}>Add a commitment</Btn>}
          {form.commitments.length === 0 && (
            <label className="mt-2 flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-200">
              <input type="checkbox" disabled={disabled} checked={form.no_commitments} onChange={(e) => change({ no_commitments: e.target.checked })} />
              There are no setup or operating commitments
            </label>
          )}
        </div>
      )}

      {problem && (
        <Notice tone="rose" role="alert">
          <p className="font-semibold">{problem.message}</p>
          {Object.values(problem.errors || {}).length > 1 && <ul className="mt-1 list-disc pl-5">{Object.entries(problem.errors).map(([k, v]) => <li key={k}>{v}</li>)}</ul>}
          {problem.code === "stale_revision" && <p className="mt-1">Your figures are still in the form. Save again to apply them to the latest version.</p>}
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!disabled && <Btn kind="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : problem ? "Try saving again" : "Save and confirm these figures"}</Btn>}
        <span className="text-[12px] text-slate-500" role="status">
          {dirty ? "You have unsaved changes." : forecast?.data?.confirmed_at ? `Confirmed on ${dateLabel(forecast.data.confirmed_at)}.` : "Not saved yet."}
        </span>
        {!disabled && others.length > 0 && (
          <label className="ml-auto flex items-center gap-2 text-[12px] text-slate-500">
            Use a forecast you already have
            <select className={`${inputClass} !w-auto`} value="" onChange={(e) => useExisting(e.target.value)}>
              <option value="">Choose…</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}{o.used_by?.length ? ` (${o.used_by.join(", ")})` : ""}</option>)}
            </select>
          </label>
        )}
      </div>

      {computed && !dirty && (
        <Notice tone={computed.state === "complete" ? (computed.first_negative_month ? "rose" : "emerald") : "slate"}>
          {computed.state === "complete" ? (
            <>
              <p className="font-semibold">
                Lowest cash: {moneyLabel(computed.min_cash?.amount, currency)} in {monthLabel(computed.min_cash?.month)}.{" "}
                {computed.first_negative_month ? `Cash falls below zero in ${monthLabel(computed.first_negative_month)}.` : "Cash stays above zero in every month it must cover."}
              </p>
              <p className="mt-1">{computed.label}</p>
            </>
          ) : computed.state === "invalid" ? (
            <p><span className="font-semibold">Some figures aren't valid:</span> {computed.issues.slice(0, 3).join(" ")}</p>
          ) : (
            <p><span className="font-semibold">Not complete yet.</span> Still needed: {computed.missing.slice(0, 4).join("; ")}{computed.missing.length > 4 ? ` and ${computed.missing.length - 4} more` : ""}.</p>
          )}
          {computed.excluded_financing?.length > 0 && <p className="mt-1">Left out of the baseline: {computed.excluded_financing.map((x) => `${x.label} (${x.reason.replace(/\.$/, "")})`).join("; ")}.</p>}
        </Notice>
      )}
    </div>
  );
}
