/**
 * The idle pet: after the deck has been left alone a while, a small robot walks across a run of adjacent dial strips,
 * rests, and walks again a few times. Any press, turn or touch sends it away and starts the wait over. Time and timers
 * are injected, so this holds no clock of its own; it keeps at most one timer, and none while off or out of walks.
 */
import { type MotionMode, realTimers, type Timers } from "./motion.js";
import { SPRITE, spriteArt } from "./sprite.js";

export const PET = {
	idleMs: 120_000,
	restMs: 240_000,
	walks: 3,
	/** Step length: multiples of the Animator's frame (100 ms Full, 250 ms Reduced), so steps land evenly: 5 fps and 2 fps. */
	stepMs: { full: 200, reduced: 500 },
	stepPx: { full: 8, reduced: 12 },
	/** A dial's strip width, and where the robot's feet stand. */
	slice: 200,
	feet: 94,
	bounce: 2,
} as const;

/** Where the walk is now: `x` is the sprite's left edge from the run's left edge, in px. */
export type Walk = { ids: readonly string[]; facing: 1 | -1; x: number; step: number; bounce: boolean };

type Hooks = {
	/** Dial ids per run of adjacent dials, left to right. */
	runs: () => readonly (readonly string[])[];
	/** A walk on these dials began or ended: repaint them. */
	changed: (ids: readonly string[]) => void;
};

type State =
	| { kind: "off" }
	| { kind: "idle" }
	| { kind: "walking"; ids: readonly string[]; facing: 1 | -1; mode: "full" | "reduced"; startedAt: number; endsAt: number }
	| { kind: "resting" }
	| { kind: "spent" };

export class Pet {
	#enabled = false;
	#mode: MotionMode = "full";
	#state: State = { kind: "off" };
	#timer: unknown;
	#lastInput: number;
	#walks = 0;
	#previewing = false;

	constructor(
		private readonly hooks: Hooks,
		private readonly now: () => number = Date.now,
		private readonly timers: Timers = realTimers,
	) {
		this.#lastInput = now();
	}

	get state(): State["kind"] {
		return this.#state.kind;
	}

	/** The Idle pet and Motion settings; a change counts as activity. */
	configure(enabled: boolean, mode: MotionMode): void {
		if (enabled === this.#enabled && mode === this.#mode) return;
		this.#enabled = enabled;
		this.#mode = mode;
		this.#lastInput = this.now();
		this.#restart();
	}

	/** Dials came or went (a page or profile switch): the walk's run may be gone, and that is activity too. */
	dialsChanged(): void {
		this.#lastInput = this.now();
		this.#restart();
	}

	/** A press, turn or touch on one of our actions: the pet leaves and the wait starts over. */
	input(): void {
		this.#lastInput = this.now();
		// The pending idle timer reads `#lastInput` when it fires, so a stream of turns costs no timer churn.
		if (this.#state.kind === "idle") return;
		this.#restart();
	}

	/**
	 * One walk now, from the inspector's Preview button: shown even with the pet or Motion off (calmly then), and
	 * afterwards the pet goes back to what its settings say.
	 */
	preview(): void {
		this.#restart();
		this.#previewing = true;
		this.#start(this.#mode === "off" ? "reduced" : this.#mode);
		if (this.#state.kind !== "walking") this.#previewing = false;
	}

	/** The walk at this moment, until it has left the run. */
	walk(): Walk | undefined {
		const state = this.#state;
		const now = this.now();
		if (state.kind !== "walking" || now >= state.endsAt) return undefined;
		const step = Math.floor((now - state.startedAt) / PET.stepMs[state.mode]);
		const moved = step * PET.stepPx[state.mode];
		const x = state.facing === 1 ? -SPRITE.width + moved : state.ids.length * PET.slice - moved;
		return { ids: state.ids, facing: state.facing, x, step, bounce: state.mode === "full" };
	}

	#restart(): void {
		this.#clear();
		this.#walks = 0;
		this.#previewing = false;
		const walking = this.#state.kind === "walking" ? this.#state.ids : undefined;
		this.#state = { kind: "off" };
		if (walking) this.hooks.changed(walking);
		if (!this.#enabled || this.#mode === "off" || this.hooks.runs().length === 0) return;
		this.#state = { kind: "idle" };
		this.#arm(PET.idleMs, () => this.#idleDue());
	}

	#idleDue(): void {
		const left = this.#lastInput + PET.idleMs - this.now();
		if (left > 0) return this.#arm(left, () => this.#idleDue());
		this.#start();
	}

	#start(mode: MotionMode = this.#mode): void {
		const ids = this.hooks.runs().reduce<readonly string[]>((longest, run) => (run.length > longest.length ? run : longest), []);
		if (mode === "off" || ids.length === 0) {
			this.#state = { kind: "off" };
			return;
		}
		const steps = Math.ceil((ids.length * PET.slice + SPRITE.width) / PET.stepPx[mode]);
		const startedAt = this.now();
		const endsAt = startedAt + steps * PET.stepMs[mode];
		this.#state = { kind: "walking", ids, facing: this.#walks % 2 === 0 ? 1 : -1, mode, startedAt, endsAt };
		this.#arm(endsAt - startedAt, () => this.#end());
		this.hooks.changed(ids);
	}

	#end(): void {
		if (this.#state.kind !== "walking") return;
		const { ids } = this.#state;
		if (this.#previewing) {
			this.#restart();
			this.hooks.changed(ids);
			return;
		}
		this.#walks++;
		if (this.#walks >= PET.walks) this.#state = { kind: "spent" };
		else {
			this.#state = { kind: "resting" };
			this.#arm(PET.restMs, () => this.#start());
		}
		this.hooks.changed(ids);
	}

	#arm(ms: number, run: () => void): void {
		this.#timer = this.timers.set(() => {
			this.#timer = undefined;
			run();
		}, ms);
	}

	#clear(): void {
		if (this.#timer === undefined) return;
		this.timers.clear(this.#timer);
		this.#timer = undefined;
	}
}

/** The robot's part on dial `id` of the walk, in strip coordinates; undefined while it is off that dial's strip. */
export function petArt(walk: Walk, id: string): string | undefined {
	const position = walk.ids.indexOf(id);
	if (position < 0) return undefined;
	const x = walk.x - position * PET.slice;
	if (x <= -SPRITE.width || x >= PET.slice) return undefined;
	const frame = walk.step % 2;
	const lift = walk.bounce && frame === 1 ? PET.bounce : 0;
	return spriteArt(x, PET.feet - SPRITE.height - lift, frame, walk.facing);
}
