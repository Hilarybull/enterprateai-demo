// What this browser keeps for whoever is using it. One person's business data and chats never stay for the next: everything
// is removed on sign-out and when another account signs in, except the short list below, which belongs to the browser.
const OWNER = "ea_browser_owner";      // whose data this browser holds now
const SWEPT = "ea_browser_swept_v1";      // what earlier versions left behind has been removed
const CARD = "ea_card_sign_in";      // this tab's visitor went to sign in from the card holding their own answers
const STAYS = new Set(["ea_cookie_consent", "ea_theme", "ea_referral", "ea_post_auth_next", "ea_pending_join", SWEPT]);
// Signing in also keeps the session itself and a task started on the homepage: it is only attached after a code or a yes.
const STAYS_SIGNING_IN = new Set([...STAYS, OWNER, "ea_token", "ea_email", "ea_task_session", "ea_task_session:anon", "enterprate_visitor_name",
  "ea_signup_name", "ea_goal_viewed", CARD, "ea_tour_active", "ea_tour_step", "ea_tour_done"]);

/** Signing in from the card with the answers on it: they're this person's, already confirmed there, and never asked about again.
 *  Kept for this tab only, so answers left on a shared browser still get the question from whoever signs in later. */
export function markCardSignIn(sessionId) {
  try { sessionStorage.setItem(CARD, String(sessionId)); } catch { /* asked instead */ }
}
export function cameFromCard(sessionId) {
  try { return Boolean(sessionId) && sessionStorage.getItem(CARD) === String(sessionId); } catch { return false; }
}

const cleared = new Set();
/** Data held in memory goes at the same moment (a chat, the last dashboard). */
export function onBrowserCleared(fn) { cleared.add(fn); }

function removeAll(keep) {
  for (const store of [localStorage, sessionStorage]) {
    try {
      for (const key of Object.keys(store)) { if (!keep.has(key)) store.removeItem(key); }
    } catch { /* storage unavailable: nothing was kept in it */ }
  }
  cleared.forEach((fn) => { try { fn(); } catch { /* the rest still goes */ } });
}

/** Signed out, or the server ended the session. */
export function clearOnSignOut() { removeAll(STAYS); }

/** This account is signing in. True when the browser held another account's data, which has just been removed. */
export function claimBrowser(email) {
  const who = String(email || "").trim().toLowerCase();
  if (!who) return false;
  let before = null;
  try { before = localStorage.getItem(OWNER); } catch { return false; }
  const switched = Boolean(before) && before !== who;
  if (switched) removeAll(STAYS_SIGNING_IN);
  try { localStorage.setItem(OWNER, who); } catch { /* removed above regardless */ }
  return switched;
}

/** Once per browser: what earlier versions kept (chats, dashboards, other people's drafts). */
export function sweepOldData() {
  try {
    if (localStorage.getItem(SWEPT)) return;
    removeAll(STAYS_SIGNING_IN);
    localStorage.setItem(SWEPT, "1");
  } catch { /* storage unavailable: nothing was kept in it */ }
}
