// QA P2-12: dates are shown and typed the UK way (dd/mm/yyyy) whatever the browser's language.
import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import UkDateInput, { isoFromUk, ukDate } from "./UkDateInput";

afterEach(cleanup);

describe("UK dates", () => {
  it("reads and writes dd/mm/yyyy, and refuses a date that doesn't exist", () => {
    expect(ukDate("2026-10-11")).toBe("11/10/2026");
    expect(isoFromUk("11/10/2026")).toBe("2026-10-11");
    expect(isoFromUk("1.2.27")).toBe("2027-02-01");
    expect(isoFromUk("2026-10-11")).toBe("2026-10-11");
    expect(isoFromUk("31/02/2026")).toBeNull();
    expect(isoFromUk("10/31/2026")).toBeNull();      // a US order is not quietly swapped
  });

  it("shows the value as dd/mm/yyyy and hands back ISO", () => {
    let got = null;
    function Host() { const [v, setV] = useState("2026-10-11"); return <UkDateInput aria-label="Valid until" value={v} onChange={(x) => { got = x; setV(x); }} />; }
    render(<Host />);
    const box = screen.getByLabelText("Valid until");
    expect(box.value).toBe("11/10/2026");
    fireEvent.change(box, { target: { value: "25/12/2026" } });
    expect(got).toBe("2026-12-25");
    fireEvent.change(box, { target: { value: "12/25/2026" } });
    expect(screen.getByRole("alert").textContent).toBe("Use dd/mm/yyyy, for example 11/10/2026.");
  });
});
