export function formatCurrency(n, currency = "USD") {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  const cur = typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n);
  } catch {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
  }
}

export function formatPercent(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function formatNumber(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}
