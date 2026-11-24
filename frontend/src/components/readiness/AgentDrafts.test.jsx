import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Field } from "./Fields";

afterEach(cleanup);

describe("an AI draft beside its field (the owner's brief, 25 Oct; F-10)", () => {
  const field = { key: "market.differentiation", label: "What sets you apart", type: "text" };
  const data = { market: {}, agent_drafts: { "market.differentiation": { value: "Same-day service", source: "from your records and research" } } };
  it("Accept puts it in the field and removes the draft", () => {
    const onChange = vi.fn();
    render(<Field field={field} data={data} onChange={onChange} />);
    expect(screen.getByText("AI draft")).toBeTruthy();
    fireEvent.click(screen.getByText("Accept"));
    expect(onChange).toHaveBeenCalledWith("market.differentiation", "Same-day service");
    expect(onChange).toHaveBeenCalledWith("agent_drafts", {});
  });
  it("Reject removes it for good, and the field stays as it was", () => {
    const onChange = vi.fn();
    render(<Field field={field} data={data} onChange={onChange} />);
    fireEvent.click(screen.getByText("Reject"));
    expect(onChange).not.toHaveBeenCalledWith("market.differentiation", expect.anything());
    expect(onChange).toHaveBeenCalledWith("rejected_drafts", ["market.differentiation"]);
  });
  it("a filled field shows the draft as a suggestion and keeps its value until Accept", () => {
    render(<Field field={field} data={{ market: { differentiation: "Cheap" }, agent_drafts: { "market.differentiation": { value: "Same-day service", replaces: "Cheap" } } }} onChange={() => {}} />);
    expect(screen.getByText("AI suggestion")).toBeTruthy();
    expect(screen.getByText(/Your current answer stays until you accept/)).toBeTruthy();
  });
  it("a draft that says what the field already says is never shown", () => {
    render(<Field field={field} data={{ market: { differentiation: "Same-day service" }, agent_drafts: { "market.differentiation": { value: "Same-day service", replaces: "Same-day service" } } }} onChange={() => {}} />);
    expect(screen.queryByText("AI suggestion")).toBeNull();
    expect(screen.queryByText("AI draft")).toBeNull();
  });
});
