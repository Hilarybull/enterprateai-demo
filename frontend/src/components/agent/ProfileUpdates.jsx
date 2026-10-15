import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../api/client";

// P0.3 and P0.4: what the Agent added to the business profile ("I added your country, city and target customer to your
// business profile. [Review]") and each conflict, asked once ("Your business profile says England, but you mentioned
// Abuja. Update your profile?"). Shown in the Agent card, above the input.
export default function ProfileUpdates({ businessId }) {
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const load = useCallback(() => {
    if (!businessId) return;
    apiRequest(`/businesses/${businessId}/profile/updates`, "GET").then(setState).catch(() => setState(null));
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  // Told once (the owner's QA, 15 Oct): marked seen as soon as it is shown, so the same note never comes back on the next
  // visit. It stays on screen until they leave the page.
  useEffect(() => {
    if (state?.message && businessId) apiRequest(`/businesses/${businessId}/profile/updates/seen`, "POST", {}).catch(() => {});
  }, [state?.message, businessId]);
  if (!state || (!state.message && !state.conflicts?.length)) return null;
  const conflict = state.conflicts?.[0];
  const answer = async (field, choice) => {
    try { await apiRequest(`/businesses/${businessId}/profile/conflicts/${field}`, "POST", { choice }); } finally { load(); }
    if (choice === "other") navigate("/account?tab=workspace&highlight=country");      // typed on the profile itself
  };
  const review = async () => {
    const fields = (state.filled || []).join(",");
    try { await apiRequest(`/businesses/${businessId}/profile/updates/seen`, "POST", {}); } catch { /* shown again next time */ }
    navigate(`/account?tab=workspace&highlight=${encodeURIComponent(fields)}`);
  };
  const seen = () => setState((s) => (s ? { ...s, message: "" } : s));
  return (
    <div className="mt-3 space-y-2" data-profile-updates>
      {state.message && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-[13px] text-white">
          <span>{state.message}</span>
          <span className="flex gap-2">
            <button type="button" onClick={review} className="rounded-lg bg-white px-3 py-1 text-[12.5px] font-semibold text-brand-700 hover:bg-indigo-50">{state.currency_set ? "Change" : "Review"}</button>
            <button type="button" onClick={seen} className="rounded-lg px-2 py-1 text-[12.5px] text-white/80 hover:text-white">Dismiss</button>
          </span>
        </div>
      )}
      {conflict && (
        <div className="rounded-xl border border-amber-300/40 bg-amber-50/95 px-3 py-2 text-[13px] text-amber-950" data-profile-conflict={conflict.field}>
          <p>{conflict.question}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {conflict.options.map((o) => (
              <button key={o.choice} type="button" onClick={() => answer(conflict.field, o.choice)}
                className={o.choice === "update" ? "rounded-lg bg-brand-600 px-3 py-1 text-[12.5px] font-semibold text-white hover:bg-brand-700"
                  : "rounded-lg border border-amber-300 bg-white px-3 py-1 text-[12.5px] font-semibold text-amber-900 hover:bg-amber-100"}>{o.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
