// QA R7: no native date input is left showing the browser's own format; the shared Input renders the UK one.
import React from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Input from "./Input";

afterEach(cleanup);
const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".jsx") && !p.includes(".test.") ? [p] : []; });

describe("UK dates everywhere", () => {
  it("no <input type=\"date\"> is written directly in the app", () => {
    const offenders = files(join(__dirname, "..")).filter((p) => !p.endsWith("UkDateInput.jsx"))
      .flatMap((p) => [...readFileSync(p, "utf8").matchAll(/<input\b[^>]*?\btype="date"/g)].map(() => p));
    expect(offenders).toEqual([]);
  });

  it("the shared Input shows dd/mm/yyyy for a date and still hands back an event with the ISO value", () => {
    const onChange = vi.fn();
    render(<Input type="date" aria-label="Issued" value="2026-10-11" onChange={onChange} />);
    const box = screen.getByLabelText("Issued");
    expect(box.value).toBe("11/10/2026");
    fireEvent.change(box, { target: { value: "12/10/2026" } });
    expect(onChange).toHaveBeenCalledWith({ target: { value: "2026-10-12", name: undefined } });
  });
});
