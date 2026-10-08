// One greeting for every place the Agent speaks: the homepage preview, the dashboard's Agent card
// and the Agent's first message. They always agree because they all call this.

/** The hour (0 to 23) in a timezone, or on this device's clock when none is given or it isn't known. */
export function hourIn(tz, now = new Date()) {
  if (tz) {
    try {
      const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(now));
      if (Number.isFinite(h)) return h % 24;
    } catch { /* an unknown zone: the device's clock */ }
  }
  return now.getHours();
}

/** "Good morning" from 05:00, "Good afternoon" from 12:00, "Good evening" from 17:00 until 04:59. */
export function greetingAt(hour) {
  return hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 17 ? "Good afternoon" : "Good evening";
}

/** The first name out of whatever is on record ("Munah Okoro" gives "Munah"). Never a placeholder: nothing, when nothing is known. */
export function firstNameOf(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'-]*$/.test(first) ? first : "";
}

/** A workspace name that is a real one: not empty, and not what a workspace is called before anyone names the business. */
export function workspaceNameOf(name) {
  const said = String(name || "").trim();
  return /^(my workspace|workspace|my business|business|untitled|untitled business|new business|my company|company)?$/i.test(said) ? "" : said;
}

/**
 * "Good afternoon, {subject}", or "Good afternoon" (no comma) with no subject. The subject is
 * whoever is being addressed, exactly as given: a person's first name (the homepage preview, the
 * Agent's messages, emails) or the active workspace's name (the dashboard's Agent card).
 */
export function getGreeting({ subject = "", tz, now = new Date() } = {}) {
  const who = String(subject || "").trim();
  return `${greetingAt(hourIn(tz, now))}${who ? `, ${who}` : ""}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// What the Agent did, by kind of task.
const DID = {
  new_invoice: (n) => `drafted ${plural(n, "invoice")}`,
  quote_to_cash: (n) => `drafted ${plural(n, "invoice")}`,
  enquiry_to_quote: (n) => `drafted ${plural(n, "quotation")}`,
  new_proposal: (n) => `drafted ${plural(n, "proposal")}`,
  new_contract: (n) => `drafted ${plural(n, "contract")}`,
  receipt_send: (n) => `prepared ${plural(n, "receipt")}`,
  payment_followup: (n) => `prepared ${plural(n, "payment reminder")}`,
  risk_concentration: () => "checked your risks",
  scenario_help: (n) => `ran ${plural(n, "scenario")}`,
};
const list = (parts) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/**
 * The one line under the dashboard greeting: only what the Agent did or is doing. (What is waiting
 * for the owner is on the tiles and in Needs Approval, so it is not repeated here.)
 *   working:   a task is in progress
 *   done:      work finished since the last visit
 *   first:     their first visit
 *   next:      nothing done since the last visit
 */
export function briefingOf(b) {
  if (!b) return { kind: "none", text: "" };
  if (b.working_on) return { kind: "working", text: `I'm working on ${String(b.working_on.title || "your task").replace(/^./, (c) => c.toLowerCase())}. I'll let you know when it's ready.` };
  const done = Object.entries(b.done_since_last_visit || {}).filter(([, n]) => n > 0);
  if (done.length) {
    const known = done.filter(([k]) => DID[k]).map(([k, n]) => DID[k](n));
    const others = done.filter(([k]) => !DID[k]).reduce((sum, [, n]) => sum + n, 0);
    if (others) known.push(`finished ${plural(others, known.length ? "other task" : "task")}`);
    return { kind: "done", text: `While you were away I ${list(known)}.` };
  }
  if (b.first_visit) return { kind: "first", text: "Tell me the first job and I'll get on it." };
  return { kind: "next", text: "What should I work on next?" };
}
