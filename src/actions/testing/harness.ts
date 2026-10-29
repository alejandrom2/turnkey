import { expect, vi } from "vitest";

import type { DeckThread } from "../../core/board.js";
import type { Machine } from "../../core/t3/machine.js";
import { FakeAction } from "./action.js";
import { resetListeners, world } from "./deck.js";

type Instance = {
	actions: Set<FakeAction>;
	onWillAppear(ev: unknown): unknown;
	onKeyDown(ev: unknown): unknown;
	onKeyUp(ev: unknown): unknown;
};

export type GoldenOptions = {
	settings?: Record<string, unknown>;
	threads?: DeckThread[];
	/** The thread T3 Code has selected, if any. */
	selected?: DeckThread;
	/** Machines connected; by default those of `threads`, or one when there are none. */
	machines?: Machine[];
	/** The Motion setting; off by default, so faces hold still. */
	motion?: "full" | "reduced" | "off";
	/** Presses the key, held this many ms (0 is a tap); leave out to only draw the face. A list presses it again after each, a second apart. */
	held?: number | number[];
};

export type Golden = {
	/** The face after the key appears and any request has loaded. */
	image: string;
	/** One line per observed effect of the press: machine calls, alerts, images the press drew. Empty without `held`. */
	calls: string[];
};

// A thread argument reads as its title, so records do not depend on ids and machine URLs.
const json = (value: unknown) =>
	JSON.stringify(value, (_key, item: unknown) => {
		if (typeof item === "function") return "[function]";
		const candidate = item as { threadId?: unknown; machine?: unknown; title?: unknown } | null;
		return candidate !== null && typeof candidate === "object" && "threadId" in candidate && "machine" in candidate ? `thread ${String(candidate.title)}` : item;
	});

/**
 * Drives a real Stream Deck action class against fake deck state: shows one key, then optionally presses it.
 * Each call uses fresh timers and a fresh instance, so goldens do not depend on each other.
 */
export async function goldenKey(Class: new () => object, options: GoldenOptions = {}): Promise<Golden> {
	const { settings = {}, threads = [], selected, held, motion = "off", machines = [...new Set(threads.map((candidate) => candidate.machine))] } = options;
	world.threads = threads;
	world.selected = selected;
	world.machines = machines;
	world.selects = [];
	world.spawned = [];
	world.motion = motion;
	resetListeners();
	vi.useFakeTimers();
	// Elapsed times and countdowns on faces read the clock.
	vi.setSystemTime(new Date("2026-06-01T12:00:00.250Z"));
	try {
		const instance = new Class() as Instance;
		const action = new FakeAction();
		instance.actions.add(action);
		instance.onWillAppear({ action, payload: { settings } });
		await vi.advanceTimersByTimeAsync(0);
		const image = action.images.at(-1) ?? "";
		const calls: string[] = [];
		if (held !== undefined) {
			action.writes.length = 0;
			const presses = typeof held === "number" ? [held] : held;
			for (const [index, ms] of presses.entries()) {
				if (typeof held !== "number") action.writes.push(`-- press ${index + 1} --`);
				if (index > 0) await vi.advanceTimersByTimeAsync(1000);
				instance.onKeyDown({ action, payload: { settings } });
				await vi.advanceTimersByTimeAsync(ms);
				await instance.onKeyUp({ action, payload: { settings } });
				await vi.advanceTimersByTimeAsync(0);
			}
			for (const machine of world.machines) {
				for (const [name, value] of Object.entries(machine)) {
					const spy = value as { mock?: { calls: unknown[][] } } | undefined;
					if (name !== "pendingRequest") for (const args of spy?.mock?.calls ?? []) calls.push(`${name}(${args.map(json).join(", ")})`);
				}
			}
			calls.push(...action.writes);
			calls.push(...world.spawned);
			if (world.selects.length > 0) calls.push(`select ${json(world.selects)}`);
		}
		// Releases the watches the key opened, so they do not carry into the next golden.
		await (instance as unknown as { onWillDisappear(ev: unknown): unknown }).onWillDisappear({ action });
		instance.actions.clear();
		return { image, calls };
	} finally {
		vi.clearAllTimers();
		vi.useRealTimers();
	}
}

const written = new Set<string>();
const file = (name: string, value: string, ext: "svg" | "txt") => {
	// Two tests writing one file would pass each other's goldens only by luck.
	if (written.has(`${name}.${ext}`)) throw new Error(`Golden ${name}.${ext} is recorded twice.`);
	written.add(`${name}.${ext}`);
	return check(name, value, ext);
};
const check = (name: string, value: string, ext: "svg" | "txt") => expect(value).toMatchFileSnapshot(`./__goldens__/${name}.${ext}`);

/** Records the key's face as `__goldens__/<name>.svg`. */
export async function recordFace(name: string, Class: new () => object, options: GoldenOptions = {}): Promise<void> {
	await file(name, (await goldenKey(Class, { ...options, held: undefined })).image, "svg");
}

/** Records what pressing the key (held `held` ms) does as `__goldens__/<name>.txt`. */
export async function recordPress(name: string, Class: new () => object, options: GoldenOptions = {}, held: number | number[] = 0): Promise<void> {
	await file(name, (await goldenKey(Class, { ...options, held })).calls.join("\n") + "\n", "txt");
}
