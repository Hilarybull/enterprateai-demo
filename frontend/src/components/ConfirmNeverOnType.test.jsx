// QA, 17 Oct: typing in a form never presses a spending button. Focus starts on "Not now"; a space never spends.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PremiumConfirm, PriceConfirm } from "./FirstValueCard";

afterEach(cleanup);

describe("a spending confirm", () => {
  it("opens with focus on Not now, and a space does not spend", () => {
    const onStart = vi.fn();
    render(<PremiumConfirm result={{}} confirm={{ action: "Find evidence", max: 60, balance: 521 }} working={false} onStart={onStart} onClose={() => {}} />);
    expect(document.activeElement?.textContent).toBe("Not now");
    const start = document.querySelector("[data-fv-start]");
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(start, { key: " " });
    fireEvent.keyUp(start, { key: " " });
    fireEvent.click(start, { detail: 0 });
    expect(onStart).not.toHaveBeenCalled();
  });

  it("a deliberate click spends", () => {
    const onStart = vi.fn();
    render(<PriceConfirm asking={{ title: "Write a plan", credits: 40, balance: 90 }} onStart={onStart} onClose={() => {}} />);
    expect(document.activeElement?.textContent).toBe("Not now");
    fireEvent.click(screen.getByRole("button", { name: "Start" }), { detail: 1 });
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
