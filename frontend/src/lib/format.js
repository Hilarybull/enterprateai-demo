function _isoCode(currency) {
  if (!currency || typeof currency !== "string") return "GBP";
  const trimmed = currency.trim();
  // Accept "British Pound (GBP)", "USD", "US Dollar (USD)" etc. — extract the 3-letter ISO code
  const match = trimmed.match(/\(([A-Z]{3})\)\s*$/) || trimmed.match(/^([A-Z]{3})$/i);
  return match ? match[1].toUpperCase() : trimmed.toUpperCase();
}

// `locale` is the browser's by default; pass one (e.g. "en-GB") where the layout is fixed.
export function formatCurrency(n, currency = "GBP", locale = undefined) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  const cur = _isoCode(currency);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: cur }).format(n);
  } catch {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "GBP" }).format(n);
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

// Today's date (YYYY-MM-DD) where the user is. `toISOString()` gives the UTC date, which is
// yesterday or tomorrow for part of every day outside the UK winter.
export function todayLocal(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// An id for a new record. The server replaces anything that isn't a real id when it saves.
export function newRecordId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A date as "26 Sep 2026" on every page (the browser's own short form gives "Sept" in some versions). */
export function shortDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? String(value) : `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const looksLikeId = (s) => !s || /^[0-9a-f-]{8,36}$/i.test(String(s).trim());
/** The number each invoice is known by, keyed by id. An invoice saved without one gets the
 *  number Business Operations shows for it: INV-<its place among that day's unnumbered invoices><ddmmyy>. */
export function invoiceNumbers(invoices) {
  const sorted = [...(invoices || [])].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  const perDay = {};
  const map = new Map();
  sorted.forEach((r) => {
    const stored = r.invoice_number || r.reference;
    if (stored && !looksLikeId(stored)) { map.set(r.id, stored); return; }
    if (r.number_auto || !r.created_at) return;
    const d = new Date(r.created_at);
    const day = `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getFullYear()).slice(-2)}`;
    perDay[day] = (perDay[day] || 0) + 1;
    map.set(r.id, `INV-${perDay[day]}${day}`);
  });
  return map;
}
