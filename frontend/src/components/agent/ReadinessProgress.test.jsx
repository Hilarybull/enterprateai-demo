import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { apiRequest } from "../../api/client";
import ReadinessProgress from "./ReadinessProgress";
vi.mock("../../api/client", () => ({ apiRequest: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); apiRequest.mockReset(); });
test("completion returns saved drafts without starting another run, including after a status retry", async () => {
  vi.useFakeTimers();
  const card = { type: "readiness_tasks", drafts: [{ label: "Price", value: "300" }] };
  apiRequest.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ working: false, card });
  const ready = vi.fn();
  render(<ReadinessProgress businessId="business" item={{ case_id: "case", topic: "launch" }} onReady={ready} />);
  expect(screen.getByRole("progressbar")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.queryByRole("progressbar")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  expect(screen.getByRole("progressbar")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(ready).toHaveBeenCalledTimes(1);
  expect(ready).toHaveBeenCalledWith(card);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(apiRequest.mock.calls.every(call => call.length === 1 && call[0] === "/businesses/business/agent/readiness-work/launch/case")).toBe(true);
});

test("thinking and progress persist across pending polls until the saved answer is ready", async () => {
  vi.useFakeTimers();
  const card = { type: "readiness_tasks", drafts: [] };
  apiRequest.mockResolvedValueOnce({ working: true }).mockResolvedValueOnce({ working: true }).mockResolvedValueOnce({ card });
  const ready = vi.fn();
  render(<ReadinessProgress businessId="business" item={{ case_id: "case", topic: "funding" }} onReady={ready} />);
  expect(screen.getByText("Thinking…")).toBeTruthy();
  expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole("progressbar")).toBeTruthy();
  expect(ready).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(ready).toHaveBeenCalledWith(card);
  expect(screen.queryByRole("progressbar")).toBeNull();
});

test("an options search preserves its mode through the completion poll", async () => {
  vi.useFakeTimers();
  const card = { type: "options", options: [{ title: "Working Capital Loan", route: "loan" }] };
  apiRequest.mockResolvedValue({ card });
  const ready = vi.fn();
  render(<ReadinessProgress businessId="business" item={{ case_id: "case", topic: "funding", options: true }} onReady={ready} />);
  expect(screen.getByText(/Searching for funding options/)).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(apiRequest).toHaveBeenCalledWith("/businesses/business/agent/readiness-work/funding/case?options=true");
  expect(ready).toHaveBeenCalledWith(card);
});

test("an interrupted run offers saved work and a deliberate retry without starting a new job automatically", async () => {
  vi.useFakeTimers();
  const card={type:"readiness_tasks",items:[],drafts:[{label:"Saved",value:"Retained"}]};
  apiRequest.mockResolvedValueOnce({problem:"The server restarted."}).mockResolvedValueOnce(card);
  const ready=vi.fn(),retry=vi.fn();
  render(<ReadinessProgress businessId="business" item={{case_id:"case",topic:"funding"}} onReady={ready} onRetry={retry}/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
  expect(screen.queryByRole("progressbar")).toBeNull();expect(retry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Retry research"}));expect(retry).toHaveBeenCalledOnce();
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Review saved work"}));});
  expect(ready).toHaveBeenCalledWith(card);
  expect(apiRequest.mock.calls.every(call=>call.length===1)).toBe(true);
});
