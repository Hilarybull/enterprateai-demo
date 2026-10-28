// Each researched or estimated item's own confidence, with its reason (the owner's UI change, 22 Oct; P11):
//   High: two or more independent current sources (or the research's own high score);
//   Medium: one current source;
//   Low: an estimate, sources out of date, or nothing to check it against.
// What the owner entered is "From you", never a confidence.
const YEARS_CURRENT = 2;

const yearsOld = (iso, now) => {
  const d = new Date(String(iso || "").slice(0, 10));
  return Number.isNaN(d.getTime()) ? null : (now - d) / (365.25 * 24 * 3600 * 1000);
};

export function itemConfidence(item, now = new Date()) {
  if (!item) return null;
  if (item.kind === "reused" || item.private || item.basis === "your answer") return { label: "From you", reason: "You gave this." };
  if (item.kind === "estimated" || item.basis === "benchmark" || item.basis === "estimate") {
    return { label: "Low", reason: item.method ? `Estimated: ${item.method}` : "An estimate, not a sourced figure." };
  }
  const sources = (item.sources || []).filter((s) => s && (s.url || s.publisher || s.site));
  const publishers = new Set(sources.map((s) => String(s.publisher || s.site || s.url || "").toLowerCase()).filter(Boolean));
  const ages = sources.map((s) => yearsOld(s.date, now)).filter((a) => a !== null);
  const stale = ages.length > 0 && ages.every((a) => a > YEARS_CURRENT);
  if (!sources.length) return { label: "Low", reason: "No source to check it against." };
  if (stale) return { label: "Low", reason: `Out of date: the newest source is over ${YEARS_CURRENT} years old.` };
  // From the sources only, never the research's own score (the owner, 28 Oct: one undated listing marked High)
  if (publishers.size >= 2 && ages.length) return { label: "High", reason: `${publishers.size} independent sources agree.` };
  if (publishers.size >= 2) return { label: "Medium", reason: `${publishers.size} sources, none of them dated.` };
  if (!ages.length) return { label: "Low", reason: "Only one source, and it has no date." };
  return { label: "Medium", reason: "Only one source." };
}
