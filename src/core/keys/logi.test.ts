import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STATES } from "../../actions/testing/fixtures.js";
import type { GoldenOptions } from "../../actions/testing/harness.js";
import type { KeyRuntime } from "./key.js";
import { activityTile, continueTile, settingsTile, statusTile, stopAllTile } from "./logi.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");
const keypad = (name: string) => `../../logi/__goldens__/keypad-${name}-116.svg`;

// The clock the Stream Deck goldens were recorded at.
beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z")));
afterEach(() => void vi.useRealTimers());

const runtimeOf = (world: GoldenOptions) =>
	({ board: { selectedOn: () => world.selected }, motion: () => "off", transitions: { age: () => undefined }, queued: () => 0 }) as unknown as KeyRuntime;

describe("Logitech-only keypad tiles", () => {
	it("draw Activity's face for the thread a press opens", () => {
		for (const state of ["idle", "running", "approval", "question"] as const) {
			const world = STATES[state]();
			expect(decoded(activityTile(runtimeOf(world), world.selected)), state).toBe(golden(`activity-${state}`));
		}
		expect(decoded(activityTile(runtimeOf({}), undefined))).toBe(golden("activity-quiet"));
	});

	it("draw Continue as Quick Prompt's Continue", () => expect(decoded(continueTile("send"))).toBe(golden("quick-idle")));

	it("match their goldens", async () => {
		await expect(decoded(continueTile("open", "approval"))).toMatchFileSnapshot(keypad("continue-open"));
		await expect(decoded(continueTile("open", "question"))).toMatchFileSnapshot(keypad("continue-question"));
		await expect(decoded(continueTile(undefined))).toMatchFileSnapshot(keypad("continue-none"));
		await expect(decoded(stopAllTile(3))).toMatchFileSnapshot(keypad("stopAll-three"));
		await expect(decoded(stopAllTile(0))).toMatchFileSnapshot(keypad("stopAll-none"));
		await expect(decoded(statusTile({ approval: 1, question: 1, running: 3 }))).toMatchFileSnapshot(keypad("status-waiting"));
		await expect(decoded(statusTile({ approval: 0, question: 0, running: 2 }))).toMatchFileSnapshot(keypad("status-running"));
		await expect(decoded(statusTile({ approval: 0, question: 0, running: 0 }))).toMatchFileSnapshot(keypad("status-idle"));
		await expect(decoded(settingsTile())).toMatchFileSnapshot(keypad("settings"));
	});
});
