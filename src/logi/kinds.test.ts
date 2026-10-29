import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeckThread, ThreadBoard } from "../core/board.js";
import type { ModelConfig } from "../core/models.js";
import { QUICK_PROMPTS } from "../core/prompts.js";
import { COLORS } from "../core/render.js";
import type { Machine } from "../core/t3/machine.js";
import { type SidecarDeps, sidecarKinds } from "./kinds.js";
import { effortFace, limitsFace, ringFace } from "./ring.js";
import { logiRuntime } from "./runtime.js";

const golden = (name: string) => readFileSync(new URL(`./__goldens__/${name}.svg`, import.meta.url), "utf8");
const keypad = (name: string) => golden(`keypad-${name}-116`);

const effort = { id: "effort", label: "Effort", type: "select" as const, options: [{ id: "low", label: "Low" }, { id: "high", label: "High", isDefault: true }] };
const CONFIG: ModelConfig = {
	providers: [
		{ instanceId: "claudeAgent", driver: "claudeAgent", supportedRuntimeModes: ["approval-required", "auto", "full-access"], models: [{ slug: "opus", name: "Opus", capabilities: { optionDescriptors: [effort] } }] },
		{ instanceId: "codex", driver: "codex", models: [{ slug: "gpt-5.5", name: "GPT-5.5" }, { slug: "gpt-5.4", name: "GPT-5.4" }] },
	],
	settings: { favorites: [{ provider: "claudeAgent", model: "opus" }, { provider: "codex", model: "gpt-5.5" }, { provider: "codex", model: "gpt-5.4" }] },
};

function setup(threads: Array<Partial<DeckThread> & { key: string }>, options: { selected?: string; canOperate?: boolean } = {}) {
	const machine = {
		url: "http://m",
		canOperate: options.canOperate ?? true,
		state: { kind: "signed-out" },
		modelConfig: CONFIG,
		stopRun: vi.fn(async (_thread: unknown) => undefined),
		send: vi.fn(async () => undefined),
		setRuntimeMode: vi.fn(async () => undefined),
		setModelSelection: vi.fn(async () => undefined),
		turnDiff: () => undefined,
	};
	const all = threads.map((each, index) => ({ deck: "idle", unseen: false, title: `Thread ${index}`, threadId: each.key, activeRunId: "run", model: { instanceId: "claudeAgent", model: "opus" }, runtimeMode: "auto", machine, ...each }) as unknown as DeckThread);
	const board = { threads: all, threadsOn: () => all, selectedOn: () => all.find((each) => each.key === options.selected) } as unknown as ThreadBoard;
	const deps = {
		board,
		open: vi.fn<(thread: DeckThread) => void>(),
		openExternal: vi.fn(async () => undefined),
		refreshLimits: vi.fn(),
		watchConfigs: vi.fn(),
		failed: () => () => undefined,
		settingsUrl: () => "http://settings",
		runtime: logiRuntime({ machines: () => [machine as unknown as Machine], board, openThread: async () => undefined, selectThread: () => undefined, repaint: () => undefined, warn: () => undefined }),
		warn: () => undefined,
	} satisfies SidecarDeps;
	return { kinds: sidecarKinds(deps), machine, deps, all };
}

describe("sidecarKinds presses", () => {
	it("stop stops the open thread when it runs", () => {
		const { kinds, machine, all } = setup([{ key: "new", deck: "running" }, { key: "open", deck: "running" }], { selected: "open" });
		kinds.stop!.press!(0, "");
		expect(machine.stopRun).toHaveBeenCalledExactlyOnceWith(all[1]);
	});

	it("stop falls back to the newest running thread", () => {
		const { kinds, machine, all } = setup([{ key: "a", deck: "approval" }, { key: "new", deck: "running" }, { key: "old", deck: "running" }], { selected: "a" });
		kinds.stop!.press!(0, "");
		expect(machine.stopRun).toHaveBeenCalledExactlyOnceWith(all[1]);
	});

	it("stop does nothing on a machine that can't be operated", () => {
		const { kinds, machine } = setup([{ key: "a", deck: "running" }], { canOperate: false });
		kinds.stop!.press!(0, "");
		expect(machine.stopRun).not.toHaveBeenCalled();
	});

	it("stop acts on a single keypad tap, as on a Ring click", () => {
		const { kinds, machine, all } = setup([{ key: "a", deck: "running" }]);
		kinds.stop!.press!(0, "", 0);
		expect(machine.stopRun).toHaveBeenCalledExactlyOnceWith(all[0]);
	});

	it("stop names the run it would stop, even on a machine that can't be operated", () => {
		expect(setup([{ key: "a", deck: "running" }], { canOperate: false }).kinds.stop!.label!(0, "")).toBe("Thread 0");
		expect(setup([{ key: "a", deck: "done" }]).kinds.stop!.label!(0, "")).toBeUndefined();
	});

	it("stop reports a failed stop to the log only", async () => {
		const { machine, deps } = setup([{ key: "a", deck: "running" }]);
		const reported = vi.fn();
		machine.stopRun.mockRejectedValueOnce(new Error("boom"));
		const failed = vi.fn(() => reported);
		const stop = sidecarKinds({ ...deps, failed }).stop!;
		stop.press!(0, "");
		await vi.waitFor(() => expect(reported).toHaveBeenCalledOnce());
		expect(failed).toHaveBeenCalledWith("stop the run");
		expect(stop.face(0, "", 80)).toBe(golden("stopFace-available"));
		expect(stop.label!(0, "")).toBe("Thread 0");
	});

	it("stopAll stops every running thread on one press", () => {
		const { kinds, machine, all } = setup([{ key: "a", deck: "running" }, { key: "b", deck: "done" }, { key: "c", deck: "running" }]);
		kinds.stopAll!.press!(0, "");
		expect(machine.stopRun.mock.calls.map(([each]) => each)).toEqual([all[0], all[2]]);
	});

	it("urgent, waiting, running and status open the thread each picks", () => {
		const { kinds, deps, all } = setup([{ key: "r", deck: "running" }, { key: "q", deck: "question" }, { key: "a", deck: "approval" }, { key: "d", deck: "done" }]);
		for (const kind of ["urgent", "waiting", "running", "status"]) kinds[kind]!.press!(0, "");
		expect(deps.open.mock.calls.map(([each]) => each)).toEqual([all[0], all[1], all[0], all[0]]);
	});

	it("model:3 applies the third model in the picker", () => {
		const { kinds, machine } = setup([{ key: "a" }], { selected: "a" });
		kinds.model!.press!(0, "3");
		expect(machine.setModelSelection).toHaveBeenCalledExactlyOnceWith(expect.anything(), { instanceId: "codex", model: "gpt-5.4" });
	});

	it("model does nothing for the thread's own model or a place past the picker", () => {
		const { kinds, machine } = setup([{ key: "a" }], { selected: "a" });
		kinds.model!.press!(0, "1");
		kinds.model!.press!(0, "9");
		expect(machine.setModelSelection).not.toHaveBeenCalled();
	});

	it("access steps to the next mode", () => {
		const { kinds, machine } = setup([{ key: "a" }], { selected: "a" });
		kinds.access!.press!(0, "");
		expect(machine.setRuntimeMode).toHaveBeenCalledExactlyOnceWith(expect.anything(), "full-access");
	});

	it("effort steps to the next level, wrapping", () => {
		const top = setup([{ key: "a" }], { selected: "a" });
		top.kinds.effort!.press!(0, "");
		expect(top.machine.setModelSelection).toHaveBeenCalledExactlyOnceWith(top.all[0], { instanceId: "claudeAgent", model: "opus", options: [{ id: "effort", value: "low" }] });
		const low = setup([{ key: "a", model: { instanceId: "claudeAgent", model: "opus", options: [{ id: "effort", value: "low" }] } }], { selected: "a" });
		low.kinds.effort!.press!(0, "");
		expect(low.machine.setModelSelection).toHaveBeenCalledExactlyOnceWith(low.all[0], { instanceId: "claudeAgent", model: "opus", options: [{ id: "effort", value: "high" }] });
	});

	it("continue sends the continue step for a finished thread and opens one that waits", () => {
		const done = setup([{ key: "a", deck: "done" }], { selected: "a" });
		done.kinds.continue!.press!(0, "");
		expect(done.machine.send).toHaveBeenCalledExactlyOnceWith(done.all[0], QUICK_PROMPTS.continue.text, "auto");
		const waiting = setup([{ key: "a", deck: "approval" }], { selected: "a" });
		waiting.kinds.continue!.press!(0, "");
		expect(waiting.deps.open).toHaveBeenCalledExactlyOnceWith(waiting.all[0]);
		expect(waiting.machine.send).not.toHaveBeenCalled();
	});

	it("prompt:test sends the quick prompt's text", () => {
		const { kinds, machine, all } = setup([{ key: "a" }], { selected: "a" });
		kinds.prompt!.press!(0, "test");
		expect(machine.send).toHaveBeenCalledExactlyOnceWith(all[0], QUICK_PROMPTS.test.text, "auto");
	});

	it("prompts do nothing without an open thread, or for a name that isn't a prompt", () => {
		const none = setup([{ key: "a" }]);
		none.kinds.prompt!.press!(0, "test");
		const other = setup([{ key: "a" }], { selected: "a" });
		other.kinds.prompt!.press!(0, "nope");
		expect(none.machine.send).not.toHaveBeenCalled();
		expect(other.machine.send).not.toHaveBeenCalled();
	});

	it("send sends the written prompt trimmed, and nothing when it's blank", () => {
		const { kinds, machine, all } = setup([{ key: "a" }], { selected: "a" });
		kinds.send!.press!(0, "  hello  ");
		kinds.send!.press!(0, "   ");
		kinds.send!.press!(0, "");
		expect(machine.send).toHaveBeenCalledExactlyOnceWith(all[0], "hello", "auto");
	});

	it("settings opens the settings page", () => {
		const { kinds, deps } = setup([]);
		kinds.settings!.press!(0, "");
		expect(deps.openExternal).toHaveBeenCalledExactlyOnceWith("http://settings");
	});

	it("the limit slots refresh on appearing, and models watch the config", () => {
		const { kinds, deps } = setup([]);
		kinds.limit!.appear!();
		kinds.limits!.appear!();
		kinds.limit!.press!(0, "1");
		kinds.model!.appear!();
		expect(deps.refreshLimits).toHaveBeenCalledTimes(3);
		expect(deps.watchConfigs).toHaveBeenCalledOnce();
	});
});

describe("prompts, Continue and limits as they have always acted", () => {
	const FRESH = "2026-06-01T11:58:00Z";
	const window = (id: string, label: string, usedPercent: number, mins: number) => ({ id, kind: "session", label, usedPercent, resetsAt: "2026-06-01T15:00:00Z", windowDurationMins: mins });
	const reporting = (driver: string, windows: unknown[], checkedAt = FRESH) => ({ instanceId: driver, driver, enabled: true, installed: true, models: [], auth: { email: `${driver}@example.test` }, usageLimits: { checkedAt, windows } });

	/** A ready machine whose providers report limits: Codex at 30% of its tightest window, Claude at 40%. */
	function limited(checkedAt = FRESH) {
		const { deps, machine } = setup([]);
		Object.assign(machine, {
			state: { kind: "ready", environmentId: "env", label: "Studio", canOperate: true },
			environmentId: "env",
			modelConfig: { providers: [reporting("codex", [window("primary", "Session", 20, 300), window("secondary", "Weekly", 30, 10_080)], checkedAt), reporting("claudeAgent", [window("five", "5-hour", 40, 300)], checkedAt)] },
		});
		return { kinds: sidecarKinds(deps), deps };
	}

	beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00Z")));
	afterEach(() => void vi.useRealTimers());

	it("prompt draws each prompt's glyph, and a dim chat glyph for any other name", () => {
		const { kinds } = setup([{ key: "a" }], { selected: "a" });
		for (const name of ["test", "fix", "explain", "commit"]) expect(kinds.prompt!.face(0, name, 80)).toBe(golden(`promptFace-${name}`));
		for (const name of ["nope", "continue", "custom", ""]) expect(kinds.prompt!.face(0, name, 80), name).toBe(ringFace(COLORS.muted, "chat", { dim: true }));
	});

	it("prompt sends nothing for Continue, Custom or another name that has a template but no glyph", () => {
		const { kinds, machine } = setup([{ key: "a" }], { selected: "a" });
		for (const name of ["continue", "custom", "nope", ""]) kinds.prompt!.press!(0, name);
		expect(machine.send).not.toHaveBeenCalled();
	});

	it("prompt and send have no label, and Continue's names the open thread only where it can act", () => {
		const { kinds } = setup([{ key: "a", deck: "done" }], { selected: "a" });
		expect(kinds.prompt!.label?.(0, "fix")).toBeUndefined();
		expect(kinds.send!.label?.(0, "hello")).toBeUndefined();
		expect(kinds.continue!.label!(0, "")).toBe("Thread 0");
		expect(setup([{ key: "a", deck: "done" }], { selected: "a", canOperate: false }).kinds.continue!.label!(0, "")).toBeUndefined();
		expect(setup([{ key: "a", deck: "done" }]).kinds.continue!.label!(0, "")).toBeUndefined();
	});

	it("prompt, send and Continue send nothing where the machine can't act", () => {
		const { kinds, machine, deps } = setup([{ key: "a", deck: "done" }], { selected: "a", canOperate: false });
		kinds.prompt!.press!(0, "fix");
		kinds.send!.press!(0, "hello");
		kinds.continue!.press!(0, "");
		expect(machine.send).not.toHaveBeenCalled();
		expect(deps.open).not.toHaveBeenCalled();
	});

	it("a keypad hold on prompt or send still sends, never restarts", () => {
		const { kinds, machine, all } = setup([{ key: "a" }], { selected: "a" });
		kinds.prompt!.press!(0, "fix", 900);
		kinds.send!.press!(0, " hi ", 900);
		kinds.prompt!.press!(0, "commit", 0);
		expect(machine.send.mock.calls).toEqual([
			[all[0], QUICK_PROMPTS.fix.text, "auto"],
			[all[0], "hi", "auto"],
			[all[0], QUICK_PROMPTS.commit.text, "auto"],
		]);
	});

	it("prompt, send and Continue report a failed send to the log only, and keep their faces", async () => {
		const { deps, machine } = setup([{ key: "a", deck: "done" }], { selected: "a" });
		const logged = vi.fn();
		const kinds = sidecarKinds({ ...deps, failed: (what) => (error) => logged(what, error) });
		const refused = new Error("refused");
		machine.send.mockRejectedValue(refused);
		kinds.prompt!.press!(0, "fix");
		kinds.send!.press!(0, "hello");
		kinds.continue!.press!(0, "");
		await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(3));
		expect(logged.mock.calls).toEqual([
			["send the prompt", refused],
			["send the prompt", refused],
			["continue the thread", refused],
		]);
		expect(kinds.prompt!.face(0, "fix", 80)).toBe(golden("promptFace-fix"));
		expect(kinds.send!.face(0, "hello", 80)).toBe(golden("customPromptFace-text"));
		expect(kinds.continue!.face(0, "", 80)).toBe(golden("continueFace-send"));
	});

	it("Continue opens a thread waiting on a question, and does nothing while it runs or is queued, or with none open", () => {
		const question = setup([{ key: "a", deck: "question" }], { selected: "a" });
		question.kinds.continue!.press!(0, "");
		expect(question.deps.open).toHaveBeenCalledExactlyOnceWith(question.all[0]);
		expect(question.kinds.continue!.face(0, "", 80)).toBe(golden("continueFace-open"));
		for (const deck of ["running", "queued"] as const) {
			const busy = setup([{ key: "a", deck }], { selected: "a" });
			busy.kinds.continue!.press!(0, "");
			expect(busy.machine.send).not.toHaveBeenCalled();
			expect(busy.deps.open).not.toHaveBeenCalled();
			expect(busy.kinds.continue!.face(0, "", 80)).toBe(golden("continueFace-none"));
		}
		const none = setup([{ key: "a", deck: "done" }]);
		none.kinds.continue!.press!(0, "");
		expect(none.machine.send).not.toHaveBeenCalled();
		expect(none.kinds.continue!.face(0, "", 80)).toBe(golden("continueFace-none"));
	});

	it("Continue opens a waiting thread exactly once, sending nothing", () => {
		const { kinds, deps, machine, all } = setup([{ key: "a", deck: "approval" }], { selected: "a" });
		kinds.continue!.press!(0, "", 900);
		expect(deps.open).toHaveBeenCalledExactlyOnceWith(all[0]);
		expect(machine.send).not.toHaveBeenCalled();
	});

	it("limit n draws the nth provider's tightest window, with its mark and label", () => {
		const { kinds } = limited();
		expect(kinds.limit!.face(0, "2", 80)).toBe(golden("limitsFace-provider"));
		expect(kinds.limit!.label!(0, "2")).toBe("Claude · 5-hour: 40% used");
		expect(kinds.limit!.face(0, "1", 80)).toBe(limitsFace(30, false, "codex"));
		expect(kinds.limit!.label!(0, "1")).toBe("Codex · Weekly: 30% used");
	});

	it("limit n draws unavailable, with no label, past the providers or for a place that isn't one", () => {
		const { kinds } = limited();
		for (const place of ["0", "3", "9", "abc", ""]) {
			expect(kinds.limit!.face(0, place, 80), place).toBe(golden("limitsFace-unavailable"));
			expect(kinds.limit!.label!(0, place), place).toBeUndefined();
		}
	});

	it("limit n dims a stale limit", () => {
		expect(limited("2026-06-01T08:00:00Z").kinds.limit!.face(0, "2", 80)).toBe(golden("limitsFace-provider-stale"));
	});

	it("the Limits folder draws the tightest window of all, without a mark, and has no press", () => {
		const { kinds } = limited();
		expect(kinds.limits!.face(0, "", 80)).toBe(golden("limitsFace-low"));
		expect(kinds.limits!.face(0, "anything", 80)).toBe(golden("limitsFace-low"));
		expect(kinds.limits!.label!(0, "")).toBe("Claude · 5-hour: 40% used");
		expect(kinds.limits!.press).toBeUndefined();
		expect(setup([]).kinds.limits!.label!(0, "")).toBeUndefined();
	});

	it("a limit press, Ring click or keypad hold, only refreshes the limits", () => {
		const { kinds, deps } = limited();
		kinds.limit!.press!(0, "2");
		kinds.limit!.press!(0, "2", 900);
		expect(deps.refreshLimits).toHaveBeenCalledTimes(2);
		expect(deps.openExternal).not.toHaveBeenCalled();
	});
});

describe("access, effort and model on the shared keys", () => {
	it("still do nothing when they can't act, with no flash", () => {
		const { kinds, machine } = setup([{ key: "a" }], { selected: "a", canOperate: false });
		for (const kind of ["access", "effort", "model"]) {
			const face = kinds[kind]!.face(0, "1", 80);
			kinds[kind]!.press!(0, "1");
			expect(kinds[kind]!.face(0, "1", 80)).toBe(face);
			expect(kinds[kind]!.label!(0, "1")).toBeUndefined();
		}
		expect(machine.setModelSelection).not.toHaveBeenCalled();
		expect(machine.setRuntimeMode).not.toHaveBeenCalled();
	});

	it("log a failed change as before, without a flash", async () => {
		const { deps, machine } = setup([{ key: "a" }], { selected: "a" });
		const logged = vi.fn();
		const kinds = sidecarKinds({ ...deps, failed: (what) => (error) => logged(what, error) });
		const refused = new Error("refused");
		machine.setModelSelection.mockRejectedValue(refused);
		const face = kinds.effort!.face(0, "", 80);
		kinds.effort!.press!(0, "");
		await vi.waitFor(() => expect(logged).toHaveBeenCalledExactlyOnceWith("change the effort", refused));
		expect(kinds.effort!.face(0, "", 80)).toBe(face);
		expect(kinds.effort!.label!(0, "")).toBe("High");
	});

	it("label the slot with the thread's current effort and access", () => {
		const { kinds } = setup([{ key: "a" }], { selected: "a" });
		expect(kinds.effort!.label!(0, "")).toBe("High");
		expect(kinds.access!.label!(0, "")).toBe("Auto");
	});
});

describe("sidecarKinds faces match their goldens", () => {
	it("stop", () => {
		expect(setup([{ key: "a", deck: "running" }], { selected: "a" }).kinds.stop!.face(0, "", 80)).toBe(golden("stopFace-available"));
		expect(setup([{ key: "a", deck: "done" }]).kinds.stop!.face(0, "", 80)).toBe(golden("stopFace-dim"));
	});

	it("stopAll", () => {
		const { kinds } = setup([{ key: "a", deck: "running" }, { key: "b", deck: "running" }, { key: "c", deck: "running" }]);
		expect(kinds.stopAll!.face(0, "", 80)).toBe(golden("stopAllFace-three"));
		expect(setup([]).kinds.stopAll!.face(0, "", 80)).toBe(golden("stopAllFace-none"));
	});

	it("urgent, waiting, running and status", () => {
		const { kinds } = setup([{ key: "a", deck: "approval" }, { key: "q", deck: "question" }, { key: "r", deck: "running" }, { key: "d", deck: "done" }]);
		expect(kinds.urgent!.face(0, "", 80)).toBe(golden("urgentFace-two-waiting"));
		expect(kinds.waiting!.face(0, "", 80)).toBe(golden("waitingFace-some"));
		expect(kinds.running!.face(0, "", 80)).toBe(golden("runningFace-some"));
		expect(kinds.status!.face(0, "", 80)).toBe(golden("statusFace-waiting"));
	});

	it("access, continue, prompt, send and settings", () => {
		const { kinds } = setup([{ key: "a", deck: "approval" }], { selected: "a" });
		expect(kinds.access!.face(0, "", 80)).toBe(golden("modeFace-auto"));
		expect(kinds.continue!.face(0, "", 80)).toBe(golden("continueFace-open"));
		expect(kinds.prompt!.face(0, "fix", 80)).toBe(golden("promptFace-fix"));
		expect(kinds.send!.face(0, "hi", 80)).toBe(golden("customPromptFace-text"));
		expect(kinds.send!.face(0, " ", 80)).toBe(golden("customPromptFace-empty"));
		expect(kinds.settings!.face(0, "", 80)).toBe(golden("settingsFace"));
		expect(setup([]).kinds.access!.face(0, "", 80)).toBe(golden("modeFace-none"));
	});

	it("effort and limits when there is nothing to show", () => {
		const { kinds } = setup([]);
		expect(kinds.effort!.face(0, "", 80)).toBe(effortFace(undefined));
		expect(kinds.effort!.face(0, "", 80)).toBe(golden("effortFace-none"));
		expect(kinds.limits!.face(0, "", 80)).toBe(limitsFace(undefined, false));
		expect(kinds.limit!.face(0, "1", 80)).toBe(golden("limitsFace-unavailable"));
	});

	it("model slots draw the picker's model, and mark the thread's own", () => {
		const { kinds } = setup([{ key: "a" }], { selected: "a" });
		expect(kinds.model!.label!(0, "1")).toBe("Claude · Opus");
		expect(kinds.model!.face(0, "2", 80)).not.toBe(kinds.model!.face(0, "1", 80));
		expect(kinds.model!.face(0, "9", 80)).toBe(golden("modelFace-none"));
	});
});

describe("sidecarKinds by size", () => {
	// A fixed clock, so thread tiles' elapsed times stay put.
	beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z")));
	afterEach(() => void vi.useRealTimers());

	// The actions Logitech had before shared keys; shared.test.ts covers the ones added with them.
	const EXISTING = ["urgent", "waiting", "running", "status", "continue", "settings", "stopAll", "stop", "access", "effort", "model", "prompt", "send", "limit", "limits"];
	const world = () => setup([{ key: "a", deck: "approval" }, { key: "q", deck: "question" }, { key: "r", deck: "running" }, { key: "s", deck: "running" }, { key: "t", deck: "running" }], { selected: "a" });

	it("draw the Ring's glyph at 80 px or less", () => {
		const { kinds } = world();
		expect(Object.keys(kinds)).toEqual(expect.arrayContaining(EXISTING));
		for (const name of EXISTING) for (const parameter of ["", "1", "fix"]) expect(kinds[name]!.face(0, parameter, 60), `${name}:${parameter}`).toBe(kinds[name]!.face(0, parameter, 80));
	});

	it("draw the full tile on a keypad, the Logitech-only actions as their nearest Stream Deck key", async () => {
		const { kinds } = world();
		// Recorded with the shared definitions' own tile tests: Continue on a thread waiting on you, Status counting it all, Stop all over three runs.
		expect(kinds.continue!.face(0, "", 116)).toBe(keypad("continue-open"));
		expect(kinds.status!.face(0, "", 116)).toBe(keypad("status-waiting"));
		expect(kinds.stopAll!.face(0, "", 116)).toBe(keypad("stopAll-three"));
		expect(kinds.settings!.face(0, "", 116)).toBe(keypad("settings"));
		const recorded: [string, string, string][] = [
			["urgent", "", "urgent"],
			["waiting", "", "waiting"],
			["running", "", "running"],
			["stop", "", "stop"],
			["access", "", "access"],
			["effort", "", "effort"],
			["model", "1", "model-1"],
			["model", "2", "model-2"],
			["prompt", "fix", "prompt-fix"],
			["send", "hi", "send"],
			["limit", "1", "limit-1"],
			["limits", "", "limits"],
		];
		for (const [kind, parameter, name] of recorded) await expect(kinds[kind]!.face(0, parameter, 116)).toMatchFileSnapshot(`./__goldens__/keypad-${name}-116.svg`);
	});

	it("keep a keypad tile still: Logitech draws no animation frames", () => {
		const { kinds } = world();
		for (const name of [...EXISTING, "thread", "activity"]) {
			for (const parameter of ["", "1", "fix"]) {
				const before = kinds[name]!.face(0, parameter, 116);
				vi.advanceTimersByTime(250);
				expect(kinds[name]!.face(0, parameter, 116), `${name}:${parameter}`).toBe(before);
			}
		}
	});
});
