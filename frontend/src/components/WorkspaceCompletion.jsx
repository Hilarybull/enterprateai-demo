import { Link } from "react-router-dom";

// A small progress ring for the workspace card: how much of the workspace profile is filled
// in, with the percentage in the middle. Colour follows the level: red while most is missing,
// amber part-way, green when nearly or fully done. It links to where the profile is edited.
const LEVEL = {
  low: { ring: "#e11d48", text: "text-rose-600 dark:text-rose-400", word: "Just started" },
  medium: { ring: "#d97706", text: "text-amber-600 dark:text-amber-400", word: "In progress" },
  high: { ring: "#059669", text: "text-emerald-600 dark:text-emerald-400", word: "Almost done" },
  complete: { ring: "#059669", text: "text-emerald-600 dark:text-emerald-400", word: "Complete" },
};

export default function WorkspaceCompletion({ completion, to = "/account?section=workspace", onClick, size = 36 }) {
  if (!completion) return null;
  const { percent, missing, level } = completion;
  const style = LEVEL[level] || LEVEL.low;
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const next = missing.slice(0, 3).join(", ");
  const label = level === "complete"
    ? "Workspace profile 100% complete"
    : `Workspace profile ${percent}% complete. Still to add: ${next}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}`;
  return (
    <Link to={to} onClick={onClick} title={label} aria-label={label}
      className="relative flex shrink-0 items-center justify-center rounded-full outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-brand-300"
      style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="progressbar"
        aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Workspace profile completion">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-200 dark:stroke-slate-700" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" stroke={style.ring}
          strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} style={{ transition: "stroke-dashoffset 500ms ease, stroke 300ms ease" }} />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center font-bold tabular-nums ${style.text} ${level === "complete" ? "" : "text-[10px]"}`}>
        {level === "complete"
          ? <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
          : `${percent}%`}
      </span>
    </Link>
  );
}

export function completionWord(level) {
  return (LEVEL[level] || LEVEL.low).word;
}
