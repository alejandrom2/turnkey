import { describe, it, vi } from "vitest";

import { RunTaskKey } from "./tasks.js";
import { type GoldenOptions, recordFace, recordPress } from "./testing/harness.js";
import { machine, NOW, STATES } from "./testing/fixtures.js";

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

const in4m = new Date(NOW + 4 * 60_000).toISOString();
const task = (overrides: Record<string, unknown> = {}) => ({ id: "nightly", title: "Nightly report", enabled: true, nextRunAt: in4m, lastRunStatus: "succeeded", ...overrides });
const tasked = (tasks: unknown[] | undefined, extra: Parameters<typeof machine>[0] = {}): GoldenOptions => ({ machines: [machine({ url: "http://studio:3773", tasks, ...extra })] });
const PICK = { task: "env/nightly", taskTitle: "Nightly report" };

describe("Run Task goldens", () => {
	faces("task", RunTaskKey, [
		["none", STATES.none, PICK],
		["offline", STATES.offline, PICK],
		["pick", () => tasked([task()]), {}],
		["loading", () => tasked(undefined), PICK],
		["scheduled", () => tasked([task()]), PICK],
		["due", () => tasked([task({ nextRunAt: new Date(NOW).toISOString() })]), PICK],
		["in-a-day", () => tasked([task({ nextRunAt: new Date(NOW + 30 * 3_600_000).toISOString() })]), PICK],
		["running", () => tasked([task({ lastRunStatus: "running" })]), PICK],
		["off", () => tasked([task({ enabled: false })]), PICK],
		["failed", () => tasked([task({ lastRunStatus: "failed" })]), PICK],
		["webhook", () => tasked([task({ nextRunAt: null, schedule: { type: "webhook" } })]), PICK],
		["not-scheduled", () => tasked([task({ nextRunAt: null })]), PICK],
		["read-only", () => tasked([task()], { canOperate: false, state: { kind: "ready", environmentId: "env", label: "Studio", canOperate: false } }), PICK],
		["gone", () => tasked([]), PICK],
		["gone-untitled", () => tasked([]), { task: "env/nightly" }],
		["update-t3", () => tasked(undefined, { tasksError: "unsupported" }), PICK],
		["picked-machine", () => tasked([task()]), { ...PICK, machine: "http://studio:3773" }],
		["other-machine", () => tasked([task()]), { ...PICK, machine: "http://elsewhere:3773" }],
		["retitled", () => tasked([task({ title: "Weekly report" })]), PICK],
	]);
	presses("task", RunTaskKey, [
		["run", () => tasked([task()]), PICK],
		["run-off", () => tasked([task({ enabled: false })]), PICK],
		["read-only", () => tasked([task()], { canOperate: false, state: { kind: "ready", environmentId: "env", label: "Studio", canOperate: false } }), PICK],
		["pick", () => tasked([task()]), {}],
		["gone", () => tasked([]), PICK],
		["loading", () => tasked(undefined), PICK],
		["update-t3", () => tasked(undefined, { tasksError: "unsupported" }), PICK],
		["failure", () => tasked([task()], { runTask: vi.fn(async () => Promise.reject(new Error("boom"))) }), PICK],
		["offline", STATES.offline, PICK],
	]);
});
