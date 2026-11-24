// Customer testimonials: the only place they live. Shown only with consent recorded, and only while active.
//
// To withdraw one (consent withdrawn, or the customer asks), set active: false. It disappears everywhere at once.
// Add only what the customer approved: no street addresses, photos, star ratings or logos unless they were
// supplied with consent (add a field for them here first, with that consent noted).
//
// TO COMPLETE: consent_date for both entries, and Gilbert C.'s location. They were not supplied, so they are
// left empty rather than guessed; a card shows a location only when there is one.

export const TESTIMONIALS = [
  {
    id: "sombeauty-irene",
    quote: "Running a beauty business, I never had time for paperwork. EnterprateAI lets me put together quotes and invoices in one place, and I can finally see which clients still owe me. It feels like having a business assistant in my pocket.",
    name: "Irene A.",
    company: "SOMBEAUTY LONDON LTD",
    location: "London",
    consent_recorded: true,
    consent_date: null,      // TO COMPLETE
    active: true,
  },
  {
    id: "oic3-gilbert",
    quote: "In the garage, every minute counts. With EnterprateAI I can turn a customer enquiry into a professional quote quickly, and nothing goes out until I've approved it. It's made the business side much easier to keep on top of.",
    name: "Gilbert C.",
    company: "OIC3 AUTO SERVICES LTD",
    location: null,          // TO COMPLETE
    consent_recorded: true,
    consent_date: null,      // TO COMPLETE
    active: true,
  },
];

/** The testimonials that may be shown: consent recorded, still active, and with a quote and a name. */
export function shownTestimonials(list = TESTIMONIALS) {
  return list.filter((t) => t && t.consent_recorded === true && t.active !== false && String(t.quote || "").trim() && String(t.name || "").trim());
}
