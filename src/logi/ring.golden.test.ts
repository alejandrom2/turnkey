import { describe, expect, it } from "vitest";

import type { DeckThread } from "../core/board.js";
import type { CatalogModel } from "../core/models.js";
import type { RuntimeMode } from "../core/t3/shell.js";
import { continueFace, customPromptFace, effortFace, limitsFace, limitsLabel, modeFace, modelFace, promptFace, runningFace, settingsFace, statusFace, statusLabel, stopAllFace, stopFace, stopTarget, urgentFace, waitingFace } from "./ring.js";

// Recorded from today's faces so the shared-keys refactor can prove nothing visible changed. Never update these to make a
// refactor pass: a changed golden is a bug.
const golden = (name: string, value: string, ext: "svg" | "txt" = "svg") => expect(value).toMatchFileSnapshot(`./__goldens__/${name}.${ext}`);

const thread = (deck: DeckThread["deck"], unseen = false, key: string = deck) => ({ deck, unseen, key }) as DeckThread;
const decks = ["approval", "question", "running", "failed", "done", "idle"] as const;

const opus: CatalogModel = {
	key: "claudeAgent:claude-opus-4-5",
	instanceId: "claudeAgent",
	slug: "claude-opus-4-5",
	driver: "claudeAgent",
	providerName: "Claude",
	name: "Claude Opus 4.5",
	label: "Claude · Opus 4.5",
	accentColor: "#123456",
	iconUrl: undefined,
	badge: false,
	options: [],
};

describe("urgentFace goldens", () => {
	for (const deck of decks) it(`top thread ${deck}`, () => golden(`urgentFace-${deck}`, urgentFace([thread(deck)])));
	it("failed and seen", () => golden("urgentFace-failed-seen", urgentFace([thread("failed")])));
	it("failed and unseen", () => golden("urgentFace-failed-unseen", urgentFace([thread("failed", true)])));
	it("empty board", () => golden("urgentFace-empty", urgentFace([])));
	it("two waiting", () => golden("urgentFace-two-waiting", urgentFace([thread("approval"), thread("question")])));
	it("badge capped", () => golden("urgentFace-capped", urgentFace(Array.from({ length: 12 }, () => thread("approval")))));
});

describe("stopTarget goldens", () => {
	const board = [thread("approval", false, "a"), thread("running", false, "newer"), thread("running", false, "older")];
	const pick = (selected: DeckThread | undefined, threads = board) => `${stopTarget(threads, selected)?.key ?? "none"}\n`;
	it("no selection picks the newest running", () => golden("stopTarget-no-selection", pick(undefined), "txt"));
	it("a running selection is kept", () => golden("stopTarget-selected-running", pick(board[2]), "txt"));
	it("a stale running selection falls back to the newest running", () => golden("stopTarget-selected-gone", pick(thread("running", false, "gone")), "txt"));
	it("a done selection falls back to the newest running", () => golden("stopTarget-selected-done", pick(thread("done", false, "idle")), "txt"));
	it("nothing running picks none", () => golden("stopTarget-none-running", pick(undefined, [thread("done", false, "a")]), "txt"));
	it("empty board picks none", () => golden("stopTarget-empty", pick(undefined, []), "txt"));
});

describe("stopFace goldens", () => {
	it("available", () => golden("stopFace-available", stopFace(true)));
	it("nothing to stop", () => golden("stopFace-dim", stopFace(false)));
});

it("settingsFace golden", () => golden("settingsFace", settingsFace()));

describe("promptFace goldens", () => {
	for (const name of ["test", "fix", "explain", "commit"] as const) it(name, () => golden(`promptFace-${name}`, promptFace(name)));
});

describe("customPromptFace goldens", () => {
	it("with text", () => golden("customPromptFace-text", customPromptFace(true)));
	it("without text", () => golden("customPromptFace-empty", customPromptFace(false)));
});

describe("continueFace goldens", () => {
	it("open", () => golden("continueFace-open", continueFace("open")));
	it("send", () => golden("continueFace-send", continueFace("send")));
	it("nothing", () => golden("continueFace-none", continueFace(undefined)));
});

describe("stopAllFace goldens", () => {
	it("none running", () => golden("stopAllFace-none", stopAllFace(0)));
	it("three running", () => golden("stopAllFace-three", stopAllFace(3)));
});

describe("limitsFace goldens", () => {
	it("unavailable", () => golden("limitsFace-unavailable", limitsFace(undefined, false)));
	it("low", () => golden("limitsFace-low", limitsFace(40, false)));
	it("amber", () => golden("limitsFace-amber", limitsFace(80, false)));
	it("red", () => golden("limitsFace-red", limitsFace(95, false)));
	it("stale", () => golden("limitsFace-stale", limitsFace(40, true)));
	it("clamped over 100", () => golden("limitsFace-over", limitsFace(140, false)));
	it("with a provider mark", () => golden("limitsFace-provider", limitsFace(40, false, "claudeAgent")));
	it("label", () => golden("limitsLabel", `${limitsLabel("claudeAgent", "5-hour", 82.4)}\n`, "txt"));
});

describe("statusFace goldens", () => {
	it("waiting", () => golden("statusFace-waiting", statusFace({ approval: 1, question: 1, running: 3 })));
	it("running", () => golden("statusFace-running", statusFace({ approval: 0, question: 0, running: 3 })));
	it("capped", () => golden("statusFace-capped", statusFace({ approval: 12, question: 0, running: 0 })));
	it("idle", () => golden("statusFace-idle", statusFace({ approval: 0, question: 0, running: 0 })));
	it("label", () => golden("statusLabel", `${statusLabel({ approval: 1, question: 1, running: 3 })}\n`, "txt"));
	it("label idle", () => golden("statusLabel-idle", `${statusLabel({ approval: 0, question: 0, running: 0 })}\n`, "txt"));
});

describe("waitingFace and runningFace goldens", () => {
	const threads = [thread("approval"), thread("question"), thread("running"), thread("done")];
	it("waiting", () => golden("waitingFace-some", waitingFace(threads)));
	it("waiting, none", () => golden("waitingFace-none", waitingFace([])));
	it("waiting, capped", () => golden("waitingFace-capped", waitingFace(Array.from({ length: 12 }, () => thread("question")))));
	it("running", () => golden("runningFace-some", runningFace(threads)));
	it("running, none", () => golden("runningFace-none", runningFace([])));
	it("running, capped", () => golden("runningFace-capped", runningFace(Array.from({ length: 12 }, () => thread("running")))));
});

describe("modeFace goldens", () => {
	for (const mode of ["approval-required", "auto-accept-edits", "auto", "full-access"] as const satisfies RuntimeMode[]) it(mode, () => golden(`modeFace-${mode}`, modeFace(mode)));
	it("no thread", () => golden("modeFace-none", modeFace(undefined)));
});

describe("effortFace goldens", () => {
	it("no thread", () => golden("effortFace-none", effortFace(undefined)));
	it("first of three", () => golden("effortFace-1of3", effortFace({ index: 0, count: 3, color: "#648FFD" })));
	it("second of three", () => golden("effortFace-2of3", effortFace({ index: 1, count: 3, color: "#648FFD" })));
	it("top of four", () => golden("effortFace-4of4", effortFace({ index: 3, count: 4, color: "#AD7BF9" })));
});

describe("modelFace goldens", () => {
	it("no model", () => golden("modelFace-none", modelFace(undefined, false)));
	it("other model", () => golden("modelFace-other", modelFace(opus, false)));
	it("the thread's own", () => golden("modelFace-current", modelFace(opus, true)));
});
