/**
 * Scrolls one overflowing strip line on the dial in use: it waits after the last turn or touch, slides to the end at
 * a reading pace, rests, slides back, twice, then stops. Frames are due only while the text moves.
 */
export const MARQUEE = {
	delayMs: 1_000,
	pxPerSecond: 40,
	returnPxPerSecond: 160,
	pauseMs: 1_200,
	loops: 2,
	/** At most 10 frames a second. */
	frameMs: 100,
} as const;

/** Where the text sits `elapsed` ms after it starts moving, and how long until the next frame (undefined: done). */
export function marqueeFrame(elapsed: number, overflow: number): { offset: number; next: number | undefined } {
	if (overflow <= 0) return { offset: 0, next: undefined };
	const forward = (overflow / MARQUEE.pxPerSecond) * 1000;
	const back = (overflow / MARQUEE.returnPxPerSecond) * 1000;
	const loop = forward + MARQUEE.pauseMs + back;
	const period = loop + MARQUEE.pauseMs;
	if (elapsed >= MARQUEE.loops * period - MARQUEE.pauseMs) return { offset: 0, next: undefined };
	const t = elapsed % period;
	const due = (until: number, moving: boolean) => Math.max(1, Math.ceil(moving ? Math.min(MARQUEE.frameMs, until - t) : until - t));
	if (t < forward) return { offset: Math.round((overflow * t) / forward), next: due(forward, true) };
	if (t < forward + MARQUEE.pauseMs) return { offset: overflow, next: due(forward + MARQUEE.pauseMs, false) };
	if (t < loop) return { offset: Math.round(overflow * (1 - (t - forward - MARQUEE.pauseMs) / back)), next: due(loop, true) };
	return { offset: 0, next: due(period, false) };
}

/** A line that may scroll: `key` names its text, so a change of text stops the scroll. */
export type MarqueeLine = { key: string; overflow: number };

/**
 * One marquee for the whole deck: only the last dial turned or touched scrolls. `repaint` redraws an owner, which
 * reads its offset back through `offset()`; it runs per frame while moving, and once when a scroll is cut short.
 */
export class Marquee {
	#owner: string | undefined;
	#line: MarqueeLine | undefined;
	#startedAt: number | undefined;
	#offset = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly repaint: (owner: string) => void,
		private readonly now: () => number = Date.now,
	) {}

	/** The dial in use: any other dial stops, and this one scrolls once it has rested for the delay. */
	interact(owner: string): void {
		if (this.#owner !== owner) {
			this.stop();
			this.#line = undefined;
		} else if (this.#offset !== 0) {
			this.#halt();
			this.repaint(owner);
		} else this.#halt();
		this.#owner = owner;
		this.#timer = setTimeout(() => this.#start(), MARQUEE.delayMs);
	}

	/** Called while painting `owner`: the offset for its scrolling line (0 at rest). New text stops a scroll in progress. */
	offset(owner: string, line: MarqueeLine | undefined): number {
		if (owner !== this.#owner) return 0;
		if (line?.key !== this.#line?.key || line?.overflow !== this.#line?.overflow) {
			if (this.#startedAt !== undefined) this.#halt();
			this.#line = line;
			return 0;
		}
		return this.#startedAt === undefined ? 0 : this.#offset;
	}

	get moving(): boolean {
		return this.#startedAt !== undefined;
	}

	/** Stops `owner` (or whoever scrolls), repainting it at rest if it had moved. */
	stop(owner?: string, repaint = true): void {
		const current = this.#owner;
		if (current === undefined || (owner !== undefined && owner !== current)) return;
		const moved = this.#offset !== 0;
		this.#halt();
		this.#owner = undefined;
		this.#line = undefined;
		if (moved && repaint) this.repaint(current);
	}

	#halt(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#startedAt = undefined;
		this.#offset = 0;
	}

	#start(): void {
		this.#timer = undefined;
		if (this.#owner === undefined || this.#line === undefined || this.#line.overflow <= 0) return;
		this.#startedAt = this.now();
		this.#tick();
	}

	#tick(): void {
		const owner = this.#owner;
		if (owner === undefined || this.#line === undefined || this.#startedAt === undefined) return;
		const frame = marqueeFrame(this.now() - this.#startedAt, this.#line.overflow);
		const changed = frame.offset !== this.#offset;
		this.#offset = frame.offset;
		if (frame.next === undefined) this.#startedAt = undefined;
		else this.#timer = setTimeout(() => this.#tick(), frame.next);
		if (changed) this.repaint(owner);
	}
}
