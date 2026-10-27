import { describe, expect, it } from "vitest";

import { applyTerminalEvent, projectScripts, scriptGlyph, scriptLaunch, scriptState, scriptTerminalId, type TerminalSummary, terminalKey } from "./scripts.js";

const dev = { id: "dev", name: "Dev", command: "npm run dev", icon: "play" };
const test = { id: "test", name: "Test", command: "npm test", icon: "test" };
const lint = { id: "lint", name: "Lint", command: "npm run lint", icon: "lint" };

describe("project scripts", () => {
	it("resolve like T3 Code: override, folded defaults, legacy override, own scripts, defaults", () => {
		const project = { id: "p1", scripts: [dev] };
		expect(projectScripts(undefined, project)).toEqual([dev]);
		expect(projectScripts({ defaultProjectScripts: [lint] }, { id: "p1", scripts: [] })).toEqual([lint]);
		expect(projectScripts({ defaultProjectScripts: [lint], projectSettingsOverrides: { p1: { defaultProjectScripts: [test] } } }, project)).toEqual([test]);
		expect(projectScripts({ defaultProjectScripts: [lint], projectSettingsFolded: true }, project)).toEqual([lint]);
		expect(projectScripts({ defaultProjectScripts: [lint], projectScriptOverrides: { p1: null } }, project)).toEqual([lint]);
		expect(projectScripts({ defaultProjectScripts: [lint], projectScriptOverrides: { p1: [test] } }, project)).toEqual([test]);
	});

	it("run in the thread's worktree with T3 Code's environment, else the project root", () => {
		expect(scriptLaunch("/repo", "/wt/a")).toEqual({ cwd: "/wt/a", worktreePath: "/wt/a", env: { T3CODE_PROJECT_ROOT: "/repo", T3CODE_WORKTREE_PATH: "/wt/a" } });
		expect(scriptLaunch("/repo", undefined)).toEqual({ cwd: "/repo", worktreePath: null, env: { T3CODE_PROJECT_ROOT: "/repo" } });
		expect(scriptTerminalId("x".repeat(200))).toHaveLength(128);
		expect(scriptGlyph("build")).toBe("hammer");
		expect(scriptGlyph("unknown")).toBe("play");
	});
});

const summary = (patch: Partial<TerminalSummary> = {}): TerminalSummary => ({ threadId: "t1", terminalId: "deck-dev", status: "running", exitCode: null, hasRunningSubprocess: false, ...patch });

describe("terminal metadata", () => {
	it("follows snapshots, upserts and removals", () => {
		const key = terminalKey("t1", "deck-dev");
		let terminals = applyTerminalEvent(new Map(), { type: "snapshot", terminals: [summary()] });
		expect(terminals.get(key)?.hasRunningSubprocess).toBe(false);
		terminals = applyTerminalEvent(terminals, { type: "upsert", terminal: summary({ hasRunningSubprocess: true }) });
		expect(terminals.get(key)?.hasRunningSubprocess).toBe(true);
		const same = applyTerminalEvent(terminals, { type: "mystery" });
		expect(same).toBe(terminals);
		expect(applyTerminalEvent(terminals, { type: "remove", threadId: "t1", terminalId: "deck-dev" }).size).toBe(0);
	});
});

describe("script state", () => {
	const now = 10_000;
	it("is running while the shell runs a process, and starting until T3 Code's check sees it", () => {
		expect(scriptState(summary({ hasRunningSubprocess: true }), {}, now)).toEqual({ kind: "running" });
		expect(scriptState(undefined, { startedAt: now - 500 }, now)).toEqual({ kind: "starting" });
		expect(scriptState(summary(), { startedAt: now - 500 }, now)).toEqual({ kind: "starting" });
		expect(scriptState(summary(), { startedAt: now - 5_000 }, now)).toEqual({ kind: "finished" });
		expect(scriptState(undefined, {}, now)).toEqual({ kind: "idle" });
	});

	it("tells a stop by the deck from a finish, and shows the shell's own exit code", () => {
		expect(scriptState(summary(), { startedAt: now - 9_000, stoppedAt: now - 100 }, now)).toEqual({ kind: "stopped" });
		expect(scriptState(summary(), { startedAt: now - 100, stoppedAt: now - 9_000 }, now)).toEqual({ kind: "starting" });
		expect(scriptState(summary({ status: "exited", exitCode: 2 }), {}, now)).toEqual({ kind: "exited", code: 2 });
		expect(scriptState(summary({ status: "error" }), {}, now)).toEqual({ kind: "error" });
	});
});
