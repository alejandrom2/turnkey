import { describe, expect, it, vi } from "vitest";

import { HOLD_CONFIRM_MS } from "../approvals.js";
import { confirmed } from "./key.js";

describe("confirmed", () => {
  it("treats a click as deliberate", () => {
    expect(confirmed({ heldMs: 0, confirmBy: "click" }, () => false)).toBe(
      true,
    );
  });

  it("needs a hold of HOLD_CONFIRM_MS on hold", () => {
    expect(
      confirmed({ heldMs: HOLD_CONFIRM_MS - 1, confirmBy: "hold" }, () => true),
    ).toBe(false);
    expect(
      confirmed({ heldMs: HOLD_CONFIRM_MS, confirmBy: "hold" }, () => false),
    ).toBe(true);
  });

  it("defers to the key's own rule on settings, ignoring the hold", () => {
    const rule = vi.fn(() => false);
    expect(confirmed({ heldMs: 10_000, confirmBy: "settings" }, rule)).toBe(
      false,
    );
    expect(rule).toHaveBeenCalledOnce();
    expect(confirmed({ heldMs: 0, confirmBy: "settings" }, () => true)).toBe(
      true,
    );
  });
});
