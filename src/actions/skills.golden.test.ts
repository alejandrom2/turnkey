import { describe, it, vi } from "vitest";

import { RunSkillKey } from "./skills.js";
import { type GoldenOptions, recordFace, recordPress } from "./testing/harness.js";
import { scene, STATES } from "./testing/fixtures.js";

vi.mock("@elgato/streamdeck", async () => await import("./testing/streamdeck.js"));
vi.mock("node:child_process", async () => await import("./testing/process.js"));
vi.mock("../deck.js", async () => await import("./testing/deck.js"));
vi.mock("../core/review.js", async (original) => (await import("./testing/review.js")).withLiveClock(await original<typeof import("../core/review.js")>()));

// Recorded from today's keys so the shared-keys refactor can prove no Stream Deck key changed. Never update these to make
// a refactor pass: a changed golden is a bug.

type Setup = [name: string, make: () => GoldenOptions, settings?: Record<string, unknown>, held?: number | number[]];

const faces = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings] of setups) it(`${key} face: ${name}`, () => recordFace(`${key}-${name}`, Class, { ...make(), settings }));
};
const presses = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings, held] of setups) it(`${key} press: ${name}`, () => recordPress(`${key}-press-${name}`, Class, { ...make(), settings }, held ?? 0));
};

const REVIEW = { name: "review", displayName: "Code Review", description: "Review the diff", enabled: true };
const SIMPLIFY = { name: "simplify", enabled: true };

const skilled = (id: string, skills: unknown[] = [REVIEW, SIMPLIFY], loading = false, thread = {}, machine: Parameters<typeof scene>[1] = {}): GoldenOptions =>
	scene({ threadId: id, ...thread }, { skills: () => ({ skills, loading }), ...machine });

const PIN = { target: "thread", thread: "env/pinned-skill", threadTitle: "Pinned one" };

describe("Run Skill goldens", () => {
	faces("skill", RunSkillKey, [
		["none", STATES.none, { skill: "review" }],
		["offline", STATES.offline, { skill: "review" }],
		["no-thread", STATES["no-thread"], { skill: "review" }],
		["read-only", () => skilled("k-ro", undefined, false, {}, { canOperate: false }), { skill: "review" }],
		["pick", () => skilled("k-pick"), {}],
		["display-name", () => skilled("k-display"), { skill: "review" }],
		["plain-name", () => skilled("k-plain"), { skill: "simplify" }],
		["case-insensitive", () => skilled("k-case"), { skill: "REVIEW" }],
		["titled", () => skilled("k-titled"), { skill: "review", title: "Check" }],
		["loading", () => skilled("k-loading", [], true), { skill: "review" }],
		["none-listed", () => skilled("k-empty", []), { skill: "review" }],
		["gone", () => skilled("k-gone"), { skill: "deploy" }],
		["running", () => skilled("k-running", undefined, false, { deck: "running", active: true }), { skill: "review" }],
		["pinned", () => {
			const base = skilled("pinned-skill");
			return { ...base, selected: undefined };
		}, { ...PIN, skill: "review" }],
		["pinned-gone", () => skilled("k-pin-gone"), { target: "thread", thread: "env/gone", threadTitle: "Old thread", skill: "review" }],
	]);
	const review = { skill: "review", prompt: "the auth change" };
	presses("skill", RunSkillKey, [
		["tap", () => skilled("r-tap"), { skill: "review" }],
		["prompt", () => skilled("r-prompt"), review],
		["running", () => skilled("r-running", undefined, false, { deck: "running", active: true }), { skill: "review" }],
		["review", () => skilled("r-review"), { ...review, confirmSend: "review" }],
		["review-confirmed", () => skilled("r-review-2"), { ...review, confirmSend: "review" }, [0, 0]],
		["hold-confirm-tap", () => skilled("r-hold"), { ...review, confirmSend: "hold" }],
		["hold-confirm-held", () => skilled("r-hold-2"), { ...review, confirmSend: "hold" }, 600],
		["loading", () => skilled("r-loading", [], true), { skill: "review" }],
		["pick", () => skilled("r-pick"), {}],
		["gone", () => skilled("r-gone"), { skill: "deploy" }],
		["none-listed", () => skilled("r-empty", []), { skill: "review" }],
		["no-thread", STATES["no-thread"], { skill: "review" }],
		["read-only", () => skilled("r-ro", undefined, false, {}, { canOperate: false }), { skill: "review" }],
		["offline", STATES.offline, { skill: "review" }],
	]);
});
