/**
 * Key motion: the spinner on running threads, the pulse of a thread waiting on you, and a one-shot flash when a
 * thread finishes or fails. Frames derive from the clock, so every key spins in step; the `Animator` repaints only
 * the instances that registered as moving, at most once a frame, and only while some do.
 */
import type { DeckState } from "./board.js";
import type { KeyMotion } from "./render.js";

/** Full: spinner, pulse and flash. Reduced: a slower spinner and the flash, no pulse. Off: still faces. */
export type MotionMode = "full" | "reduced" | "off";

export const motionMode = (value: unknown): MotionMode => (value === "reduced" || value === "off" ? value : "full");

export const MOTION = {
	/** Frame length per mode: 10 fps in Full, 4 in Reduced. */
	frameMs: { full: 100, reduced: 250 },
	/** Spinner steps per turn: 1.2 s a turn in Full, 3 s in Reduced. */
	spinSteps: 12,
	/** The pulse's period in Full, in frames. */
	pulseFrames: 15,
	/** How long a finish or failure flashes. */
	flashMs: 1_300,
} as const;

const PULSE = { low: 0.08, high: 0.32 } as const;
const FLASH = { peak: 0.5, rest: 0.12 } as const;

/** The spinner's angle at `now`, in degrees; 0 when still. */
export function spinAngle(mode: MotionMode, now: number): number {
	if (mode === "off") return 0;
	return (Math.floor(now / MOTION.frameMs[mode]) % MOTION.spinSteps) * (360 / MOTION.spinSteps);
}

/** The effort sparkles' twinkle step at `now`: every other frame (5 a second in Full, 2 in Reduced); undefined when Off. */
export function twinkleStep(mode: MotionMode, now: number): number | undefined {
	if (mode === "off") return undefined;
	return Math.floor(now / (MOTION.frameMs[mode] * 2));
}

const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;

/** The waiting pulse's wash at `now`: a quick rise and a slow fall; undefined unless motion is Full. */
export function pulseWash(mode: MotionMode, now: number): number | undefined {
	if (mode !== "full") return undefined;
	const phase = (Math.floor(now / MOTION.frameMs.full) % MOTION.pulseFrames) / MOTION.pulseFrames;
	const rise = 1 / 3;
	const level = phase < rise ? easeInOut(phase / rise) : 1 - easeInOut((phase - rise) / (1 - rise));
	return +(PULSE.low + (PULSE.high - PULSE.low) * level).toFixed(3);
}

/** A finish or failure's wash `age` ms after it happened, settling towards the resting tint; undefined once over. */
export function flashWash(age: number): number | undefined {
	if (age < 0 || age >= MOTION.flashMs) return undefined;
	const left = 1 - age / MOTION.flashMs;
	return +(FLASH.rest + (FLASH.peak - FLASH.rest) * left * left).toFixed(3);
}

/**
 * When each thread last finished or failed while the deck watched. A thread seen for the first time (a connect, a
 * reconnect, a board that just filled) never flashes, so only real changes do.
 */
export class Transitions {
	readonly #last = new Map<string, DeckState>();
	readonly #started = new Map<string, number>();

	constructor(private readonly now: () => number = Date.now) {}

	/** Returns the threads seen before whose state changed. */
	update(threads: readonly { key: string; deck: DeckState }[]): { key: string; from: DeckState; to: DeckState }[] {
		const now = this.now();
		const seen = new Set<string>();
		const changes: { key: string; from: DeckState; to: DeckState }[] = [];
		for (const { key, deck } of threads) {
			seen.add(key);
			const previous = this.#last.get(key);
			if (previous !== undefined && previous !== deck) {
				changes.push({ key, from: previous, to: deck });
				if (deck === "done" || deck === "failed") this.#started.set(key, now);
			}
			this.#last.set(key, deck);
		}
		for (const key of this.#last.keys()) if (!seen.has(key)) this.#last.delete(key);
		for (const [key, at] of this.#started) if (!seen.has(key) || now - at >= MOTION.flashMs) this.#started.delete(key);
		return changes;
	}

	/** How long ago `key` finished or failed, while that still flashes. */
	age(key: string): number | undefined {
		const at = this.#started.get(key);
		if (at === undefined) return undefined;
		const age = this.now() - at;
		if (age < MOTION.flashMs) return age;
		this.#started.delete(key);
		return undefined;
	}
}

/** How a thread key moves at `now`, and whether it needs frames. */
export function threadMotion(
	mode: MotionMode,
	thread: { key: string; deck: DeckState },
	transitions: Pick<Transitions, "age">,
	now: number,
): { motion: KeyMotion; moving: boolean } {
	if (mode === "off") return { motion: {}, moving: false };
	const motion: KeyMotion = {};
	let moving = false;
	if (thread.deck === "running") {
		motion.spin = spinAngle(mode, now);
		moving = true;
	}
	const age = transitions.age(thread.key);
	const flash = age === undefined ? undefined : flashWash(age);
	if (flash !== undefined) {
		motion.wash = flash;
		moving = true;
	} else if (thread.deck === "approval" || thread.deck === "question") {
		const pulse = pulseWash(mode, now);
		if (pulse !== undefined) {
			motion.wash = pulse;
			moving = true;
		}
	}
	return { motion, moving };
}

export type Timers = { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

export const realTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/**
 * Drives frames for the instances that move. One timer for the whole deck, aligned to frame boundaries, running only
 * while something moves and motion isn't Off; an instance that stops moving, or goes away, unregisters.
 */
export class Animator {
	readonly #frames = new Map<string, () => void>();
	#mode: MotionMode = "full";
	#timer: unknown;

	constructor(
		private readonly now: () => number = Date.now,
		private readonly timers: Timers = realTimers,
	) {}

	get mode(): MotionMode {
		return this.#mode;
	}

	set mode(mode: MotionMode) {
		if (mode === this.#mode) return;
		this.#mode = mode;
		this.#stop();
		this.#schedule();
	}

	/** Registers `id`'s frame painter while it moves; undefined unregisters it. */
	set(id: string, frame: (() => void) | undefined): void {
		if (frame === undefined) this.#frames.delete(id);
		else this.#frames.set(id, frame);
		if (this.#frames.size === 0) this.#stop();
		else this.#schedule();
	}

	get moving(): number {
		return this.#frames.size;
	}

	#schedule(): void {
		if (this.#timer !== undefined || this.#frames.size === 0 || this.#mode === "off") return;
		const frame = MOTION.frameMs[this.#mode];
		this.#timer = this.timers.set(() => this.#tick(), frame - (this.now() % frame) || frame);
	}

	#tick(): void {
		this.#timer = undefined;
		// A copy: painting a frame registers or unregisters instances.
		for (const frame of Array.from(this.#frames.values())) frame();
		this.#schedule();
	}

	#stop(): void {
		if (this.#timer === undefined) return;
		this.timers.clear(this.#timer);
		this.#timer = undefined;
	}
}

/** When the next elapsed label changes: the soonest minute boundary of any running turn, in ms from `now`. */
export function nextMinute(starts: readonly number[], now: number): number | undefined {
	if (starts.length === 0) return undefined;
	return Math.min(...starts.map((since) => 60_000 - (Math.max(0, now - since) % 60_000)));
}
