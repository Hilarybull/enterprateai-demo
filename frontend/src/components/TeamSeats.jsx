// Seats and team credits (the pricing PDF, 19 Oct 2026): Explorer and Starter are 1 user seat (the owner); Decision
// Engine includes 3, and the owner can buy more at £15 a month (each with 250 AI credits a month), give each member a
// monthly allowance from the team's pooled credits, and choose what each member can open.
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";

/** "2 of 3 seats in use" and the way to more: buy a seat on Decision Engine, or upgrade from a one-seat plan. */
export function SeatsStrip({ seats }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!seats) return null;
  const buy = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await apiRequest("/plans/addons/checkout", "POST", { addon_key: "addon_seat" });
      if (res?.checkout_url) window.location.href = res.checkout_url;
      else setError("Couldn't start checkout. Try again.");
    } catch (e) {
      const msg = String(e?.message || "").replace(/^HTTP \d+:\s*/, "");
      setError(/not yet available|503/.test(msg) ? "Extra seats can't be bought online just yet. Contact us and we'll add one." : msg || "Couldn't start checkout. Try again.");
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900" data-seats>
      <div>
        <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100" data-seats-used>{seats.used} of {seats.total} {seats.total === 1 ? "seat" : "seats"} in use</p>
        <p className="text-[12px] text-slate-500">
          {seats.can_buy
            ? `${seats.included} included on your plan${seats.extra ? `, plus ${seats.extra} extra` : ""}. Each extra seat is £${seats.seat_price}/mo and adds ${seats.seat_credits} AI credits a month to the team's pool.`
            : "Your plan includes 1 user seat. Decision Engine includes 3, and you can add more."}
        </p>
        {error && <p role="alert" className="mt-1 text-[12px] text-rose-700">{error}</p>}
      </div>
      {seats.can_buy ? (
        <button type="button" onClick={buy} disabled={busy} data-buy-seat
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:border-brand-300 disabled:opacity-60 max-sm:w-full">
          {busy ? "Opening checkout…" : `Add a seat · £${seats.seat_price}/mo`}
        </button>
      ) : (
        <Link to="/pricing" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:border-brand-300 max-sm:w-full max-sm:text-center" data-upgrade-seats>
          See Decision Engine
        </Link>
      )}
    </div>
  );
}

/** A member's monthly allowance from the team's pooled credits: what this month has used, and the owner's limit. */
export function MemberCredits({ member, enabled, onSaved }) {
  const c = member?.credits || { monthly: null, used: 0 };
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(c.monthly == null ? "" : String(c.monthly));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!enabled) return <span className="text-[12px] text-slate-400">Own credits</span>;
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const raw = value.trim();
      const out = await apiRequest(`/workspace/members/${member.id}/credits`, "PATCH", { monthly: raw === "" ? null : Number(raw.replace(/[^0-9]/g, "")) });
      onSaved?.(out);
      setEditing(false);
    } catch (e) { setError(String(e?.message || "").replace(/^HTTP \d+:\s*/, "") || "That didn't save. Try again."); }
    finally { setBusy(false); }
  };
  if (editing) {
    return (
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(); }} data-member-credits-form>
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" placeholder="No limit" aria-label={`Monthly AI credits for ${member.email}`}
          className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-[13px] outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950" />
        <span className="text-[12px] text-slate-500">a month</span>
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => setEditing(false)} className="text-[12px] font-semibold text-slate-500">Cancel</button>
        {error && <span role="alert" className="w-full text-[11.5px] text-rose-700">{error}</span>}
      </form>
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} className="text-left text-[12.5px] text-slate-700 hover:text-brand-700 dark:text-slate-200" data-member-credits>
      {c.monthly == null ? `${c.used} used · no limit` : `${c.used} of ${c.monthly} used`}
      <span className="ml-1.5 font-semibold text-brand-700">Change</span>
    </button>
  );
}
