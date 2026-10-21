// One conversion service for every page (the owner's QA, 21 Oct: the dashboard converted £560 while Business Operations
// said "no rate yet"). Each rate is asked once per hour and kept here, so a page refreshing its records never drops a
// rate that is still on its way. One rule everywhere: the latest rate, said with its date; none yet, not converted.
import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";

const TTL = 60 * 60 * 1000;
const cache = new Map();      // "GBP>NGN" -> { at, promise, rate, date }

/** "NGN" from "NGN", "ngn" or "Nigerian Naira (NGN)"; "" when there is none. */
export function isoOf(c) {
  const t = String(c || "").trim();
  return ((t.match(/\(([A-Z]{3})\)\s*$/) || t.match(/^([A-Za-z]{3})$/)) || [])[1]?.toUpperCase() || "";
}

/** The rate from one currency to another, with the provider's date: { rate, date }, rate null when there is none. */
export function rateFor(from, to) {
  const key = `${from}>${to}`;
  const had = cache.get(key);
  if (had && (had.promise || Date.now() - had.at < TTL)) return had.promise || Promise.resolve({ rate: had.rate, date: had.date });
  const promise = apiRequest(`/integrations/currency-rate?from_currency=${from}&to_currency=${to}`, "GET")
    .then((d) => ({ rate: d?.rate ?? null, date: d?.date || null }))
    .catch(() => ({ rate: null, date: null }))
    .then((got) => {
      // A failed lookup is asked again on the next page view, never kept for the hour.
      if (got.rate == null) cache.delete(key);
      else cache.set(key, { at: Date.now(), rate: got.rate, date: got.date });
      return got;
    });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

/** The documents' other currencies besides the workspace's. */
export function foreignOf(records, ws) {
  return [...new Set((records || []).map((r) => isoOf(r?.currency || r?.source_currency)).filter((c) => c && c !== ws))].sort();
}

/** { rates: { GBP: 1775.2 }, dates: { GBP: "2026-10-21" } } for these currencies into the workspace's. */
export function useFxRates(codes, ws) {
  const key = `${ws}:${(codes || []).join(",")}`;
  const [state, setState] = useState({ rates: {}, dates: {} });
  useEffect(() => {
    if (!ws || !(codes || []).length) return undefined;
    let live = true;
    Promise.all(codes.map((from) => rateFor(from, ws).then((got) => ({ from, ...got })))).then((all) => {
      if (!live) return;
      const rates = {};
      const dates = {};
      all.forEach(({ from, rate, date }) => { if (rate != null) { rates[from] = rate; dates[from] = date; } });
      setState({ rates, dates });
    });
    return () => { live = false; };
  }, [key]);      // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function _resetFxCache() { cache.clear(); }

/** The rate pinned on a document when it was first converted ({ to, rate, date }): kept for ever, so every page converts
 *  it the same way, at the date it shows (the owner's QA, 21 Oct). null when it has none for this currency. */
export function pinnedRate(doc, ws) {
  const pin = doc && doc.fx;
  if (!pin || !pin.rate || isoOf(pin.to) !== isoOf(ws)) return null;
  const n = Number(pin.rate);
  return Number.isFinite(n) && n > 0 ? n : null;
}
