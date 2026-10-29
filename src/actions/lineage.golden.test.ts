import { describe, it, vi } from "vitest";

import type { DeckThread } from "../core/board.js";
import { ForkKey, MergeBackKey, Stop, StopWorkflowKey } from "./lineage.js";
import { type GoldenOptions, recordFace, recordPress } from "./testing/harness.js";
import { machine, RUNNING, scene, STATES, thread } from "./testing/fixtures.js";

vi.mock("@elgato/streamdeck", async () => await import("./testing/streamdeck.js"));
vi.mock("node:child_process", async () => await import("./testing/process.js"));
vi.mock("../deck.js", async () => await import("./testing/deck.js"));

// Recorded from today's keys so the shared-keys refactor can prove no Stream Deck key changed. Never update these to make
// a refactor pass: a changed golden is a bug.

type Setup = [name: string, make: () => GoldenOptions, settings?: Record<string, unknown>, held?: number | number[]];

const faces = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings] of setups) it(`${key} face: ${name}`, () => recordFace(`${key}-${name}`, Class, { ...make(), settings }));
};
const presses = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings, held] of setups) it(`${key} press: ${name}`, () => recordPress(`${key}-press-${name}`, Class, { ...make(), settings }, held ?? 0));
};

const connection: Setup[] = [
	["none", STATES.none],
	["offline", STATES.offline],
	["no-thread", STATES["no-thread"]],
	["read-only", STATES["read-only"]],
];

const claude = (overrides: Partial<DeckThread> = {}, extra: Parameters<typeof machine>[0] = {}) => scene({ model: { instanceId: "claudeAgent", model: "opus" }, ...overrides }, extra);
const PIN = { target: "thread", thread: "env/pinned-one", threadTitle: "Pinned one" };
const GONE = { target: "thread", thread: "env/gone", threadTitle: "Old thread" };
const pinned = (): GoldenOptions => {
	const base = scene({ threadId: "pinned-one", title: "Pinned one", ...RUNNING });
	return { threads: [...base.threads!, thread({ threadId: "other-one", machine: base.threads![0]!.machine })], selected: undefined };
};

describe("Stop goldens", () => {
	faces("stop", Stop, [
		...connection,
		["idle", STATES.idle],
		["running", STATES.running],
		["pinned", pinned, PIN],
		["pinned-gone", pinned, GONE],
	]);
	presses("stop", Stop, [
		["running", () => scene({ threadId: "stop-1", ...RUNNING })],
		["running-then-continue", () => scene({ threadId: "stop-1", ...RUNNING }), undefined, [0, 0]],
		["idle", () => scene({ threadId: "stop-1" })],
		["no-thread", STATES["no-thread"]],
		["read-only", () => scene({ ...RUNNING }, { canOperate: false })],
		["offline", STATES.offline],
		["failure", () => scene({ threadId: "stop-1", ...RUNNING }, { stopRun: vi.fn(async () => Promise.reject(new Error("boom"))) })],
	]);

	const workflow = { mode: "workflow" };
	faces("stop-workflow", Stop, [
		["not-claude", STATES.idle, workflow],
		["idle", () => claude(), workflow],
		["running", () => claude(RUNNING), workflow],
		["subagents", () => claude({ subagents: 2 }), workflow],
		["subagent", () => claude({ subagents: 1 }), workflow],
		["no-thread", STATES["no-thread"], workflow],
		["offline", STATES.offline, workflow],
		["read-only", () => claude({ ...RUNNING }, { canOperate: false }), workflow],
		["pinned", pinned, { ...PIN, ...workflow }],
	]);
	faces("stop-legacy-workflow", StopWorkflowKey, [["running", () => claude(RUNNING)]]);
	const running = (extra: Parameters<typeof machine>[0] = {}) => scene({ threadId: "wf-1", model: { instanceId: "claudeAgent", model: "opus" }, ...RUNNING }, extra);
	presses("stop-workflow", Stop, [
		["held", () => running({ workflows: vi.fn(async () => [{ id: "wf-a", name: "Review" }, { id: "wf-b", name: undefined }]) }), workflow, 600],
		["tap", () => running({ workflows: vi.fn(async () => [{ id: "wf-a", name: "Review" }]) }), workflow],
		["held-none", () => running(), workflow, 600],
		["not-claude", () => scene({ ...RUNNING }), workflow, 600],
		["no-thread", STATES["no-thread"], workflow, 600],
		["offline", STATES.offline, workflow, 600],
	]);
	presses("stop-legacy-workflow", StopWorkflowKey, [["held", () => running({ workflows: vi.fn(async () => [{ id: "wf-a" }]) }), undefined, 600]]);
});

const fork = (overrides: Partial<DeckThread> = {}, extra: Parameters<typeof machine>[0] = {}) => scene({ mergeInto: "parent", ...overrides }, { threadRow: () => ({ title: "Parent thread" }), ...extra });

describe("Fork goldens", () => {
	faces("fork", ForkKey, [
		...connection,
		["idle", STATES.idle],
		["running", STATES.running],
		["no-turn", () => scene({ latestRunId: null })],
		["pinned", () => ({ ...pinned(), selected: undefined }), PIN],
		["pinned-gone", pinned, GONE],
	]);
	presses("fork", ForkKey, [
		["tap", () => scene({ threadId: "fork-src" })],
		["no-turn", () => scene({ threadId: "fork-src", latestRunId: null })],
		["no-thread", STATES["no-thread"]],
		["read-only", STATES["read-only"]],
		["offline", STATES.offline],
		["failure", () => scene({ threadId: "fork-src" }, { fork: vi.fn(async () => Promise.reject(new Error("boom"))) })],
	]);

	const merge = { mode: "merge" };
	faces("merge", ForkKey, [
		["not-a-fork", STATES.idle, merge],
		["fork", () => fork(), merge],
		["fork-parent-gone", () => scene({ mergeInto: "parent" }), merge],
		["no-turn", () => fork({ latestRunId: null }), merge],
		["running", () => fork(RUNNING), merge],
		["no-thread", STATES["no-thread"], merge],
		["offline", STATES.offline, merge],
		["read-only", () => fork({}, { canOperate: false }), merge],
	]);
	faces("merge-legacy", MergeBackKey, [["fork", () => fork()]]);
	presses("merge", ForkKey, [
		["tap", () => fork({ threadId: "merge-1" }), merge],
		["held", () => fork({ threadId: "merge-1" }), merge, 600],
		["held-running", () => fork({ threadId: "merge-1", ...RUNNING }), merge, 600],
		["held-not-a-fork", () => scene({ threadId: "merge-1" }), merge, 600],
		["held-failure", () => fork({ threadId: "merge-1" }, { mergeBack: vi.fn(async () => Promise.reject(new Error("boom"))) }), merge, 600],
		["no-thread", STATES["no-thread"], merge, 600],
	]);
	presses("merge-legacy", MergeBackKey, [["held", () => fork({ threadId: "merge-1" }), undefined, 600]]);
});
