import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { DeckThread, ThreadBoard } from "../core/board.js";
import type { ModelConfig } from "../core/models.js";
import { QUICK_PROMPTS } from "../core/prompts.js";
import type { Machine } from "../core/t3/machine.js";
import { type SidecarDeps, sidecarKinds } from "./kinds.js";
import { effortFace, limitsFace } from "./ring.js";
import { logiRuntime } from "./runtime.js";

const golden = (name: string) => readFileSync(new URL(`./__goldens__/${name}.svg`, import.meta.url), "utf8");

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
	};
	const all = threads.map((each, index) => ({ deck: "idle", unseen: false, title: `Thread ${index}`, threadId: each.key, activeRunId: "run", model: { instanceId: "claudeAgent", model: "opus" }, runtimeMode: "auto", machine, ...each }) as unknown as DeckThread);
	const board = { threads: all, selectedOn: () => all.find((each) => each.key === options.selected) } as unknown as ThreadBoard;
	const deps = {
		machines: () => [machine as unknown as Machine],
		board,
		open: vi.fn<(thread: DeckThread) => void>(),
		openExternal: vi.fn(async () => undefined),
		refreshLimits: vi.fn(),
		watchConfigs: vi.fn(),
		failed: () => () => undefined,
		settingsUrl: () => "http://settings",
		runtime: logiRuntime({ machines: () => [machine as unknown as Machine], board, openThread: async () => undefined, selectThread: () => undefined, repaint: () => undefined }),
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
		expect(done.machine.send).toHaveBeenCalledExactlyOnceWith(expect.anything(), QUICK_PROMPTS.continue.text, "auto");
		const waiting = setup([{ key: "a", deck: "approval" }], { selected: "a" });
		waiting.kinds.continue!.press!(0, "");
		expect(waiting.deps.open).toHaveBeenCalledOnce();
		expect(waiting.machine.send).not.toHaveBeenCalled();
	});

	it("prompt:test sends the quick prompt's text", () => {
		const { kinds, machine } = setup([{ key: "a" }], { selected: "a" });
		kinds.prompt!.press!(0, "test");
		expect(machine.send).toHaveBeenCalledExactlyOnceWith(expect.anything(), QUICK_PROMPTS.test.text, "auto");
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
		const { kinds, machine } = setup([{ key: "a" }], { selected: "a" });
		kinds.send!.press!(0, "  hello  ");
		kinds.send!.press!(0, "   ");
		expect(machine.send).toHaveBeenCalledExactlyOnceWith(expect.anything(), "hello", "auto");
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

describe("sidecarKinds before keypad tiles", () => {
	it("draw today's face at every size, the shared keys aside", () => {
		const { kinds } = setup([{ key: "a", deck: "approval" }, { key: "r", deck: "running" }], { selected: "a" });
		for (const [name, kind] of Object.entries(kinds)) {
			if (["approve", "deny", "thread", "activity", "newThread", "speed", "plan"].includes(name)) continue;
			for (const parameter of ["", "1", "fix"]) for (const size of [60, 116, 144]) expect(kind.face(0, parameter, size), `${name}:${parameter} at ${size}`).toBe(kind.face(0, parameter, 80));
		}
	});

});
