import { afterEach, describe, expect, it } from "vitest";
import { humanCheck } from "./turnstile";

// A stand-in for Cloudflare: each render call does what the test says.
function cloudflare(...steps) {
  const renders = [];
  window.turnstile = {
    remove() {},
    render(box, options) {
      renders.push(options);
      const step = steps[renders.length - 1];
      setTimeout(() => step?.(options, box), 0);
      return renders.length;
    },
  };
  return renders;
}

afterEach(() => { delete window.turnstile; document.body.innerHTML = ""; });

describe("the person check", () => {
  it("does nothing until a site key is set", async () => {
    expect(await humanCheck("")).toEqual({});
  });

  it("passes quietly, with no checkbox, when Cloudflare is happy", async () => {
    const renders = cloudflare((o) => o.callback("quiet-token"));
    expect(await humanCheck("key")).toEqual({ headers: { "X-Turnstile-Token": "quiet-token" } });
    expect(renders).toHaveLength(1);
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("shows the checkbox when the quiet check fails, and uses what it returns", async () => {
    const renders = cloudflare((o) => o["error-callback"](), (o) => {
      expect(document.querySelector("[role=dialog]").textContent).toContain("Please tick the box");
      o.callback("ticked-token");
    });
    expect(await humanCheck("key")).toEqual({ headers: { "X-Turnstile-Token": "ticked-token" } });
    expect(renders.map((o) => o.appearance)).toEqual(["interaction-only", "always"]);
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("goes straight to the checkbox when Cloudflare wants the person to act", async () => {
    const renders = cloudflare((o) => o["before-interactive-callback"](), (o) => o.callback("ticked-token"));
    expect(await humanCheck("key")).toEqual({ headers: { "X-Turnstile-Token": "ticked-token" } });
    expect(renders).toHaveLength(2);
  });

  it("sends nothing if the person cancels, and clears the screen", async () => {
    cloudflare((o) => o["error-callback"](), () => document.querySelector("[role=dialog] button").click());
    expect(await humanCheck("key")).toEqual({});
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});
