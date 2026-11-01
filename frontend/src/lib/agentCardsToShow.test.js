// A form leaves the conversation once it's been dealt with (the owner, 1 Nov: "if they want to attend again they can request").
import { expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({ apiRequest: vi.fn(), apiRequestCached: vi.fn() }));
import { cardsToShow } from "./agent";

const form = { role: "assistant", content: "Here's what's left.", cards: [{ type: "pending" }, { type: "next" }] };
const you = { role: "user", content: "thanks" };

it("keeps a form while it is the newest thing in the chat", () => {
  expect(cardsToShow([form], 0).map((c) => c.type)).toEqual(["pending", "next"]);
});

it("drops it once the owner replies, or a newer form comes", () => {
  expect(cardsToShow([form, you], 0)).toEqual([]);
  expect(cardsToShow([form, { role: "assistant", content: "More", cards: [{ type: "choose" }] }], 0)).toEqual([]);
});

it("keeps results as the record, and a draft as one line to show again", () => {
  const list = [{ role: "assistant", content: "Done", cards: [{ type: "score_change" }, { type: "result" }, { type: "preview", item: { draft_id: "d1", open: true }, preview: { text: "long" } }] }, you];
  const kept = cardsToShow(list, 0);
  expect(kept.map((c) => c.type)).toEqual(["score_change", "result", "preview"]);
  expect(kept[2]).toEqual({ type: "preview", item: { draft_id: "d1", open: false } });
});

it("keeps the progress card only while the work is running", () => {
  const list = [{ role: "assistant", content: "Started", cards: [{ type: "progress" }] }, you];
  expect(cardsToShow(list, 0, true).map((c) => c.type)).toEqual(["progress"]);
  expect(cardsToShow(list, 0, false)).toEqual([]);
});
