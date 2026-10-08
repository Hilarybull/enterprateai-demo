import { useEffect, useRef, useState } from "react";
import { usePageVisible, useReducedMotion } from "../lib/motion";

// A scripted demo of the Agent, played in whatever box it is given (the product preview on the
// homepage, or a sheet on a phone). It never plays by itself: the caller mounts it on a click.
// It fills its parent and changes nothing outside it, so starting and ending it moves nothing.
//
// Scenes come from a config (src/config/agentDemo.js). With reduced motion the scenes are three
// still frames with Back and Next. Everything it says is in an aria-live caption.

const TICK = 100;

const Check = () => (
  <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-600" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4"><path className="m-check-draw" strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
);
const Spark = ({ className = "h-4 w-4" }) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.6a3 3 0 001.9 1.9L21.4 11.4a.6.6 0 010 1.2l-5.6 1.9a3 3 0 00-1.9 1.9L12 22l-1.9-5.6a3 3 0 00-1.9-1.9L2.6 12.6a.6.6 0 010-1.2l5.6-1.9a3 3 0 001.9-1.9L12 2z" /></svg>
);

/** One scene, drawn at `progress` (0 to 1) through it. At 1 it is the finished frame, which is what reduced motion shows. */
function Scene({ scene, progress }) {
  if (scene.kind === "type") {
    const shown = scene.text.slice(0, Math.round(Math.min(1, progress / 0.7) * scene.text.length));
    return (
      <div className="flex h-full flex-col justify-center gap-3 px-5">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-900"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 via-purple-500 to-pink-500 text-white"><Spark /></span>EnterprateAI Agent</p>
        <div className="flex h-12 items-center gap-2 rounded-xl border-2 border-brand-500 bg-white pl-3.5 pr-1.5 shadow-sm">
          <span className="min-w-0 flex-1 truncate text-sm text-slate-900" data-demo-typed>{shown}{progress < 0.7 && <span aria-hidden="true" className="ml-px text-brand-500">|</span>}</span>
          <span aria-hidden="true" className={`rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-semibold text-white ${progress >= 0.8 ? "m-chip-pulse" : ""}`}>Start</span>
        </div>
      </div>
    );
  }
  if (scene.kind === "steps") {
    const done = Math.floor(progress * (scene.steps.length + 0.6));
    return (
      <div className="flex h-full flex-col justify-center px-5">
        <p className="text-sm font-bold text-slate-900">Working on it</p>
        <ol className="mt-3 space-y-2.5">
          {scene.steps.map((label, n) => (
            <li key={label} data-demo-step={n < done ? "done" : n === done ? "now" : "next"} className={`flex items-center gap-2 text-[13px] ${n > done ? "text-slate-400" : "font-medium text-slate-800"}`}>
              {n < done ? <Check /> : n === done ? <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-brand-500 border-r-transparent motion-safe:animate-spin" />
                : <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-200" />}
              {label}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  const c = scene.card;
  return (
    <div className="flex h-full flex-col justify-center px-5">
      <p className="flex items-center gap-2 text-sm font-bold text-slate-900">Needs your approval <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-50 px-1.5 text-[11px] font-bold text-brand-700">1</span></p>
      {progress > 0.12 && (
        <div data-m="slideDown" data-demo-card className="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-slate-900">Invoice {c.reference}</p>
              <p className="text-[12px] text-slate-500">{c.customer} · {c.due}</p>
            </div>
            <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{c.amount}</p>
          </div>
          <span aria-hidden="true" className={`mt-3 inline-flex rounded-lg bg-brand-600 px-3.5 py-1.5 text-[12px] font-semibold text-white ${progress > 0.45 ? "m-pulse-ring" : ""}`}>Approve</span>
        </div>
      )}
    </div>
  );
}

/**
 * `scenes`: the script. `onClose`: the cross, Esc. `onTry`: "Try it yourself". `onEvent(name)`:
 * analytics ("demo_completed" when the last scene is reached). `fill`: fill the parent box (the
 * homepage preview); otherwise it is as tall as it needs (a sheet).
 */
export default function AgentDemo({ scenes, onClose, onTry, onEvent, fill = true }) {
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const total = scenes.reduce((sum, s) => sum + s.ms, 0);
  const [t, setT] = useState(0);            // milliseconds into the script
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);    // reduced motion: which still frame
  const completed = useRef(false);
  const ended = reduced ? false : t >= total;

  useEffect(() => {
    if (reduced || !playing || !visible || ended) return undefined;
    const timer = setInterval(() => setT((v) => Math.min(total, v + TICK)), TICK);
    return () => clearInterval(timer);
  }, [reduced, playing, visible, ended, total]);

  // Which scene, and how far through it.
  let at = 0;
  let left = t;
  while (at < scenes.length - 1 && left >= scenes[at].ms) { left -= scenes[at].ms; at += 1; }
  const index = reduced ? frame : at;
  const scene = scenes[index];
  const progress = reduced ? 1 : Math.min(1, left / scene.ms);
  const last = index === scenes.length - 1;

  useEffect(() => {
    if (last && !completed.current) { completed.current = true; onEvent?.("demo_completed"); }
  }, [last]);      // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const replay = () => { setT(0); setFrame(0); setPlaying(true); };
  const control = "flex h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500";

  return (
    <section role="region" aria-label="Demo of the Agent" data-agent-demo data-scene={scene.key}
      className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg ${fill ? "absolute inset-0" : "min-h-[340px]"}`}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <p className="text-[12px] font-semibold text-slate-600">Scene {index + 1} of {scenes.length}</p>
        <div className="flex items-center gap-1.5">
          {reduced ? (
            <>
              <button type="button" className={control} disabled={frame === 0} onClick={() => setFrame((f) => Math.max(0, f - 1))}>Back</button>
              <button type="button" className={control} disabled={last} onClick={() => setFrame((f) => Math.min(scenes.length - 1, f + 1))}>Next</button>
            </>
          ) : (
            <>
              <button type="button" className={control} onClick={() => (ended ? replay() : setPlaying((p) => !p))} aria-label={ended ? "Replay" : playing ? "Pause" : "Play"}>{ended ? "Replay" : playing ? "Pause" : "Play"}</button>
              {!ended && <button type="button" className={control} onClick={replay}>Replay</button>}
            </>
          )}
          <button type="button" className={control} onClick={onClose} aria-label="Close the demo">
            <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      <div className="relative min-h-[180px] flex-1">
        {ended || (reduced && last) ? (
          <div className={`flex h-full flex-col items-center justify-center gap-3 px-5 text-center ${reduced ? "" : "m-crossfade"}`}>
            {reduced && <div className="w-full text-left"><Scene scene={scene} progress={1} /></div>}
            <p className="text-base font-bold text-slate-900">Your turn</p>
            <button type="button" data-demo-try onClick={onTry}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
              Try it yourself
            </button>
          </div>
        ) : (
          <div key={scene.key} className={`h-full ${reduced ? "" : "m-crossfade"}`}><Scene scene={scene} progress={progress} /></div>
        )}
      </div>

      {/* The caption bar: the scene's title, where it is in the three, and what is happening, read out as it changes. */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5">
        <div className="min-w-0" aria-live="polite">
          <p className="text-[13px] font-bold text-slate-900" data-demo-title>{ended ? "Your turn" : scene.title}</p>
          <p className="truncate text-[12px] text-slate-500">{ended ? "Ask the Agent for what you need." : scene.caption}</p>
        </div>
        <ol aria-label={`Scene ${index + 1} of ${scenes.length}`} className="flex shrink-0 items-center gap-1.5" data-demo-dots>
          {scenes.map((s, n) => <li key={s.key} aria-hidden="true" className={`h-2 w-2 rounded-full ${n === index ? "bg-brand-600" : n < index || ended ? "bg-brand-300" : "bg-slate-200"}`} />)}
        </ol>
      </div>
    </section>
  );
}
