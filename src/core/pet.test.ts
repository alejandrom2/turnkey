import { describe, expect, it } from "vitest";

import { PET, Pet, petArt, type Walk } from "./pet.js";
import { SPRITE, spriteArt } from "./sprite.js";

/** A fake clock whose timers run as `advance` passes their due time. */
function clock() {
	let now = 0;
	let next = 0;
	const pending = new Map<number, { at: number; run: () => void }>();
	const timers = {
		set: (run: () => void, ms: number) => {
			pending.set(++next, { at: now + ms, run });
			return next;
		},
		clear: (handle: unknown) => void pending.delete(handle as number),
	};
	const advance = (ms: number) => {
		const until = now + ms;
		for (;;) {
			const due = [...pending].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
			if (due === undefined) break;
			pending.delete(due[0]);
			now = due[1].at;
			due[1].run();
		}
		now = until;
	};
	return { now: () => now, timers, advance, pending: () => pending.size };
}

function setup(runs: string[][] = [["a", "b", "c"]]) {
	const time = clock();
	const changed: string[][] = [];
	const hooks = { runs: () => runs, changed: (ids: readonly string[]) => void changed.push([...ids]) };
	const pet = new Pet(hooks, time.now, time.timers);
	return { pet, time, changed, runs };
}

/** How long a walk across `dials` lasts in `mode`. */
const walkMs = (dials: number, mode: "full" | "reduced") => Math.ceil((dials * PET.slice + SPRITE.width) / PET.stepPx[mode]) * PET.stepMs[mode];

describe("Pet", () => {
	it("holds no timer while off, with Motion off, or with no dials", () => {
		const off = setup();
		off.time.advance(1_000_000);
		expect([off.pet.state, off.time.pending()]).toEqual(["off", 0]);

		const still = setup();
		still.pet.configure(true, "off");
		expect([still.pet.state, still.time.pending()]).toEqual(["off", 0]);

		const empty = setup([]);
		empty.pet.configure(true, "full");
		expect([empty.pet.state, empty.time.pending()]).toEqual(["off", 0]);
	});

	it("walks the longest run after two idle minutes, entering at one end and leaving at the other", () => {
		const { pet, time, changed } = setup([["x"], ["a", "b", "c"], ["y", "z"]]);
		pet.configure(true, "full");
		time.advance(PET.idleMs - 1);
		expect(pet.walk()).toBeUndefined();
		time.advance(1);
		expect(changed).toEqual([["a", "b", "c"]]);
		expect(pet.walk()).toMatchObject({ ids: ["a", "b", "c"], facing: 1, x: -SPRITE.width, step: 0, bounce: true });
		time.advance(PET.stepMs.full - 1);
		expect(pet.walk()?.x).toBe(-SPRITE.width);
		time.advance(1);
		expect(pet.walk()?.x).toBe(-SPRITE.width + PET.stepPx.full);
		time.advance(walkMs(3, "full") - PET.stepMs.full - 1);
		expect(pet.walk()!.x).toBeGreaterThanOrEqual(3 * PET.slice - PET.stepPx.full);
		time.advance(1);
		expect(pet.walk()).toBeUndefined();
		expect([pet.state, changed.length]).toEqual(["resting", 2]);
	});

	it("rests four minutes between walks, turns around each time, and stops after three", () => {
		const { pet, time, changed } = setup();
		pet.configure(true, "full");
		time.advance(PET.idleMs + walkMs(3, "full"));
		time.advance(PET.restMs - 1);
		expect(pet.state).toBe("resting");
		time.advance(1);
		expect(pet.walk()).toMatchObject({ facing: -1, x: 3 * PET.slice });
		time.advance(walkMs(3, "full") + PET.restMs);
		expect(pet.walk()?.facing).toBe(1);
		time.advance(walkMs(3, "full"));
		expect([pet.state, time.pending(), changed.length]).toEqual(["spent", 0, 6]);
		time.advance(PET.restMs * 10);
		expect(changed.length).toBe(6);
	});

	it("leaves at once on input, and waits two full idle minutes again", () => {
		const { pet, time, changed } = setup();
		pet.configure(true, "full");
		time.advance(PET.idleMs + 5_000);
		pet.input();
		expect([pet.walk(), pet.state, changed]).toEqual([undefined, "idle", [["a", "b", "c"], ["a", "b", "c"]]]);
		time.advance(PET.idleMs - 1);
		expect(pet.walk()).toBeUndefined();
		time.advance(1);
		expect(pet.walk()?.facing).toBe(1);
	});

	it("counts input while waiting from the last one, and input while resting or spent starts over", () => {
		const { pet, time } = setup();
		pet.configure(true, "full");
		time.advance(100_000);
		pet.input();
		time.advance(PET.idleMs - 1);
		expect(pet.state).toBe("idle");
		time.advance(1);
		expect(pet.state).toBe("walking");
		time.advance(walkMs(3, "full") + 60_000);
		pet.input();
		time.advance(PET.idleMs);
		expect(pet.state).toBe("walking");
		time.advance((walkMs(3, "full") + PET.restMs) * 3);
		expect(pet.state).toBe("spent");
		pet.input();
		time.advance(PET.idleMs);
		expect(pet.state).toBe("walking");
	});

	it("stops mid-walk when turned off, when Motion turns off, or when its dials change", () => {
		for (const stop of [(pet: Pet) => pet.configure(false, "full"), (pet: Pet) => pet.configure(true, "off"), (pet: Pet) => pet.dialsChanged()]) {
			const { pet, time, changed } = setup();
			pet.configure(true, "full");
			time.advance(PET.idleMs + 1_000);
			stop(pet);
			expect(pet.walk()).toBeUndefined();
			expect(changed.length).toBe(2);
		}
	});

	it("steps calmly in Reduced: half as often, no bounce", () => {
		const { pet, time } = setup([["a"]]);
		pet.configure(true, "reduced");
		time.advance(PET.idleMs + PET.stepMs.reduced);
		expect(pet.walk()).toMatchObject({ step: 1, x: -SPRITE.width + PET.stepPx.reduced, bounce: false });
		time.advance(walkMs(1, "reduced") - PET.stepMs.reduced);
		expect(pet.walk()).toBeUndefined();
	});
});

describe("petArt", () => {
	const walk = (x: number, step = 0, bounce = false): Walk => ({ ids: ["a", "b"], facing: 1, x, step, bounce });

	it("places the robot on each dial at the walk's x less the dial's offset in the run", () => {
		expect(petArt(walk(250), "b")).toContain("translate(50 ");
		expect(petArt(walk(250), "a")).toBeUndefined();
		expect(petArt(walk(190), "a")).toContain("translate(190 ");
		expect(petArt(walk(190), "b")).toContain(`translate(${190 - PET.slice} `);
	});

	it("draws nothing on a dial the robot is wholly off, or one outside the walk", () => {
		expect(petArt(walk(-SPRITE.width), "a")).toBeUndefined();
		expect(petArt(walk(PET.slice), "a")).toBeUndefined();
		expect(petArt(walk(10), "c")).toBeUndefined();
	});

	it("stands its feet on the strip's floor, lifting on the passing step only with bounce", () => {
		const top = PET.feet - SPRITE.height;
		expect(petArt(walk(0, 1), "a")).toContain(`translate(0 ${top})`);
		expect(petArt(walk(0, 1, true), "a")).toContain(`translate(0 ${top - PET.bounce})`);
		expect(petArt(walk(0, 0, true), "a")).toContain(`translate(0 ${top})`);
	});
});

describe("spriteArt", () => {
	it("mirrors the robot to face left, inside the same box", () => {
		const right = spriteArt(0, 0, 0, 1);
		const left = spriteArt(0, 0, 0, -1);
		expect(left).not.toBe(right);
		const extent = (art: string) => Math.max(...[...art.matchAll(/x="(\d+)" y="\d+" width="(\d+)"/g)].map((match) => Number(match[1]) + Number(match[2])));
		expect([extent(right), extent(left)].every((edge) => edge <= SPRITE.width)).toBe(true);
	});
});
