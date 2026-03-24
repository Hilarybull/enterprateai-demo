function clamp01(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function toneForScore(score) {
  const s = clamp01(score);
  if (s >= 80) {
    return {
      tone: "success",
      barClass: "bg-emerald-600",
      trackClass: "bg-emerald-50",
      borderClass: "border-emerald-200",
      chipClass: "bg-emerald-50 text-emerald-700 ring-emerald-200"
    };
  }
  if (s >= 60) {
    return {
      tone: "brand",
      barClass: "bg-brand-600",
      trackClass: "bg-brand-50",
      borderClass: "border-brand-200",
      chipClass: "bg-brand-50 text-brand-700 ring-brand-200"
    };
  }
  if (s >= 40) {
    return {
      tone: "warn",
      barClass: "bg-amber-600",
      trackClass: "bg-amber-50",
      borderClass: "border-amber-200",
      chipClass: "bg-amber-50 text-amber-700 ring-amber-200"
    };
  }
  return {
    tone: "danger",
    barClass: "bg-rose-600",
    trackClass: "bg-rose-50",
    borderClass: "border-rose-200",
    chipClass: "bg-rose-50 text-rose-700 ring-rose-200"
  };
}

export function pctWidth(score) {
  const s = clamp01(score);
  return `${s}%`;
}

export function shortExplanation(text, maxLen = 110) {
  if (!text) return "";
  const t = String(text).trim().replace(/\s+/g, " ");
  if (!t) return "";
  const first = t.split(". ")[0] || t;
  const out = first.endsWith(".") ? first : first + ".";
  if (out.length <= maxLen) return out;
  return out.slice(0, Math.max(0, maxLen - 3)).trimEnd() + "...";
}
