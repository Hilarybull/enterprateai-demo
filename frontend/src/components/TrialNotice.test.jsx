import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TrialNotice from "./TrialNotice";
beforeEach(()=>localStorage.clear());
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const props={accountKey:"ada@example.test",endsAt:"2026-11-30T00:00:00Z",onUpgrade:vi.fn()};
it("dismisses the notice and keeps it dismissed after returning to the page",()=>{
  const first=render(<TrialNotice {...props}/>);
  expect(screen.getByRole("status").textContent).toContain("Your 14 day trial includes all features and 200 AI credits.");
  fireEvent.click(screen.getByRole("button",{name:"Dismiss trial notice"}));
  expect(screen.queryByRole("status")).toBeNull();
  first.unmount();render(<TrialNotice {...props}/>);
  expect(screen.queryByRole("status")).toBeNull();
});
it("shows a new notice for another account, trial or exhausted credit balance",()=>{
  const view=render(<TrialNotice {...props}/>);
  fireEvent.click(screen.getByRole("button",{name:"Dismiss trial notice"}));
  view.rerender(<TrialNotice {...props} accountKey="another@example.test"/>);
  expect(screen.getByRole("status")).toBeTruthy();
  view.rerender(<TrialNotice {...props} exhausted/>);
  expect(screen.getByRole("status").textContent).toContain("credits are used up");
});
it("allows dismissal if browser storage is unavailable and keeps Upgrade working",()=>{
  vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("Unavailable");});
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("Unavailable");});
  const upgrade=vi.fn();render(<TrialNotice {...props} onUpgrade={upgrade}/>);
  fireEvent.click(screen.getByRole("button",{name:"Upgrade"}));expect(upgrade).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button",{name:"Dismiss trial notice"}));expect(screen.queryByRole("status")).toBeNull();
});
