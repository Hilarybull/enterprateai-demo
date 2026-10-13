import { afterEach, describe, expect, it, vi } from "vitest";
import { syncAuthAcrossTabs, useAuthStore } from "./auth";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("sign-in reaches every open tab", () => {
  it("a sign-in in another tab checks the new token here", () => {
    const hydrate = vi.fn();
    useAuthStore.setState({ token: null, hydrate });
    localStorage.setItem("ea_token", "new-token");
    syncAuthAcrossTabs({ key: "ea_token" });
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it("a sign-out in another tab signs this one out", () => {
    const logout = vi.fn();
    useAuthStore.setState({ token: "old-token", logout });
    syncAuthAcrossTabs({ key: "ea_token" });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("other keys and the same token change nothing", () => {
    const hydrate = vi.fn(); const logout = vi.fn();
    localStorage.setItem("ea_token", "t");
    useAuthStore.setState({ token: "t", hydrate, logout });
    syncAuthAcrossTabs({ key: "ea_token" });
    syncAuthAcrossTabs({ key: "ea_referral" });
    expect(hydrate).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });
});
