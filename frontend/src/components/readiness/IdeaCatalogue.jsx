// The idea's Catalogue tab (the owner's QA, 27 Oct: "show whether this service is in the catalogue, with Add to catalogue if
// it isn't, instead of just a button to leave"). Adding it is one item, saved by its name: never a duplicate.
import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";
import { toast } from "../../lib/toast";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";

export default function IdeaCatalogue({ businessId, onOpenCatalogue }) {
  const [idea, setIdea] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const load = () => apiRequest(`/businesses/${businessId}/agent/assistant-context?kind=idea&case_id=idea`, "GET").then((c) => setIdea(c?.idea || null), () => setIdea(null));
  useEffect(() => { load(); }, [businessId]);      // eslint-disable-line react-hooks/exhaustive-deps
  if (idea === undefined) return <div className={`${CARD} h-32 animate-pulse`} aria-busy="true" />;
  const a = idea?.answers || {};
  const name = String(a.description || "").trim();
  const listed = idea?.catalogue?.listed;
  const add = async () => {
    setBusy(true);
    try {
      const out = await apiRequest(`/businesses/${businessId}/catalogue/from-check`, "POST", { name: name.slice(0, 120),
        ...(Number(a.price) > 0 ? { base_price: Number(a.price) } : {}), ...(Number(a.cost) > 0 ? { cost_of_sales: Number(a.cost) } : {}) });
      toast({ kind: "success", title: out?.message || `Added to your catalogue: ${name}` });
      await load();
    } catch { toast({ kind: "error", title: "That couldn't be added just now.", detail: "Nothing was changed." }); }
    finally { setBusy(false); }
  };
  return (
    <div className={CARD} data-idea-catalogue>
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Product &amp; Service Catalogue</p>
      {!name ? (
        <p className="mt-1 text-[13.5px] text-slate-600 dark:text-slate-300">Describe the service on the Assessment tab first. Once it is known, it can go in your catalogue with its price.</p>
      ) : listed ? (
        <>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-slate-800 dark:text-slate-100" data-catalogue-listed><span className="whitespace-nowrap rounded-md bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-700">In your catalogue</span>{idea.catalogue.name}</p>
          <p className="mt-1 text-[13px] text-slate-500">Quotations and Marketplace listings use it with its price.</p>
          <button type="button" onClick={onOpenCatalogue} className="mt-3 text-[13.5px] font-medium text-blue-600 hover:underline">Open your catalogue →</button>
        </>
      ) : (
        <>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-slate-800 dark:text-slate-100" data-catalogue-missing><span className="whitespace-nowrap rounded-md bg-amber-50 px-2 py-0.5 text-[12px] font-semibold text-amber-800">Not in your catalogue yet</span>{name}</p>
          <p className="mt-1 text-[13px] text-slate-500">Add it so quotations and Marketplace listings can use it{Number(a.price) > 0 ? ", with the price from your idea" : ""}.</p>
          <button type="button" disabled={busy} onClick={add} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? "Adding…" : "Add to catalogue"}</button>
        </>
      )}
    </div>
  );
}
