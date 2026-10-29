import { describe, it, vi } from "vitest";

import type { DeckThread } from "../core/board.js";
import {
	Activity,
	Branch,
	EffortKey,
	Health,
	ModelKey,
	NewThread,
	Organize,
	Permissions,
	PlanKey,
	QuickPrompt,
	SendPrompt,
	SpeedKey,
	Steer,
	ThreadSlot,
} from "./keys.js";
import { type GoldenOptions, recordFace, recordPress } from "./testing/harness.js";
import { machine, modelConfig, NOW, offline, RUNNING, scene, STATES, thread, uniqueUrl } from "./testing/fixtures.js";

vi.mock("@elgato/streamdeck", async () => await import("./testing/streamdeck.js"));
vi.mock("node:child_process", async () => await import("./testing/process.js"));
vi.mock("../deck.js", async () => await import("./testing/deck.js"));
vi.mock("../core/review.js", async (original) => (await import("./testing/review.js")).withLiveClock(await original<typeof import("../core/review.js")>()));

// Recorded from today's keys so the shared-keys refactor can prove no Stream Deck key changed. Never update these to make
// a refactor pass: a changed golden is a bug.

type Make = () => GoldenOptions;
type Setup = [name: string, make: Make, settings?: Record<string, unknown>];

/** A face per setup, `<key>-<name>.svg`. */
const faces = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings] of setups) it(`${key} face: ${name}`, () => recordFace(`${key}-${name}`, Class, { ...make(), settings }));
};

/** A press per setup, `<key>-press-<name>.txt`: `held` ms, or a list of presses. */
const presses = (key: string, Class: new () => object, setups: (Setup | [...Setup, held: number | number[]])[]) => {
	for (const setup of setups) {
		const [name, make, settings, held] = setup as [string, Make, Record<string, unknown> | undefined, (number | number[])?];
		it(`${key} press: ${name}`, () => recordPress(`${key}-press-${name}`, Class, { ...make(), settings }, held ?? 0));
	}
};

/** Faces that move under Motion: Full, at the harness clock. */
describe("Motion goldens", () => {
	it("thread running, full motion", () => recordFace("thread-running-full", ThreadSlot, { ...scene(RUNNING), motion: "full" }));
	it("thread approval, full motion", () => recordFace("thread-approval-full", ThreadSlot, { ...STATES.approval(), motion: "full" }));
	it("thread running, reduced motion", () => recordFace("thread-running-reduced", ThreadSlot, { ...scene(RUNNING), motion: "reduced" }));
	it("effort high, full motion", () =>
		recordFace("effort-high-full", EffortKey, { ...scene({ model: { instanceId: "codex", model: "gpt-5", options: [{ id: "reasoningEffort", value: "high" }] } }), motion: "full" }));
});

const connection: Setup[] = [
	["none", STATES.none],
	["offline", STATES.offline],
	["no-thread", STATES["no-thread"]],
	["read-only", STATES["read-only"]],
];

const aboutThread = (id: string, overrides: Partial<DeckThread> = {}) => scene({ threadId: id, ...overrides });

/** A scene where the selected thread is not the one the settings pin. */
const pinnedScene = (overrides: Partial<DeckThread> = {}): GoldenOptions => {
	const base = scene({ threadId: "pinned-one", title: "Pinned one", ...overrides });
	const other = thread({ threadId: "other-one", title: "Other one", machine: base.threads![0]!.machine });
	return { threads: [...base.threads!, other], selected: other };
};
const PIN = { target: "thread", thread: "env/pinned-one", threadTitle: "Pinned one" };
const GONE = { target: "thread", thread: "env/gone", threadTitle: "Old thread" };

describe("Thread goldens", () => {
	faces("thread", ThreadSlot, [
		["none", STATES.none],
		["offline", STATES.offline],
		["empty", STATES["no-thread"]],
		["idle", () => aboutThread("idle")],
		["unselected", () => ({ ...pinnedScene(), selected: undefined })],
		["running", () => scene(RUNNING)],
		["approval", STATES.approval],
		["question", STATES.question],
		["done-unseen", () => scene({ deck: "done", unseen: true })],
		["failed", () => scene({ deck: "failed" })],
		["worktree", () => scene({ worktreePath: "/work/tree" })],
		["subagents", () => scene({ ...RUNNING, subagents: 2 })],
		["selected-slot", () => scene(), { slot: "selected" }],
	]);
	presses("thread", ThreadSlot, [
		["tap", () => scene({ threadId: "open-me" })],
		["hold", () => scene({ threadId: "open-me" }), undefined, 600],
		["no-thread", STATES["no-thread"]],
		["offline", STATES.offline],
	]);
});

describe("Activity goldens", () => {
	faces("activity", Activity, [
		["none", STATES.none],
		["offline", STATES.offline],
		["quiet", STATES["no-thread"]],
		["idle", STATES.idle],
		["running", STATES.running],
		["approval", STATES.approval],
		["question", STATES.question],
		["filter-attention", () => scene(), { filter: "attention" }],
		["filter-active", () => scene(RUNNING), { filter: "active" }],
		["filter-unread", () => scene({ deck: "done", unseen: true }), { filter: "unread" }],
		["project-other", () => scene(), { project: "elsewhere" }],
	]);
	presses("activity", Activity, [
		["tap", () => scene({ threadId: "open-me", ...RUNNING })],
		["none-to-open", STATES["no-thread"]],
		["offline", STATES.offline],
	]);
});

const prompt = { prompt: "Ship it", title: "Ship" };

describe("Send Prompt goldens", () => {
	faces("send", SendPrompt, [
		...connection,
		["idle", STATES.idle, prompt],
		["running", STATES.running, prompt],
		["no-prompt", STATES.idle, {}],
		["untitled", STATES.idle, { prompt: "Ship it" }],
		["pinned", () => pinnedScene(), { ...PIN, ...prompt }],
		["pinned-gone", () => pinnedScene(), { ...GONE, ...prompt }],
		...(["continue", "test", "fix", "explain", "commit"] as const).map((template): Setup => [`template-${template}`, STATES.idle, { template }]),
	]);
	faces("quick", QuickPrompt, [["idle", STATES.idle]]);
	presses("send", SendPrompt, [
		["tap", () => scene({ threadId: "send-1" }), prompt],
		["held", () => scene({ threadId: "send-1" }), prompt, 600],
		["running", () => scene({ threadId: "send-1", ...RUNNING }), prompt],
		["template", () => scene({ threadId: "send-1" }), { template: "test" }],
		["no-prompt", STATES.idle, {}],
		["no-thread", STATES["no-thread"], prompt],
		["read-only", STATES["read-only"], prompt],
		["offline", STATES.offline, prompt],
		["review", () => scene({ threadId: "send-1" }), { ...prompt, confirmSend: "review" }],
		["review-confirmed", () => scene({ threadId: "send-1" }), { ...prompt, confirmSend: "review" }, [0, 0]],
		["hold-confirm-tap", () => scene({ threadId: "send-1" }), { ...prompt, confirmSend: "hold" }],
		["hold-confirm-held", () => scene({ threadId: "send-1" }), { ...prompt, confirmSend: "hold" }, 600],
	]);
	presses("quick", QuickPrompt, [["tap", () => scene({ threadId: "send-1" })]]);
});

describe("Steer goldens", () => {
	faces("steer", Steer, [
		...connection,
		["idle", STATES.idle, prompt],
		["running", STATES.running, prompt],
		["no-prompt", STATES.running, {}],
	]);
	presses("steer", Steer, [
		["running", () => scene({ threadId: "steer-1", ...RUNNING }), prompt],
		["held", () => scene({ threadId: "steer-1", ...RUNNING }), prompt, 600],
		["idle", () => scene({ threadId: "steer-1" }), prompt],
		["review", () => scene({ threadId: "steer-1", ...RUNNING }), { ...prompt, confirmSend: "review" }],
		["hold-confirm-tap", () => scene({ threadId: "steer-1", ...RUNNING }), { ...prompt, confirmSend: "hold" }],
	]);
});

const withProject = (overrides: Parameters<typeof machine>[0] = {}) => ({ projects: [{ id: "project", title: "Project" }, { id: "other", title: "Other" }], ...overrides });

describe("New Thread goldens", () => {
	faces("new", NewThread, [
		["none", STATES.none],
		["offline", STATES.offline],
		["empty", () => ({ machines: [machine({ url: uniqueUrl() })] })],
		["near", STATES.idle],
		["read-only", STATES["read-only"]],
		["titled", STATES.idle, { title: "Scratchpad" }],
		["scratch", STATES.idle, { destination: "scratch" }],
		["project-unset", STATES.idle, { destination: "project" }],
		["project-missing", STATES.idle, { destination: "project", project: "nowhere" }],
		["project", () => scene({}, withProject()), { destination: "project", project: "other" }],
		["worktree", () => scene({}, withProject()), { startIn: "worktree", prompt: "Build it" }],
		["worktree-no-prompt", () => scene({}, withProject()), { startIn: "worktree" }],
		["worktree-scratch", STATES.idle, { startIn: "worktree", destination: "scratch", prompt: "Build it" }],
	]);
	presses("new", NewThread, [
		["empty-thread", () => scene({}, withProject())],
		["prompt", () => scene({}, withProject()), { prompt: "Build it", title: "Build" }],
		["scratch", () => scene({}, withProject()), { destination: "scratch", prompt: "Build it" }],
		["project", () => scene({}, withProject()), { destination: "project", project: "other", prompt: "Build it" }],
		["worktree", () => scene({}, withProject()), { startIn: "worktree", prompt: "Build it" }],
		["worktree-no-prompt", () => scene({}, withProject()), { startIn: "worktree" }],
		["no-near", () => ({ machines: [machine({ url: uniqueUrl() })] }), { prompt: "Build it" }],
		["read-only", STATES["read-only"], { prompt: "Build it" }],
		["offline", STATES.offline, { prompt: "Build it" }],
		["failure", () => scene({}, withProject({ launch: vi.fn(async () => Promise.reject(new Error("boom"))) })), { prompt: "Build it" }],
	]);
});

const asleep = (): GoldenOptions => {
	const sleeper = thread({ threadId: "asleep", title: "Sleeping thread" });
	return { threads: [], machines: [machine({ url: uniqueUrl(), everyRow: [{ ...sleeper, snoozedAt: NOW - 60_000 }] })] };
};

describe("Organize goldens", () => {
	const actions = ["settle", "pin", "unpin", "snooze", "archive", "mark_unread", "wake"] as const;
	faces("organize", Organize, [
		...actions.map((organize): Setup => [organize, organize === "wake" ? asleep : STATES.idle, { organize }]),
		["pin-pinned", () => scene({ pinned: true }), { organize: "pin" }],
		["unpin-unpinned", STATES.idle, { organize: "unpin" }],
		["snooze-30m", STATES.idle, { organize: "snooze", snoozeMinutes: 30 }],
		["snooze-1d", STATES.idle, { organize: "snooze", snoozeMinutes: 1440 }],
		["wake-nothing", () => ({ machines: [machine({ url: uniqueUrl() })] }), { organize: "wake" }],
		["none", STATES.none],
		["offline", STATES.offline],
		["no-thread", STATES["no-thread"]],
		["read-only", STATES["read-only"]],
		["targeted", () => pinnedScene(), { ...PIN, organize: "archive" }],
		["targeted-gone", () => pinnedScene(), { ...GONE, organize: "archive" }],
	]);
	const idle = (name: string, organize: string, extra: Record<string, unknown> = {}): Setup => [name, () => scene({ threadId: "organize-1" }), { organize, ...extra }];
	presses("organize", Organize, [
		[...idle("settle-review-first", "settle"), 0],
		[...idle("settle-review-confirmed", "settle", { confirm: "review" }), [0, 0]],
		[...idle("settle-off", "settle", { confirm: "off" }), 0],
		[...idle("settle-hold-tap", "settle", { confirm: "hold" }), 0],
		[...idle("settle-hold-held", "settle", { confirm: "hold" }), 600],
		[...idle("snooze-off", "snooze", { confirm: "off", snoozeMinutes: 30 }), 0],
		[...idle("snooze-review-confirmed", "snooze", { snoozeMinutes: 30 }), [0, 0]],
		[...idle("pin", "pin"), 0],
		["unpin", () => scene({ threadId: "organize-1", pinned: true }), { organize: "pin" }, 0],
		[...idle("archive", "archive"), 0],
		[...idle("mark-unread", "mark_unread"), 0],
		["wake", asleep, { organize: "wake" }, 0],
		["wake-nothing", () => ({ machines: [machine({ url: uniqueUrl() })] }), { organize: "wake" }, 0],
		["no-thread", STATES["no-thread"], { organize: "archive" }, 0],
		["read-only", STATES["read-only"], { organize: "archive" }, 0],
		["offline", STATES.offline, { organize: "archive" }, 0],
	]);
});

const fastThread = (extra: Partial<DeckThread> = {}) => scene({ model: { instanceId: "codex", model: "gpt-5", options: [{ id: "serviceTier", value: "fast" }] }, ...extra });
const claude = (extra: Partial<DeckThread> = {}) => scene({ model: { instanceId: "claudeAgent", model: "opus" }, ...extra });

describe("Model goldens", () => {
	faces("model", ModelKey, [
		...connection,
		["cycle", STATES.idle],
		["cycle-claude", () => claude()],
		["fixed", STATES.idle, { model: "codex:gpt-5-mini" }],
		["fixed-current", STATES.idle, { model: "codex:gpt-5" }],
		["fixed-missing", STATES.idle, { model: "codex:nope" }],
		["white-name", STATES.idle, { nameColor: "white" }],
		["unknown-model", () => scene({ model: { instanceId: "codex", model: "gone" } })],
		["no-config", () => scene({}, { modelConfig: undefined })],
		["pinned", () => pinnedScene(), PIN],
		["pinned-gone", () => pinnedScene(), GONE],
	]);
	presses("model", ModelKey, [
		["cycle", () => scene({ threadId: "model-1" })],
		["fixed", () => scene({ threadId: "model-1" }), { model: "codex:gpt-5-mini" }],
		["fixed-current", () => scene({ threadId: "model-1" }), { model: "codex:gpt-5" }],
		["fixed-other-provider", () => scene({ threadId: "model-1" }), { model: "claudeAgent:opus" }],
		["fixed-missing", () => scene({ threadId: "model-1" }), { model: "codex:nope" }],
		["no-thread", STATES["no-thread"]],
		["read-only", STATES["read-only"]],
		["offline", STATES.offline],
	]);
});

describe("Effort goldens", () => {
	faces("effort", EffortKey, [
		...connection,
		["cycle", STATES.idle],
		["low", () => scene({ model: { instanceId: "codex", model: "gpt-5", options: [{ id: "reasoningEffort", value: "low" }] } })],
		["high", () => scene({ model: { instanceId: "codex", model: "gpt-5", options: [{ id: "reasoningEffort", value: "high" }] } })],
		["fixed", STATES.idle, { effort: "high" }],
		["fixed-current", STATES.idle, { effort: "medium" }],
		["fixed-not-offered", STATES.idle, { effort: "xhigh" }],
		["no-effort", () => scene({ model: { instanceId: "codex", model: "gpt-5-mini" } })],
		["claude", () => claude()],
		["pinned", () => pinnedScene(), PIN],
	]);
	presses("effort", EffortKey, [
		["cycle", () => scene({ threadId: "effort-1" })],
		["fixed", () => scene({ threadId: "effort-1" }), { effort: "high" }],
		["fixed-current", () => scene({ threadId: "effort-1" }), { effort: "medium" }],
		["fixed-not-offered", () => scene({ threadId: "effort-1" }), { effort: "xhigh" }],
		["no-effort", () => scene({ threadId: "effort-1", model: { instanceId: "codex", model: "gpt-5-mini" } })],
		["no-thread", STATES["no-thread"]],
		["read-only", STATES["read-only"]],
	]);
});

describe("Speed goldens", () => {
	faces("speed", SpeedKey, [
		...connection,
		["standard", STATES.idle],
		["fast", () => fastThread()],
		["claude-standard", () => claude()],
		["claude-fast", () => claude({ model: { instanceId: "claudeAgent", model: "opus", options: [{ id: "fastMode", value: true }] } })],
		["no-fast", () => scene({ model: { instanceId: "codex", model: "gpt-5-mini" } })],
		["pinned", () => pinnedScene(), PIN],
	]);
	presses("speed", SpeedKey, [
		["to-fast", () => scene({ threadId: "speed-1" })],
		["to-standard", () => fastThread({ threadId: "speed-1" })],
		["claude", () => claude({ threadId: "speed-1" })],
		["no-fast", () => scene({ threadId: "speed-1", model: { instanceId: "codex", model: "gpt-5-mini" } })],
		["no-thread", STATES["no-thread"]],
		["read-only", STATES["read-only"]],
	]);
});

describe("Permissions goldens", () => {
	faces("permissions", Permissions, [
		...connection,
		["supervised", STATES.idle],
		["auto-accept", () => scene({ runtimeMode: "auto-accept-edits" })],
		["auto", () => scene({ runtimeMode: "auto" })],
		["full", () => scene({ runtimeMode: "full-access" })],
		["claude", () => claude()],
		["claude-full", () => claude({ runtimeMode: "full-access" })],
		["fixed", STATES.idle, { mode: "full-access" }],
		["fixed-current", () => scene({ runtimeMode: "full-access" }), { mode: "full-access" }],
		["fixed-not-offered", () => claude(), { mode: "auto" }],
		["pinned", () => pinnedScene(), PIN],
	]);
	presses("permissions", Permissions, [
		["cycle", () => scene({ threadId: "mode-1" })],
		["cycle-claude", () => claude({ threadId: "mode-1" })],
		["fixed", () => scene({ threadId: "mode-1" }), { mode: "full-access" }],
		["fixed-current", () => scene({ threadId: "mode-1", runtimeMode: "full-access" }), { mode: "full-access" }],
		["fixed-not-offered", () => claude({ threadId: "mode-1" }), { mode: "auto" }],
		["no-thread", STATES["no-thread"]],
		["read-only", STATES["read-only"]],
	]);
});

describe("Plan goldens", () => {
	faces("plan", PlanKey, [
		...connection,
		["build", STATES.idle],
		["plan", () => scene({ interactionMode: "plan" })],
		["unsupported", () => scene({}, { modelConfig: modelConfig({ codexPlanToggle: false }) })],
		["pinned", () => pinnedScene(), PIN],
	]);
	presses("plan", PlanKey, [
		["to-plan", () => scene({ threadId: "plan-1" })],
		["to-build", () => scene({ threadId: "plan-1", interactionMode: "plan" })],
		["unsupported", () => scene({ threadId: "plan-1" }, { modelConfig: modelConfig({ codexPlanToggle: false }) })],
		["no-thread", STATES["no-thread"]],
		["read-only", STATES["read-only"]],
	]);
});

const status = (overrides: Record<string, unknown> = {}) => ({
	isRepo: true,
	hasPrimaryRemote: true,
	isDefaultRef: false,
	refName: "feat/x",
	hasWorkingTreeChanges: true,
	workingTree: { files: [{}, {}], insertions: 4, deletions: 1 },
	hasUpstream: true,
	aheadCount: 1,
	behindCount: 0,
	pr: null,
	...overrides,
});

describe("Branch goldens", () => {
	faces("branch", Branch, [
		["none", STATES.none],
		["offline", STATES.offline],
		["no-thread", STATES["no-thread"]],
		["no-branch", STATES.idle],
		["branch", () => scene({ branch: "feat/x" })],
		["worktree", () => scene({ branch: "feat/x", worktreePath: "/work/tree" })],
		["status", () => scene({ branch: "feat/x" }, { rpc: { "vcs.refreshStatus": status() } })],
		["status-clean", () => scene({ branch: "feat/x" }, { rpc: { "vcs.refreshStatus": status({ hasWorkingTreeChanges: false, workingTree: { files: [] }, aheadCount: 0 }) } })],
		["status-behind", () => scene({ branch: "feat/x" }, { rpc: { "vcs.refreshStatus": status({ behindCount: 3, aheadCount: 0 }) } })],
	]);
	presses("branch", Branch, [
		["tap", () => scene({ threadId: "branch-1", branch: "feat/x" })],
		["no-branch", STATES.idle],
		["no-thread", STATES["no-thread"]],
		["offline", STATES.offline],
	]);
});

const healthy = (overrides: Parameters<typeof machine>[0] = {}) => machine({ url: "http://studio:3773", ...overrides });
const brokenProvider = { instanceId: "codex", driver: "codex", installed: false, models: [] };

describe("Health goldens", () => {
	faces("health", Health, [
		["none", STATES.none],
		["ready", () => ({ machines: [healthy()] })],
		["read-only", () => ({ machines: [healthy({ canOperate: false, state: { kind: "ready", environmentId: "env", label: "Studio", canOperate: false } })] })],
		["connecting", () => ({ machines: [healthy({ state: { kind: "connecting" }, settled: false })] })],
		["offline", () => ({ machines: [offline()] })],
		["signed-out", () => ({ machines: [healthy({ state: { kind: "signed-out" } })] })],
		["provider-missing", () => ({ machines: [healthy({ modelConfig: { providers: [brokenProvider] } })] })],
		["two-ready", () => ({ machines: [healthy(), healthy({ url: "http://laptop:3773", state: { kind: "ready", environmentId: "env2", label: "Laptop", canOperate: true } })] })],
		["two-one-offline", () => ({ machines: [healthy(), offline()] })],
		["machine-removed", () => ({ machines: [healthy()] }), { machine: "http://gone:3773" }],
	]);
	presses("health", Health, [
		["tap", () => ({ machines: [offline()] })],
	]);
});
