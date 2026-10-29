import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { configWatch } from "./configwatch.js";
import { Keys } from "./keys.js";
import { type SidecarDeps, sidecarKinds } from "./kinds.js";
import { logiRuntime } from "./runtime.js";
import type { ThreadBoard } from "../core/board.js";

/** The sidecar's wiring: Keys over the real kinds, with the config watch the sidecar builds. */
function sidecar() {
	const release = vi.fn();
	const machine = { url: "http://m", watchConfig: vi.fn(() => release) };
	const { watch, unwatch } = configWatch(() => [machine]);
	const board = { threads: [], threadsOn: () => [], selectedOn: () => undefined } as unknown as ThreadBoard;
	const runtime = logiRuntime({ machines: () => [], board, openThread: async () => undefined, selectThread: () => undefined, repaint: () => undefined, warn: () => undefined });
	const deps = { board, open: () => undefined, openExternal: async () => undefined, refreshLimits: (action?: string) => action !== undefined && watch(action), watchConfigs: watch, unwatchConfigs: unwatch, failed: () => () => undefined, settingsUrl: () => "", runtime, warn: () => undefined } as unknown as SidecarDeps;
	return { keys: new Keys(sidecarKinds(deps), () => undefined), machine, release };
}

// The folder's entries and which of them follow it open and closed, read from the C# so the two can't drift.
const FOLDER = readFileSync(new URL("../../logi/TurnkeyPlugin/src/Actions/TurnkeyFolder.cs", import.meta.url), "utf8");
const ENTRIES = [...FOLDER.slice(FOLDER.indexOf("Actions ="), FOLDER.indexOf("};")).matchAll(/"([a-zA-Z]+:[^"]*)"/g)].map((match) => match[1]!);
const FOLDER_ONLY_RULE = 'action.StartsWith("git:") || action.StartsWith("pr:") || action == "health:" || action == "open:preview"';
const folderOnly = (action: string) => action.startsWith("git:") || action.startsWith("pr:") || action === "health:" || action === "open:preview";

describe("the config watch", () => {
	it("is read from the folder's real entries", () => {
		expect(FOLDER).toContain(FOLDER_ONLY_RULE);
		expect(ENTRIES).toContain("open:preview");
		expect(ENTRIES).toContain("limits:");
		expect(ENTRIES.length).toBeGreaterThan(20);
	});

	it("is released when the folder closes, if no Limits or top-level config key has shown", () => {
		const { keys, machine, release } = sidecar();
		const own = ENTRIES.filter(folderOnly);
		for (const action of own) keys.handle({ type: "appear", action, size: 80 });
		expect(machine.watchConfig).toHaveBeenCalledOnce();
		for (const action of own) keys.handle({ type: "disappear", action });
		expect(release).toHaveBeenCalledOnce();
	});

	it("stays held after the folder closes once limits: has shown, as it always has", () => {
		const { keys, release } = sidecar();
		for (const action of ENTRIES) keys.handle({ type: "appear", action, size: 80 });
		for (const action of ENTRIES.filter(folderOnly)) keys.handle({ type: "disappear", action });
		expect(release).not.toHaveBeenCalled();
	});

	it("stays held while a top-level key that never reports hiding is shown", () => {
		const { keys, release } = sidecar();
		keys.handle({ type: "appear", action: "open:editor", size: 80 });
		keys.handle({ type: "appear", action: "health:", size: 80 });
		keys.handle({ type: "disappear", action: "health:" });
		expect(release).not.toHaveBeenCalled();
	});

	it("is taken again by the next key that shows", () => {
		const { keys, machine, release } = sidecar();
		keys.handle({ type: "appear", action: "health:", size: 80 });
		keys.handle({ type: "disappear", action: "health:" });
		keys.handle({ type: "appear", action: "health:", size: 80 });
		expect(release).toHaveBeenCalledOnce();
		expect(machine.watchConfig).toHaveBeenCalledTimes(2);
	});
});
