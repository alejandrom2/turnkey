import { describe, expect, it } from "vitest";

import { migratePromptSettings, quickPrompt } from "./prompts.js";

describe("quickPrompt", () => {
	it("sends a template's text under its short label, defaulting to Continue", () => {
		expect(quickPrompt({ template: "test" })).toEqual({ label: "Fix tests", text: "Run the tests and fix any failures." });
		expect(quickPrompt({})).toMatchObject({ label: "Continue" });
		expect(quickPrompt({ template: "toString" })).toMatchObject({ label: "Continue" });
	});

	it("sends the custom prompt, or nothing when it is empty", () => {
		expect(quickPrompt({ template: "custom", prompt: "  Ship it  " })).toEqual({ label: "Prompt", text: "Ship it" });
		expect(quickPrompt({ template: "custom" }).text).toBe("");
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
