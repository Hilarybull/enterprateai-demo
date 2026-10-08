import { Suspense, lazy, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DirectoryResults, FindToClaim } from "../components/marketplace/Directory";
import MarketplaceHeader from "../components/marketplace/MarketplaceHeader";
import { useDemoTour } from "../context/DemoTourContext";

// The Marketplace: one light page that owns the header, the search box and the tabs. The
// Business Directory opens first. Products & Services and Proposal Requests are a much larger
// module, loaded only when one of those tabs is opened.

const MarketplaceListings = lazy(() => import("./MarketplaceListings"));

const TABS = [
  { id: "businesses", label: "Business Directory", placeholder: "Search by name, service or location…" },
  { id: "products", label: "Products & Services", placeholder: "Search products or services…" },
  { id: "requests", label: "Proposal Requests", placeholder: "Search proposal requests…" },
];

function tabFrom(params) {
  const tab = params.get("tab");
  if (tab === "requests" || params.get("request")) return "requests";
  if (tab === "products" || tab === "profiles") return tab;
  if (params.get("business")) return "products";      // a link from a public profile to that business's listing
  return "businesses";
}

export default function MarketplacePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { triggerDemoGate } = useDemoTour() || {};
  const [query, setQuery] = useState("");
  const tab = tabFrom(params);
  const shown = TABS.find((t) => t.id === tab) || TABS[1];

  // The tab lives in the address, so a refresh or a shared link opens the same one.
  const setTab = (id) => { setQuery(""); setParams({ tab: id }, { replace: true }); };
  const list = () => { if (triggerDemoGate?.("marketplace")) return; navigate("/marketplace/profile"); };

  return (
    <div className="ea-scroll flex h-screen flex-col overflow-y-auto overflow-x-hidden bg-slate-50 dark:bg-slate-950" data-tour="marketplace-section">
      <MarketplaceHeader onList={list} />

      <div className="bg-gradient-to-br from-brand-600 via-brand-700 to-accent-700 px-4 pb-0 pt-8 text-center sm:pt-12">
        <h1 className="text-2xl font-extrabold text-white sm:text-3xl xl:text-4xl">Discover Businesses. Promote Yours. Get Seen.</h1>
        <div className="mx-auto max-w-2xl">
          <p className="mt-3 text-sm text-white/70">A marketplace built to help businesses get discovered, manage automated RFQ workflows, and generate proposals in one click.</p>
          <div className="relative mt-6">
            <svg className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input type="search" aria-label="Search the Marketplace" placeholder={shown.placeholder} value={query} onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-2xl border-0 bg-white py-3.5 pl-11 pr-4 text-sm text-slate-800 shadow-xl outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-white/50 dark:bg-slate-900 dark:text-slate-100" />
          </div>
        </div>

        {/* Tour-only hidden tab anchors */}
        <button data-tour="marketplace-products-tab" className="hidden" aria-hidden="true" tabIndex={-1} />
        <button data-tour="marketplace-profiles-tab" className="hidden" aria-hidden="true" tabIndex={-1} />

        <div className="relative -mx-4 mt-6 sm:mx-0">
        <div role="tablist" aria-label="Marketplace sections" className="flex items-end gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:justify-center sm:px-0 [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={shown.id === t.id} onClick={() => setTab(t.id)}
              className={`shrink-0 whitespace-nowrap rounded-t-xl px-4 py-2.5 text-[13px] font-semibold transition sm:px-5 ${shown.id === t.id
                ? "bg-slate-50 text-brand-700 shadow dark:bg-slate-950 dark:text-brand-300"
                : "text-white/70 hover:bg-white/10 hover:text-white"}`}>
              {t.label}
            </button>
          ))}
          <span aria-hidden="true" className="w-6 shrink-0 sm:hidden" />
        </div>
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-accent-700 to-transparent sm:hidden" />
        </div>
      </div>

      {tab === "businesses" ? (
        <div className="mx-auto w-full max-w-7xl flex-1 px-4 pb-8 sm:px-6">
          {/* "Already listed? Claim your business" from the homepage, pricing and sign-up lands here with the finder open. */}
          {params.get("find") && <div className="pt-5"><FindToClaim defaultOpen /></div>}
          <DirectoryResults query={query} stickyTop={56} />
          {!params.get("find") && <div className="mt-6"><FindToClaim /></div>}
        </div>
      ) : (
        <Suspense fallback={<div role="status" aria-label="Loading the Marketplace" className="mx-auto grid w-full max-w-7xl flex-1 content-start gap-4 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, n) => <div key={n} aria-hidden="true" className="ea-skeleton h-[220px] rounded-2xl" />)}</div>}>
          <MarketplaceListings tab={tab} query={query} onTab={setTab} onQuery={setQuery} />
        </Suspense>
      )}
    </div>
  );
}
