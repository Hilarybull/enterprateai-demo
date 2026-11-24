import { useEffect, useRef, useState } from "react";

// A date typed and shown the UK way (dd/mm/yyyy), whatever language the browser is set to (QA P2-12).
// The value in and out is ISO (yyyy-mm-dd), exactly as a native date input gives it, so it drops in
// where one was. The calendar is still there: the button opens the browser's own picker.

/** "2026-10-11" → "11/10/2026"; anything else → "". */
export function ukDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "11/10/2026", "11-10-2026" or "11.10.26" → "2026-10-11"; null when it isn't a real date. */
export function isoFromUk(text) {
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(String(text || ""));      // pasted as 2026-10-11: taken as it is
  if (iso) return isoFromUk(`${iso[3]}/${iso[2]}/${iso[1]}`);
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\s*$/.exec(String(text || ""));
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const month = Number(m[2]), day = Number(m[1]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function UkDateInput({ value, onChange, className = "", disabled = false, id, "aria-label": label, min, max, ...rest }) {
  const [text, setText] = useState(ukDate(value));
  const [bad, setBad] = useState(false);
  const picker = useRef(null);
  useEffect(() => { setText(ukDate(value)); setBad(false); }, [value]);

  function typed(next) {
    setText(next);
    if (!next.trim()) { setBad(false); onChange?.(""); return; }
    const iso = isoFromUk(next);
    setBad(!iso);
    if (iso) onChange?.(iso);
  }

  return (
    <span className="relative block">
      <input {...rest} id={id} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/yyyy" aria-label={label} disabled={disabled}
        aria-invalid={bad || undefined} value={text} onChange={(e) => typed(e.target.value)} onBlur={() => { if (!bad) setText(ukDate(value)); }}
        className={`${className} pr-10`} data-uk-date />
      <input ref={picker} type="date" tabIndex={-1} aria-hidden="true" value={value || ""} min={min} max={max} disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)} className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0" />
      <button type="button" disabled={disabled} aria-label={label ? `Choose ${label.toLowerCase()} from a calendar` : "Choose from a calendar"}
        onClick={() => { try { picker.current?.showPicker?.(); } catch { picker.current?.focus(); } }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 hover:text-slate-600">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4.5" width="14" height="12" rx="2" /><path d="M3 8.5h14M7 3v3M13 3v3" /></svg>
      </button>
      {bad && <span className="mt-1 block text-[12px] text-rose-600" role="alert">Use dd/mm/yyyy, for example 11/10/2026.</span>}
    </span>
  );
}
