import { describe, expect, it } from "vitest";

import { MAX_FIXES, requirements } from "./requirements.js";

describe("requirements", () => {
	it("lists each need as met, not met or still checking, and counts what is not met", () => {
		const { items, unmet } = requirements([
			{ kind: "paired", connection: "ready" },
			{ kind: "thread", ok: false },
			{ kind: "scope", scope: "source-control:write", ok: false },
			{ kind: "repo", ok: undefined },
		]);
		expect(items.map(({ id, label, state }) => [id, label, state])).toEqual([
			["paired", "Paired with T3 Code", "met"],
			["thread", "A selected thread", "unmet"],
			["scope:source-control:write", "Source control access", "unmet"],
			["repo", "Something to act on", "checking"],
		]);
		expect(unmet).toBe(2);
		expect(items[0]!.fixes).toEqual([]);
		expect(items[2]!.fixes).toEqual(["Create a pair link in T3 Code under Settings → Sharing & access.", "Keep its default access, then connect with the new link below."]);
	});

	it("names the fix for each connection problem", () => {
		const fixes = (connection: "none" | "missing" | "pair" | "offline") => requirements([{ kind: "paired", connection }]).items[0]!.fixes;
		expect(fixes("pair")).toEqual(["Paste a pair link from T3 Code under Add a machine."]);
		expect(fixes("none")).toHaveLength(2);
		expect(fixes("missing")).toEqual(["Pick another machine below."]);
	});

	it("shows a saved value that no longer exists as Not available, and puts a git reason first", () => {
		const { items } = requirements([
			{ kind: "value", value: "claude-old", ok: false },
			{ kind: "value", value: "high", ok: true },
			{ kind: "repo", ok: false, reason: "Nothing to commit" },
			{ kind: "option", option: "Fast mode", ok: false },
		]);
		expect(items.map((item) => item.label)).toEqual(["Not available: claude-old", "high", "Something to act on", "Fast mode on the thread's model"]);
		expect(items[2]!.fixes).toEqual(["Nothing to commit"]);
		expect(items.every((item) => item.fixes.length <= MAX_FIXES)).toBe(true);
	});
});
