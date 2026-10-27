// The window cases are ported from T3 Code's packages/shared/src/usageFormat.test.ts.
import { describe, expect, it, vi } from "vitest";

import { formatCount, formatPercent, formatTokens, formatUsd, makeWindow } from "./format.js";

describe("usage formats", () => {
	it("formats money, tokens, counts and shares like T3 Code", () => {
		expect(formatUsd(1234.5)).toBe("$1,234.50");
		expect(formatUsd(0)).toBe("$0.00");
		expect(formatTokens(48_211_903)).toBe("48.2M");
		expect(formatTokens(1_530_000)).toBe("1.53M");
		expect(formatTokens(120_000)).toBe("120K");
		expect(formatTokens(999)).toBe("999");
		expect(formatTokens(2e12)).toBe("2T");
		expect(formatCount(12_345.6)).toBe("12,346");
		expect(formatPercent(0.123)).toBe("12.3%");
		expect(formatPercent(0.0004)).toBe("<0.1%");
		expect(formatPercent(0)).toBe("0.0%");
	});
});

describe("usage windows", () => {
	it("builds an exact minute-aligned 24-hour request", () => {
		const window = makeWindow(1, new Date("2026-08-11T12:37:42.123Z"), "hour");
		expect(window.resolution).toBe("hour");
		expect(window.sinceTime).toBe("2026-08-10T12:37:00.000Z");
		expect(window.untilTime).toBe("2026-08-11T12:37:00.000Z");
	});

	it("counts calendar days back from today in the zone, today included", () => {
		const resolved = new Intl.DateTimeFormat().resolvedOptions();
		const zone = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ ...resolved, timeZone: "Europe/Madrid" });
		try {
			expect(makeWindow(7, new Date("2026-10-27T23:30:00.000Z"))).toEqual({ sinceDay: "2026-10-22", untilDay: "2026-10-28", timeZone: "Europe/Madrid", resolution: "day" });
			expect(makeWindow(30, new Date("2026-03-01T10:00:00.000Z"))).toMatchObject({ sinceDay: "2026-01-31", untilDay: "2026-03-01" });
		} finally {
			zone.mockRestore();
		}
	});

	it("degrades an unknown resolved zone to UTC instead of crashing", () => {
		const resolved = new Intl.DateTimeFormat().resolvedOptions();
		const resolvedOptions = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ ...resolved, timeZone: "Etc/Unknown" });
		try {
			const now = new Date("2026-08-11T12:37:42.123Z");
			expect(makeWindow(1, now, "hour").timeZone).toBe("UTC");
			expect(makeWindow(30, now).timeZone).toBe("UTC");
		} finally {
			resolvedOptions.mockRestore();
		}
	});
});
