// QA, 17 Oct: a figure edited in the funding review goes on the case when saved (Save or Enter), before adopting; the
// setup form reloads. Opening Edit is not a decision; Save fades to Saved, and wakes again when the figure changes.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = [];
vi.mock("../api/client", () => ({ apiRequest: vi.fn(async (path, method, body) => { calls.push({ path, body }); return path.endsWith("/preview") ? { calculated: [] } : { assessment: {} }; }) }));
const { default: ResearchReview } = await import("./ResearchReview");

afterEach(() => { cleanup(); calls.length = 0; sessionStorage.clear(); });
const runOf = (id) => ({ id, goal: "need_funding", status: "review", counts: { researched: 0, estimated: 0, reused: 1, calculated: 0, asked: 0, sources: 0 },
  items: [{ id: "u1", kind: "reused", field: "cost", label: "Cost per sale", value: "400", used_for: "Break-even" }] });
const box = () => screen.getByLabelText("Your version: Cost per sale");
const saveButton = () => document.querySelector("[data-update-now]");

describe("editing a figure in the funding review", () => {
  it("Enter saves it onto the case before adopting, and the setup form is told to reload", async () => {
    const heard = vi.fn();
    window.addEventListener("ea:case:updated", heard);
    render(<ResearchReview businessId="ws1" run={runOf("rr_1")} onAdopted={() => {}} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Your decision: Cost per sale" })).getByRole("button", { name: "Edit" }));
    expect(document.querySelector("[data-undecided]")).not.toBeNull();      // opening Edit is not a decision
    fireEvent.change(box(), { target: { value: "300" } });
    await act(async () => { fireEvent.keyDown(box(), { key: "Enter" }); });
    expect(calls.find((c) => c.path === "/businesses/ws1/assessment/funding/use-figures")?.body).toEqual({ figures: { cost: 300 } });
    expect(heard).toHaveBeenCalled();
    expect(document.querySelector("[data-research-value]").textContent).toContain("Was");
    window.removeEventListener("ea:case:updated", heard);
  });

  it("Save closes the box and shows the new figure; Edit opens it again, and Cancel puts back what was there", async () => {
    render(<ResearchReview businessId="ws1" run={runOf("rr_2")} onAdopted={() => {}} />);
    const group = () => screen.getByRole("group", { name: "Your decision: Cost per sale" });
    fireEvent.click(within(group()).getByRole("button", { name: "Edit" }));
    fireEvent.change(box(), { target: { value: "300" } });
    await act(async () => { fireEvent.click(saveButton()); });
    expect(screen.queryByLabelText("Your version: Cost per sale")).toBeNull();      // closed once saved
    expect(document.querySelector("[data-research-value]").textContent).toContain("300");
    fireEvent.click(within(group()).getByRole("button", { name: "Edit" }));
    expect(box().value).toBe("300");
    fireEvent.change(box(), { target: { value: "999" } });
    fireEvent.click(document.querySelector("[data-edit-cancel]"));
    expect(screen.queryByLabelText("Your version: Cost per sale")).toBeNull();
    expect(document.querySelector("[data-research-value]").textContent).toContain("300");      // the saved figure, not 999 or the old one
  });
});

describe("Accept after an edit (the owner's QA, 20 Oct)", () => {
  it("keeps the edited figure, never the old one", async () => {
    render(<ResearchReview businessId="ws1" run={runOf("rr_3")} onAdopted={() => {}} />);
    const group = () => screen.getByRole("group", { name: "Your decision: Cost per sale" });
    fireEvent.click(within(group()).getByRole("button", { name: "Edit" }));
    fireEvent.change(box(), { target: { value: "300" } });
    await act(async () => { fireEvent.click(saveButton()); });
    await act(async () => { fireEvent.click(within(group()).getByRole("button", { name: "Accept" })); });
    expect(document.querySelector("[data-research-value]").textContent).toContain("300");
    expect(within(group()).getByRole("button", { name: "Accept" }).getAttribute("aria-pressed")).toBe("true");
    // Something is said on the press, and only Accept looks pressed (the owner, 26 Oct: "clicked on accept and nothing happened")
    expect(within(group()).getByRole("button", { name: "Edit" }).getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("[data-accepted-note]").textContent).toBe("Accepted, with your edit. Press Use what I accepted to keep it.");
  });

  it("an unsaved edit is saved by Accept", async () => {
    render(<ResearchReview businessId="ws1" run={runOf("rr_4")} onAdopted={() => {}} />);
    const group = () => screen.getByRole("group", { name: "Your decision: Cost per sale" });
    fireEvent.click(within(group()).getByRole("button", { name: "Edit" }));
    fireEvent.change(box(), { target: { value: "350" } });
    await act(async () => { fireEvent.click(within(group()).getByRole("button", { name: "Accept" })); });
    expect(document.querySelector("[data-research-value]").textContent).toContain("350");
  });
});
