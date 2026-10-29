import { vi } from "vitest";

import type { DeckThread } from "../../core/board.js";
import type { Machine } from "../../core/t3/machine.js";
import { FakeAction } from "./action.js";
import { world } from "./deck.js";

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
	/** Presses the key, held this many ms (0 is a tap); leave out to only draw the face. */
	held?: number;
};

export type Golden = {
	/** The face after the key appears and any request has loaded. */
	image: string;
	/** One line per observed effect of the press: machine calls, alerts, images the press drew. Empty without `held`. */
	calls: string[];
};

const json = (value: unknown) => JSON.stringify(value);

/**
 * Drives a real Stream Deck action class against fake deck state: shows one key, then optionally presses it.
 * Each call uses fresh timers and a fresh instance, so goldens do not depend on each other.
 */
export async function goldenKey(Class: new () => object, options: GoldenOptions = {}): Promise<Golden> {
	const { settings = {}, threads = [], selected, held, machines = [...new Set(threads.map((candidate) => candidate.machine))] } = options;
	world.threads = threads;
	world.selected = selected;
	world.machines = machines;
	world.selects = [];
	world.spawned = [];
	vi.useFakeTimers();
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
			instance.onKeyDown({ action });
			await vi.advanceTimersByTimeAsync(held);
			await instance.onKeyUp({ action });
			await vi.advanceTimersByTimeAsync(0);
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
		instance.actions.clear();
		return { image, calls };
	} finally {
		vi.clearAllTimers();
		vi.useRealTimers();
	}
}
