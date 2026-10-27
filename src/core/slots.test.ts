import { describe, expect, it } from "vitest";

import { assignSlots, matchesFilter, slotSetting } from "./slots.js";

const at = (id: string, row: number, column: number, extra: { group?: string; slot?: number } = {}) => ({ id, group: "deck|", position: { row, column }, ...extra });

describe("assignSlots", () => {
	it("fills keys in reading order, per group", () => {
		const slots = assignSlots([at("c", 1, 0), at("b", 0, 3), at("a", 0, 1), at("other", 0, 0, { group: "neo|" })]);
		expect(Object.fromEntries(slots)).toEqual({ a: 0, b: 1, c: 2, other: 0 });
	});

	it("lets a slot set by hand win, and skips it when filling the rest", () => {
		const slots = assignSlots([at("a", 0, 0), at("pinned", 0, 1, { slot: 1 }), at("b", 0, 2), at("selected", 0, 3, { slot: 0 })]);
		expect(Object.fromEntries(slots)).toEqual({ a: 1, pinned: 0, b: 2, selected: "selected" });
	});

	it("gives a key without a position (in a multi-action) the first free slot", () => {
		const slots = assignSlots([{ id: "multi", group: "deck|" }, at("a", 0, 0)]);
		expect(Object.fromEntries(slots)).toEqual({ multi: 0, a: 0 });
	});

	it("reads the slot setting, treating empty as by position", () => {
		expect([slotSetting(""), slotSetting(undefined), slotSetting("0"), slotSetting("3"), slotSetting("x")]).toEqual([undefined, undefined, 0, 3, undefined]);
	});
});

describe("matchesFilter", () => {
	const thread = (deck: string, unseen = false, projectId = "p") => ({ deck, unseen, projectId }) as Parameters<typeof matchesFilter>[0];

	it("keeps what needs you for attention, and what runs for active", () => {
		const threads = { approval: thread("approval"), failed: thread("failed"), seen: thread("done"), unseen: thread("done", true), running: thread("running"), queued: thread("queued") };
		const pass = (filter: Parameters<typeof matchesFilter>[1]) =>
			Object.entries(threads)
				.filter(([, value]) => matchesFilter(value, filter))
				.map(([name]) => name);
		expect(pass("attention")).toEqual(["approval", "failed", "unseen"]);
		expect(pass("active")).toEqual(["running", "queued"]);
		expect(pass("unread")).toEqual(["unseen"]);
		expect(pass("all")).toHaveLength(6);
	});

	it("narrows to one project when set", () => {
		expect(matchesFilter(thread("idle", false, "p"), "all", "q")).toBe(false);
		expect(matchesFilter(thread("idle", false, "q"), "all", "q")).toBe(true);
	});
});
