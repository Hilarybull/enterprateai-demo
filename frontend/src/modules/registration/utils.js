export function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

export function pct(stepIndex, totalSteps) {
  const total = totalSteps || 1;
  const n = Math.min(total, Math.max(1, stepIndex + 1));
  return Math.round((n / total) * 100);
}

export function formatGbp(amount) {
  if (amount === null || amount === undefined) return "-";
  const n = Number(amount);
  if (Number.isNaN(n)) return "-";
  if (n === 0) return "£0";
  return `£${n.toFixed(0)}`;
}

