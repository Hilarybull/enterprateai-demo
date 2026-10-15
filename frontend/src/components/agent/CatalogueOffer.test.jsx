// The draft's new items offered once: "Add 'Flower · £200' to your catalogue?" with Add and Not now; either answer closes it.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as client from "../../api/client";
import { CatalogueOffer } from "./DraftEditor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const ITEMS = [{ name: "Flower", unit_price: 200, currency: "GBP" }];

describe("the catalogue offer on a draft", () => {
  it("asks once with the item and price, and Add saves it", async () => {
    const call = vi.spyOn(client, "apiRequest").mockResolvedValue({ added: ["Flower"], message: "Added to your catalogue: Flower." });
    render(<CatalogueOffer runId="run-1" items={ITEMS} />);
    expect(screen.getByText("Add 'Flower · £200' to your catalogue?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Added to your catalogue: Flower."));
    expect(call).toHaveBeenCalledWith("/workflow-runs/run-1/catalogue-offer", "POST", { add: true });
  });

  it("Not now closes it", async () => {
    const call = vi.spyOn(client, "apiRequest").mockResolvedValue({ added: [] });
    const { container } = render(<CatalogueOffer runId="run-1" items={ITEMS} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(container.querySelector("[data-catalogue-offer]")).toBeNull());
    expect(call).toHaveBeenCalledWith("/workflow-runs/run-1/catalogue-offer", "POST", { add: false });
  });

  it("shows nothing when every item is already in the catalogue", () => {
    const { container } = render(<CatalogueOffer runId="run-1" items={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
