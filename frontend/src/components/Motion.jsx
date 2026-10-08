import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DURATION, EASE, useCountUp, useInView, useReducedMotion } from "../lib/motion";

// Small moving parts built on src/lib/motion.js. Each one renders its finished state when motion
// is reduced, and never changes the size of what it is in.

const NUMBER = /-?\d[\d,]*(\.\d+)?/;

/**
 * A figure that counts up to its value: "£138,500.00" counts from £0.00, keeping its sign, grouping
 * and decimals, and counts on from where it was when the value changes. Text with no number in it
 * is shown as it is. The full value is always what a screen reader hears.
 */
export function CountText({ text, ms = 600 }) {
  const box = useRef(null);
  const seen = useInView(box);
  const value = String(text ?? "");
  const found = value.match(NUMBER);
  const decimals = found?.[1] ? found[1].length - 1 : 0;
  const target = found ? Number(found[0].replace(/,/g, "")) : 0;
  const now = useCountUp(target, { ms, run: seen });
  if (!found || now === target) return <span ref={box}>{value}</span>;      // at rest: the text itself, nothing added
  const shown = now.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <span ref={box}>
      <span aria-hidden="true">{value.slice(0, found.index)}{shown}{value.slice(found.index + found[0].length)}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}

/**
 * A row that folds away when `leaving`: its height (measured, so nothing jumps) and opacity go to
 * nothing together. The one place a height is animated. While it leaves it can't be clicked or read out.
 */
export function Collapse({ leaving, children, className = "" }) {
  const box = useRef(null);
  const [style, setStyle] = useState(undefined);
  useLayoutEffect(() => {
    const el = box.current;
    if (!leaving || !el) { setStyle(undefined); return undefined; }
    setStyle({ height: el.offsetHeight, opacity: 1, overflow: "hidden" });
    const frame = requestAnimationFrame(() => setStyle({ height: 0, opacity: 0, overflow: "hidden", marginTop: 0, marginBottom: 0,
      transition: `height ${DURATION.base}ms ${EASE}, opacity ${DURATION.base}ms ${EASE}, margin ${DURATION.base}ms ${EASE}` }));
    return () => cancelAnimationFrame(frame);
  }, [leaving]);
  return <div ref={box} style={style} aria-hidden={leaving || undefined} className={`${leaving ? "pointer-events-none" : ""} ${className}`}>{children}</div>;
}

/**
 * The Agent at work: its steps tick in one after another while a request runs. There is no step
 * feed from the server, so the first two advance on a short timer and the last is ticked only when
 * the work really is back (`done`). With reduced motion it is one plain line.
 */
export function WorkingSteps({ done = false, steps = ["Reading your request", "Working on it", "Ready for you"] }) {
  const reduced = useReducedMotion();
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (done || reduced) return undefined;
    const timer = setTimeout(() => setAt(1), 1200);
    return () => clearTimeout(timer);
  }, [done, reduced]);
  const finished = done ? steps.length : at;
  if (reduced) return <p role="status" className="text-[13px] text-slate-600 dark:text-slate-300">{done ? steps[steps.length - 1] : steps[1]}</p>;
  return (
    <ol role="status" aria-live="polite" data-working-steps className="flex flex-wrap gap-x-4 gap-y-1">
      {steps.map((label, n) => {
        const state = n < finished ? "done" : n === finished ? "now" : "next";
        return (
          <li key={label} data-step={state} className={`flex items-center gap-1.5 text-[12px] ${state === "next" ? "text-slate-400" : "font-semibold text-slate-700 dark:text-slate-200"}`}>
            {state === "done" ? <svg aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6"><path className="m-check-draw" strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
              : state === "now" ? <span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-brand-500 border-r-transparent motion-safe:animate-spin" />
                : <span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-300" />}
            {label}
          </li>
        );
      })}
    </ol>
  );
}
