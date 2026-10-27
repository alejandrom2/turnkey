import { describe, expect, it } from "vitest";

import { dialPrompts, migratePromptSettings, templatePrompt } from "./prompts.js";

describe("templatePrompt", () => {
	it("sends a template's text under its short label", () => {
		expect(templatePrompt("test", "ignored")).toEqual({ label: "Fix tests", text: "Run the tests and fix any failures." });
		expect(templatePrompt("continue", undefined)).toMatchObject({ label: "Continue" });
	});

	it("sends the key's own prompt with no label, or nothing when it is empty", () => {
		expect(templatePrompt("custom", "  Ship it  ")).toEqual({ label: undefined, text: "Ship it" });
		expect(templatePrompt("custom", undefined).text).toBe("");
	});
});

describe("migratePromptSettings", () => {
	it("moves Send Prompt's legacy label to the key title, once", () => {
		expect(migratePromptSettings({ prompt: "Continue", label: "Go" })).toEqual({ prompt: "Continue", title: "Go" });
		expect(migratePromptSettings({ prompt: "Continue", title: "Go" })).toBeUndefined();
	});

	it("keeps a title set since, and drops an empty legacy label", () => {
		expect(migratePromptSettings({ title: "New", label: "Old" })).toEqual({ title: "New" });
		expect(migratePromptSettings({ prompt: "x", label: "" })).toEqual({ prompt: "x" });
	});
});

describe("dialPrompts", () => {
	it("lists the user's lines, then the templates not already among them", () => {
		const prompts = dialPrompts({ prompts: "Continue\n\n  Review your changes  \nrun the tests and fix any failures!" });
		expect(prompts.slice(0, 3)).toEqual([{ text: "Continue" }, { text: "Review your changes" }, { text: "run the tests and fix any failures!" }]);
		expect(prompts.slice(3).map((prompt) => prompt.label)).toEqual(["Diagnose", "Explain", "Commit"]);
	});

	it("leaves the templates out when turned off", () => {
		expect(dialPrompts({ prompts: "One", templates: false })).toEqual([{ text: "One" }]);
		expect(dialPrompts({})).toHaveLength(5);
	});
});
