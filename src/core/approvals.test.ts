import { describe, expect, it } from "vitest";

import { approvalAuthority, approvalConfirm, approvePress, confirmed, DENY_PRESS, HOLD_CONFIRM_MS } from "./approvals.js";

const ALL = ["accept", "acceptForSession", "acceptAlways", "decline"] as const;

describe("approvals", () => {
	it("defaults to opening the request in T3 Code and to a hold", () => {
		expect(approvalAuthority(undefined)).toBe("open");
		expect(approvalAuthority("bogus")).toBe("open");
		expect(approvalConfirm(undefined)).toBe("hold");
		expect(approvePress("open", ALL)).toEqual({ kind: "open", label: "Open in T3" });
	});

	it("maps each authority to its decision", () => {
		expect(approvePress("once", ALL)).toMatchObject({ kind: "respond", decision: "accept" });
		expect(approvePress("session", ALL)).toMatchObject({ kind: "respond", decision: "acceptForSession" });
		expect(approvePress("always", ALL)).toMatchObject({ kind: "respond", decision: "acceptAlways", label: "Always allow" });
	});

	it("opens the request instead when it doesn't offer the authority's decision", () => {
		expect(approvePress("always", ["accept", "decline"])).toEqual({ kind: "open", label: "Open in T3" });
		expect(DENY_PRESS).toMatchObject({ kind: "respond", decision: "decline" });
	});

	it("answers on a hold, or on any press when set to tap; opening never waits", () => {
		const allow = approvePress("once", ALL);
		expect(confirmed(allow, "hold", HOLD_CONFIRM_MS - 1)).toBe(false);
		expect(confirmed(allow, "hold", HOLD_CONFIRM_MS)).toBe(true);
		expect(confirmed(DENY_PRESS, "tap", 0)).toBe(true);
		expect(confirmed(approvePress("open", ALL), "hold", 0)).toBe(true);
	});
});
