// Where a funding or launch result lives: its own case page, opened there and never copied into a card (the owner's QA,
// 21 to 22 Oct: "just open the result in the full page", "it should open as usual"). null for any other result.
export function resultHome(result) {
  const a = result?.assessment || {};
  if (a.kind === "funding" && a.case_id) return `/funding/${a.case_id}?tab=overview`;
  if (a.kind === "launch" && a.initiative_id) return `/launch/${a.initiative_id}?tab=overview`;
  return null;
}
