function _isoCode(currency) {
  if (!currency || typeof currency !== "string") return "GBP";
  const trimmed = currency.trim();
  // Accept "British Pound (GBP)", "USD", "US Dollar (USD)" etc. — extract the 3-letter ISO code
  const match = trimmed.match(/\(([A-Z]{3})\)\s*$/) || trimmed.match(/^([A-Z]{3})$/i);
  return match ? match[1].toUpperCase() : trimmed.toUpperCase();
}

export function formatCurrency(n, currency = "GBP") {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  const cur = _isoCode(currency);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n);
  } catch {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(n);
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
