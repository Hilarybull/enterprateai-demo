// What to do next once a case is ready (F-8, 22 Oct): related EnterprateAI services, by journey. Shown only when the
// check's own classification is "ready" (the checklist's one threshold, 75), the result is current and nothing blocks it.
// Each opens its tool with this business and case already loaded; something done shows as "Done · View"; a premium
// service the plan doesn't include shows an upgrade instead of a broken link.

export function relatedReady(summary, readyAt = 75, shownScore = null) {
  // The score on screen at the ready threshold (75) or above: always (the owner's QA, 22 Oct: "my score is 93!!!"). A step
  // still open is listed above it; the recommendations never wait on it.
  if (summary?.classification === "ready") return true;
  // The summary's score only (G5, 23 Oct): never the points known so far while the full score waits
  const shown = [summary?.score ?? shownScore].filter((n) => n !== null && n !== undefined).map(Number).find((n) => Number.isFinite(n) && n > 0);
  return shown !== undefined && shown >= readyAt;
}

export function relatedServices({ feature, subject, packLocked = false }) {
  // Nothing already done (the owner's QA, 22 Oct): the business's own record says what is
  const done = subject?.related_done || {};
  return relatedAll({ feature, subject, packLocked }).filter((r) => !done[r.key] && !(r.key === "funding" && done.fundingCase));
}

function relatedAll({ feature, subject, packLocked = false }) {
  const id = subject?.id;
  const summary = subject?.summary || {};
  const pack = summary.pack || {};
  if (feature === "funding") {
    // Each opens a real page, on the right tab (the owner, 22 Oct: business plan, launch readiness, invoice, catalogue)
    const packDone = pack.total && pack.ready >= pack.total;
    const pct = pack.total ? Math.round((100 * (pack.ready || 0)) / pack.total) : 0;
    return [
      // Ready only when every part is there for this check; else how far along it is (the owner, 22 Oct)
      { key: "pack", title: packDone ? "Your funding pack is ready" : `Your funding pack is ${pct}% ready`,
        why: packDone ? "Everything a funder asks for, from this check." : `Still to do: ${(pack.items || []).filter((i) => !i.ready).map((i) => i.label).join(", ") || "the remaining parts"}.`,
        cta: packDone ? "View funding pack" : "Finish the pack", to: `/funding/${id}?tab=documents`, locked: packLocked },
      { cost: "Credits apply", key: "plan", title: "Write your business plan", why: "Funders ask for one beside the pack.", cta: "Start a business plan", to: "/blueprint?tab=business-plans" },
      { key: "launch", title: "Check you're ready to launch", why: "The same checks for putting the money to work.", cta: "Open Launch Readiness", to: "/launch" },
      { key: "invoice", title: "Send your next invoice", why: "Every paid invoice is more evidence of demand for your case.", cta: "Create an invoice", to: "/operations?tab=Sales&new=invoice" },
      { key: "catalogue", title: "Keep your prices up to date", why: "Your case reads its price and cost per sale from your Catalogue.", cta: "Open Catalogue", to: "/catalogue?tab=products" },
      { key: "scenario", title: "Test your funding timing", why: "See what a later or smaller amount does to your cash.", cta: "Run a timing scenario", to: `/funding/${id}?tab=scenarios` },
    ];
  }
  if (feature === "launch") {
    return [
      { key: "pricing", title: "Check your price", why: "A launch sells at the price you set: check it covers your costs.", cta: "Open Pricing", to: "/catalogue" },
      { cost: "Credits apply", key: "plan", title: "Write your business plan", why: "The plan behind the launch, in one document.", cta: "Start a business plan", to: "/blueprint?tab=business-plans" },
      { key: "marketplace", title: "List your business on the Marketplace", why: "So your first customers can find you.", cta: "Open the Marketplace", to: "/marketplace" },
      { key: "invoice", title: "Set up your first quotation and invoice", why: "Ready for the first order.", cta: "Open Business Operations", to: "/operations?tab=Sales" },
      { key: "funding", title: "Check your funding readiness", why: "If the launch needs money, see how prepared you are.", cta: "Open Funding Readiness", to: "/funding" },
    ];
  }
  return [];
}
