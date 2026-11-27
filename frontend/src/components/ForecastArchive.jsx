import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { formatCurrency } from "../lib/format";

export default function ForecastArchive({ businessId, tenantId, state, months = 6 }) {
  const [items,setItems]=useState([]), [selected,setSelected]=useState(""), [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false), [error,setError]=useState("");
  useEffect(()=>{setItems([]);setSelected("");setOpen(false);setError("");},[businessId]);
  async function load(){
    setBusy(true);setError("");
    try {const result=await apiRequest(`/v1/scenario-intelligence/forecast-snapshots?business_id=${encodeURIComponent(businessId)}`,"GET");setItems(result.items || []);}
    catch(e){setError(e.message || "Saved forecasts could not load. Try again.");}finally{setBusy(false);}
  }
  async function save(){
    setBusy(true);setError("");
    try {const result=await apiRequest('/v1/scenario-intelligence/forecast-snapshots','POST',{business_id:businessId,tenant_id:tenantId,state_version:'archive-1',state,timeline_months:months});setItems(old=>[result,...old]);setSelected(result.id);setOpen(true);}
    catch(e){setError(e.message || "Forecast was not saved. Try again.");}finally{setBusy(false);}
  }
  const snapshot=items.find(item=>item.id===selected)||items[0];
  return <section className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Saved forecasts and actuals">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Saved forecasts & actuals</h3><p className="text-sm text-slate-500">Keep a forecast unchanged, then compare it with Operations as each month arrives.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-lg border border-brand-300 px-3 py-2 font-semibold text-brand-700 disabled:opacity-50" disabled={busy||!state} onClick={save}>Save this baseline forecast</button><button type="button" className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-slate-700 disabled:opacity-50" disabled={busy} aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)void load();}}>{open?'Hide saved forecasts':'View saved forecasts'}</button></div></div>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    {busy&&<p role="status" className="text-sm text-slate-500">Loading…</p>}
    {open&&!busy&&(!snapshot?<p className="text-sm text-slate-500">No saved forecasts yet. Save one to start comparing future months.</p>:<>
      <label className="block text-sm">Forecast<select className="ea-input mt-1" value={snapshot.id} onChange={e=>setSelected(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.label} · {item.created_at ? new Date(item.created_at).toLocaleString('en-GB') : 'Just saved'}</option>)}</select></label>
      <p className="text-xs text-slate-500">Actuals through {snapshot.actuals_as_of}. Difference = actual minus forecast. The current month is incomplete; upcoming months have no actuals yet.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Month','Status','Forecast revenue','Actual revenue','Difference','Forecast costs','Actual costs','Difference'].map((label,i)=><th key={i} className="whitespace-nowrap px-3 py-2 text-left font-medium">{label}</th>)}</tr></thead><tbody>{(snapshot.comparison||[]).map(row=><tr key={row.month} className="border-t border-slate-100"><td className="whitespace-nowrap px-3 py-2">{row.month}</td><td className="whitespace-nowrap px-3 py-2">{row.status==='in_progress'?'Actual to date':row.status==='complete'?'Complete':'Upcoming'}</td>{[row.forecast.revenue,row.actual?.revenue,row.variance?.revenue,row.forecast.costs,row.actual?.costs,row.variance?.costs].map((value,i)=><td key={i} className="whitespace-nowrap px-3 py-2 text-right">{value==null?'—':formatCurrency(value,snapshot.currency)}</td>)}</tr>)}</tbody></table></div>
    </>)}
  </section>;
}
