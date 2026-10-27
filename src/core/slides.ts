/**
 * The carousel's slide between items. A turn waits for the dial to pause briefly (fast spins coalesce), then slides
 * from where the strip is to the new item in a short eased move; a turn during a slide restarts it towards the latest
 * item from where it is, at most one item away. Only the dial last turned moves; anything else snaps.
 */
export const SLIDE = { durationMs: 250, frameMs: 67, debounceMs: 80 } as const;

const easeOut = (t: number) => 1 - (1 - t) ** 2;

/** How far a slide has gone `elapsed` ms in (0 to 1), and how long until the next frame (undefined: done). */
export function slideFrame(elapsed: number): { progress: number; next: number | undefined } {
	if (elapsed >= SLIDE.durationMs) return { progress: 1, next: undefined };
	const t = Math.max(0, elapsed);
	return { progress: easeOut(t / SLIDE.durationMs), next: Math.max(1, Math.ceil(Math.min(SLIDE.frameMs, SLIDE.durationMs - t))) };
}

/** What a carousel points at: the item's index and key, and whether turning past the end comes round. */
export type SlideTarget = { index: number; key: string; count: number; wrap?: boolean };

type Track = { key: string; shown: number; from: number; to: number; startedAt?: number; timer?: ReturnType<typeof setTimeout> };

export class Slides {
	readonly #tracks = new Map<string, Track>();
	#owner: string | undefined;
	#turned = false;

	constructor(
		private readonly repaint: (owner: string) => void,
		private readonly now: () => number = Date.now,
	) {}

	/** `owner` was just turned: its next change of item slides, and any other dial's slide ends where it was going. */
	turn(owner: string): void {
		if (this.#owner !== undefined && this.#owner !== owner) this.#settle(this.#owner);
		this.#owner = owner;
		this.#turned = true;
	}

	/**
	 * Called while painting `owner`: the position to draw, in items (fractional mid-slide). On a cycling list positions
	 * keep counting past the ends, so draw item `position mod count`.
	 */
	position(owner: string, target: SlideTarget): number {
		const turned = this.#turned && owner === this.#owner;
		if (owner === this.#owner) this.#turned = false;
		const track = this.#tracks.get(owner);
		if (track === undefined) {
			this.#tracks.set(owner, { key: target.key, shown: target.index, from: target.index, to: target.index });
			return target.index;
		}
		const cycles = target.wrap === true && target.count >= 3;
		const goal = cycles ? target.index + target.count * Math.round((track.to - target.index) / target.count) : target.index;
		if (goal === track.to && target.key === track.key) return track.shown;
		track.key = target.key;
		track.to = goal;
		if (!turned) {
			this.#halt(track);
			track.shown = track.from = goal;
			return goal;
		}
		if (track.startedAt !== undefined) this.#start(owner, track, false);
		else {
			clearTimeout(track.timer);
			track.timer = setTimeout(() => this.#start(owner, track, true), SLIDE.debounceMs);
		}
		return track.shown;
	}

	get moving(): boolean {
		return [...this.#tracks.values()].some((track) => track.timer !== undefined);
	}

	/** Forgets `owner`, clearing its timer: when its dial goes away or stops being a carousel. */
	stop(owner: string): void {
		const track = this.#tracks.get(owner);
		if (track !== undefined) this.#halt(track);
		this.#tracks.delete(owner);
		if (this.#owner === owner) this.#owner = undefined;
	}

	#halt(track: Track): void {
		clearTimeout(track.timer);
		track.timer = undefined;
		track.startedAt = undefined;
	}

	#settle(owner: string): void {
		const track = this.#tracks.get(owner);
		if (track === undefined || track.timer === undefined) return;
		this.#halt(track);
		track.shown = track.from = track.to;
		this.repaint(owner);
	}

	/** Slides from where the strip is, or from one item short of the target after a long spin; `paint` outside a paint. */
	#start(owner: string, track: Track, paint: boolean): void {
		clearTimeout(track.timer);
		track.from = Math.min(track.to + 1, Math.max(track.to - 1, track.shown));
		track.startedAt = this.now();
		track.timer = setTimeout(() => this.#tick(owner, track), SLIDE.frameMs);
		if (track.from === track.shown) return;
		track.shown = track.from;
		if (paint) this.repaint(owner);
	}

	#tick(owner: string, track: Track): void {
		if (track.startedAt === undefined) return;
		const frame = slideFrame(this.now() - track.startedAt);
		const shown = track.from + (track.to - track.from) * frame.progress;
		if (frame.next === undefined) this.#halt(track);
		else track.timer = setTimeout(() => this.#tick(owner, track), frame.next);
		if (shown !== track.shown) {
			track.shown = shown;
			this.repaint(owner);
		}
	}
}
