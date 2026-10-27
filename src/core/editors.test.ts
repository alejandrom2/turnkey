import { describe, expect, it } from "vitest";

import { editorLabel, knownEditors, openInEditorInput, pickEditor } from "./editors.js";

describe("editors", () => {
	it("keeps the machine's editors this deck knows, in T3 Code's order", () => {
		expect(knownEditors(["zed", "future-editor", "cursor"])).toEqual(["cursor", "zed"]);
		expect(editorLabel("vscode-insiders")).toBe("VS Code Insiders");
	});

	it("opens the chosen editor, T3 Code's first available one by default, and names a choice the machine lacks", () => {
		expect(pickEditor("", ["zed", "vscode"])).toEqual({ editor: "vscode" });
		expect(pickEditor("zed", ["zed", "vscode"])).toEqual({ editor: "zed" });
		expect(pickEditor("idea", ["zed"])).toEqual({ missing: "IntelliJ IDEA" });
		expect(pickEditor(undefined, [])).toBeUndefined();
	});

	it("sends shell.openInEditor's LaunchEditorInput", () => {
		expect(openInEditorInput("/w/app", "cursor")).toEqual({ cwd: "/w/app", editor: "cursor" });
	});
});
