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

/** The greetings, in the person's own timezone: morning 05:00 to 11:59, afternoon 12:00 to 16:59, evening 17:00 to 23:59,
 * and "Hi" from midnight to 04:59 (the owner, 28 Oct: not "Good evening" at midnight; never "Good night", a goodbye). */
export const GREETING_BANDS = [[5, "Good morning"], [12, "Good afternoon"], [17, "Good evening"]];
export function greetingAt(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  if (h < 5) return "Hi";
  return [...GREETING_BANDS].reverse().find(([from]) => h >= from)[1];
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
  // F4: the task's own words from the server ("I'm updating your catalogue item"), never its title bent into a sentence.
  if (b.working_on) return { kind: "working", runId: b.working_on.run_id, text: `I'm ${b.working_on.doing || "working on your task"}. I'll let you know when it's ready.` };
  const done = Object.entries(b.done_since_last_visit || {}).filter(([, n]) => n > 0);
  if (done.length) {
    const known = done.filter(([k]) => DID[k]).map(([k, n]) => DID[k](n));
    const others = done.filter(([k]) => !DID[k]).reduce((sum, [, n]) => sum + n, 0);
    if (others) known.push(`finished ${plural(others, known.length ? "other task" : "task")}`);
    const spent = Number(b.spent_while_away || 0);      // P2.18: background work that used credits is said, with its cost
    return { kind: "done", text: `While you were away I ${list(known)}${spent ? ` (${spent} credit${spent === 1 ? "" : "s"})` : ""}.` };
  }
  if (b.first_visit) return { kind: "first", text: "Tell me the first job and I'll get on it." };
  return { kind: "next", text: "What should I work on next?" };
}
