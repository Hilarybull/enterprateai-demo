// The "Watch it work" demo on the homepage: what each scene shows and for how long.
// The same three titles head the steps in the "How it works" section, so the demo and the page agree.

/** Set to a video address (an .mp4, or an embeddable player link) to open the product video in a lightbox instead of the scripted demo. */
export const DEMO_VIDEO_URL = "";

/** What "Try it yourself" puts in the Agent's field. */
export const DEMO_REQUEST = "Invoice for Mark, $300";

export const DEMO_SCENES = [
  { key: "tell", kind: "type", title: "Tell it the job", ms: 8000, text: DEMO_REQUEST,
    caption: "You say what you need, in your own words." },
  { key: "work", kind: "steps", title: "It does the work", ms: 11000,
    steps: ["Reading your request", "Found Mark in your customers", "Drafting invoice INV-1001"],
    caption: "The Agent reads your records and prepares the document." },
  { key: "approve", kind: "approve", title: "You approve", ms: 11000,
    card: { reference: "INV-1001", customer: "Mark", amount: "$300.00", due: "Due in 14 days" },
    caption: "Nothing is sent until you approve it." },
];

export const DEMO_SECONDS = Math.round(DEMO_SCENES.reduce((sum, s) => sum + s.ms, 0) / 1000);
