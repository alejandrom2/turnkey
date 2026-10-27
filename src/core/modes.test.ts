import { describe, expect, it } from "vitest";

import { defaultMode, MERGED, modeOf } from "./modes.js";
import { QUICK_PROMPTS } from "./prompts.js";

const id = (suffix: string) => `com.alejandrom2.t3deck.${suffix}`;

describe("modeOf", () => {
	it("gives an older single-purpose key its own mode when it has none saved", () => {
		expect(modeOf("git", id("git.push"), {})).toBe("push");
		expect(modeOf("git", id("git.pr"), {})).toBe("create_pr");
		expect(modeOf("pr", id("pr.fix"), {})).toBe("fix");
		expect(modeOf("send", id("quick"), {})).toBe("continue");
		expect(modeOf("stop", id("workflow.stop"), {})).toBe("workflow");
		expect(modeOf("fork", id("merge"), {})).toBe("merge");
		expect(modeOf("open", id("preview"), {})).toBe("preview");
	});

	it("keeps a saved mode, on a merged key or an older one", () => {
		expect(modeOf("git", id("git.commit"), { gitAction: "commit_push" })).toBe("commit_push");
		expect(modeOf("git", id("git.push"), { gitAction: "pull" })).toBe("pull");
		expect(modeOf("send", id("quick"), { template: "custom" })).toBe("custom");
		expect(modeOf("open", id("open"), { mode: "preview" })).toBe("preview");
		expect(modeOf("pr", id("pr"), { mode: "guide" })).toBe("guide");
	});

	it("starts a merged key in its most common mode", () => {
		expect(modeOf("git", id("git"), {})).toBe("commit");
		expect(modeOf("pr", id("pr"), {})).toBe("show");
		expect(modeOf("send", id("send"), {})).toBe("custom");
		expect(modeOf("stop", id("stop"), {})).toBe("turn");
		expect(modeOf("fork", id("fork"), {})).toBe("fork");
		expect(modeOf("open", id("open"), {})).toBe("editor");
	});

	it("ignores a saved value that isn't one of the action's modes", () => {
		expect(modeOf("git", id("git.pull"), { gitAction: "rebase" })).toBe("pull");
		expect(modeOf("stop", id("stop"), { mode: "toString" })).toBe("turn");
		expect(modeOf("send", id("quick"), { template: 3 })).toBe("continue");
		expect(defaultMode("fork", undefined)).toBe("fork");
	});
});

describe("MERGED", () => {
	it("offers every Quick Prompt template as a Send Prompt mode", () => {
		expect(MERGED.send.modes.filter((mode) => mode !== "custom")).toEqual(Object.keys(QUICK_PROMPTS));
	});

	it("presets every UUID to one of its action's modes", () => {
		for (const { modes, uuids } of Object.values(MERGED)) for (const mode of Object.values(uuids)) expect(modes).toContain(mode);
	});
});
