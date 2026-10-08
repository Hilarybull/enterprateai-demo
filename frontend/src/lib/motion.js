import { useEffect, useRef, useState } from "react";

// One set of motion rules for the whole app. Everything moves with transform and opacity only
// (plus stroke-dashoffset for drawn lines), so nothing changes size or pushes anything else.
// The classes that use these values are in index.css (.m-*); the two must be kept in step.
//
// Anyone who has asked their device for less motion gets the finished state at once:
// no fades, no counting, no typing, no loops.

export const DURATION = { fast: 150, base: 250, slow: 400 };
export const EASE = "cubic-bezier(.2,.8,.2,1)";
export const STAGGER = 60;
/** Where each entrance starts from. It always ends at rest: no offset, full size, fully opaque. */
export const VARIANTS = {
  fadeUp: { from: { opacity: 0, y: 12 }, className: "m-fade-up" },
  fadeIn: { from: { opacity: 0 }, className: "m-fade-in" },
  scaleIn: { from: { opacity: 0, scale: 0.96 }, className: "m-scale-in" },
  slideInRight: { from: { opacity: 0, x: 24 }, className: "m-slide-in-right" },
};

/** Class and delay for an entrance: `<div {...enter("fadeUp", 2)}>` is the third thing in a staggered group. */
export function enter(variant = "fadeUp", index = 0, extraDelay = 0) {
  return { "data-m": variant, style: { "--m-delay": `${index * STAGGER + extraDelay}ms` } };
}

const QUERY = "(prefers-reduced-motion: reduce)";
/** True when motion should be skipped. Also true where the browser can't say (so tests and old browsers get the finished state). */
export function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  try { return window.matchMedia(QUERY).matches; } catch { return true; }
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(QUERY);
    const changed = () => setReduced(media.matches);
    media.addEventListener?.("change", changed);
    return () => media.removeEventListener?.("change", changed);
  }, []);
  return reduced;
}

/** Whether the element is on screen. `once`: stays true after the first time. Without the browser support it is simply true. */
export function useInView(ref, { once = true, amount = 0.2 } = {}) {
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const watch = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setSeen(true); if (once) watch.disconnect(); } else if (!once) setSeen(false);
    }, { threshold: amount });
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref, once, amount]);
  return seen;
}

/** True while the tab is the one being looked at. Loops stop when it isn't. */
export function usePageVisible() {
  const [visible, setVisible] = useState(typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  return visible;
}

/**
 * A number that counts up to `value`: from 0 the first time, and from the last value when it changes.
 * `run` holds it at the start until the element is in view. With reduced motion it is the value at once.
 */
export function useCountUp(value, { ms = 600, run = true } = {}) {
  const target = Number.isFinite(Number(value)) ? Number(value) : 0;
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? target : 0);
  const from = useRef(reduced ? target : 0);
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame === "undefined") { from.current = target; setShown(target); return undefined; }
    if (!run) return undefined;
    const start = from.current;
    if (start === target) { setShown(target); return undefined; }
    let frame = 0;
    const began = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - began) / ms);
      const eased = 1 - (1 - t) ** 3;
      const next = start + (target - start) * eased;
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step); else { from.current = target; setShown(target); }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms, run, reduced]);
  return shown;
}

/**
 * Scroll reveals for a page: each section's heading and the items of its grids rise in as they are
 * scrolled to, the items one after another. Once only. `select` picks the elements; the hook adds
 * the classes, so with reduced motion (or no browser support) nothing is ever hidden.
 */
export function useScrollReveal(select, deps = []) {
  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") return undefined;
    const groups = select() || [];
    const all = [];
    const watch = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("m-in"); watch.unobserve(e.target); }
    }, { threshold: 0.2 });
    for (const group of groups) {
      group.forEach((el, i) => {
        el.classList.add("m-reveal");
        el.style.setProperty("--m-delay", `${Math.min(i, 8) * STAGGER}ms`);
        all.push(el);
        watch.observe(el);
      });
    }
    return () => { watch.disconnect(); for (const el of all) { el.classList.remove("m-reveal", "m-in"); el.style.removeProperty("--m-delay"); } };
  }, deps);      // eslint-disable-line react-hooks/exhaustive-deps
}

/** Types `phrases` one after another, deleting each before the next. Returns the text so far. Stops (and returns "") when `paused`. */
export function useTypewriter(phrases, { paused = false, typeMs = 55, holdMs = 1600, eraseMs = 28 } = {}) {
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const [text, setText] = useState("");
  const at = useRef({ phrase: 0, chars: 0, erasing: false });
  const stopped = reduced || paused || !visible || !phrases?.length;
  useEffect(() => {
    if (stopped) return undefined;
    let timer = 0;
    const tick = () => {
      const s = at.current;
      const full = phrases[s.phrase % phrases.length];
      if (!s.erasing && s.chars < full.length) { s.chars += 1; setText(full.slice(0, s.chars)); timer = setTimeout(tick, typeMs); }
      else if (!s.erasing) { s.erasing = true; timer = setTimeout(tick, holdMs); }
      else if (s.chars > 0) { s.chars -= 1; setText(full.slice(0, s.chars)); timer = setTimeout(tick, eraseMs); }
      else { s.erasing = false; s.phrase += 1; timer = setTimeout(tick, 300); }
    };
    timer = setTimeout(tick, 400);
    return () => clearTimeout(timer);
  }, [stopped, phrases, typeMs, holdMs, eraseMs]);
  return stopped ? "" : text;
}

/**
 * Closing with an exit: `const [leaving, close] = useExit(onClose)`. `close()` marks the thing as
 * leaving (so it can play its way out) and calls `onClose` when that is over. With reduced motion
 * it closes at once. Buttons inside keep working while it leaves.
 */
export function useExit(onClose, ms = DURATION.fast) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = (...args) => {
    if (leaving) return;
    if (prefersReducedMotion()) { onClose?.(...args); return; }
    setLeaving(true);
    timer.current = setTimeout(() => onClose?.(...args), ms);
  };
  return [leaving, close];
}

/**
 * A list whose rows arrive and leave. Returns the rows to draw: the current ones, plus any that
 * have just gone (kept for `ms` so they can fold away), each with `entering` or `leaving` set.
 * Nothing is marked on the first draw, and with reduced motion rows simply appear and go.
 */
export function useListChanges(items, keyOf, { ms = DURATION.base, flashMs = 1500 } = {}) {
  const reduced = useReducedMotion();
  const before = useRef(null);
  const [gone, setGone] = useState([]);
  const [fresh, setFresh] = useState(() => new Set());
  const keys = items.map(keyOf).join("\u0001");
  useEffect(() => {
    const was = before.current;
    before.current = items.map((item, index) => ({ key: keyOf(item), item, index }));
    if (reduced || !was) return undefined;
    const now = new Set(items.map(keyOf));
    const left = was.filter((r) => !now.has(r.key));
    const came = items.map(keyOf).filter((k) => !was.some((r) => r.key === k));
    const timers = [];
    if (left.length) {
      setGone((g) => [...g.filter((r) => !now.has(r.key)), ...left]);
      timers.push(setTimeout(() => setGone((g) => g.filter((r) => !left.includes(r))), ms + 40));
    }
    if (came.length) {
      setFresh((f) => new Set([...f, ...came]));
      timers.push(setTimeout(() => setFresh((f) => { const n = new Set(f); for (const k of came) n.delete(k); return n; }), flashMs));
    }
    return undefined;      // the timers finish on their own: clearing them on the next change would leave a row stuck
  }, [keys, reduced]);      // eslint-disable-line react-hooks/exhaustive-deps
  const rows = items.map((item) => ({ key: keyOf(item), item, entering: fresh.has(keyOf(item)), leaving: false }));
  for (const r of [...gone].sort((a, b) => a.index - b.index)) {
    if (!rows.some((x) => x.key === r.key)) rows.splice(Math.min(r.index, rows.length), 0, { key: r.key, item: r.item, entering: false, leaving: true });
  }
  return rows;
}
