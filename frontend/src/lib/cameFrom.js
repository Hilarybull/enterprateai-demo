// Where a chat link was pressed from, so the page it opens offers the way back (the owner, 29 Oct: results opened from the
// Agent Centre had only "Back to Validation"). Kept for this tab only, and only for an hour.
const KEY = "ea_came_from";
const NAMES = [[/^\/agent\b/, "Agent Centre"], [/^\/dashboard\b/, "Dashboard"], [/^\/check\/idea\b/, "Idea Validation Assistant"],
  [/^\/funding\b/, "your funding case"], [/^\/launch\b/, "Launch Readiness"]];

export function noteCameFrom(chat = null, opens = "") {
  try {
    const { pathname, search } = window.location;
    const name = (NAMES.find(([re]) => re.test(pathname)) || [])[1];
    if (name) sessionStorage.setItem(KEY, JSON.stringify({ to: pathname + search, name, at: Date.now(), ...(typeof chat === "string" ? { chat } : {}), opens: String(opens || "").split("?")[0] }));
  } catch { /* the page's own back link stays */ }
}

export function cameFrom() {
  try {
    const got = JSON.parse(sessionStorage.getItem(KEY) || "null");
    return got && got.to && Date.now() - got.at < 3600000 ? got : null;
  } catch { return null; }
}

/** Only on the page the link opened (the Validation link lands on its results): any other page forgets it (the owner, 29 Oct:
 *  the way back showed on a launch plan opened later) */
export function opensHere(got, pathname) {
  if (!got?.opens) return false;
  return pathname === got.opens || (got.opens === "/validation" && pathname === "/results");
}

export function forgetCameFrom() {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing kept */ }
}
