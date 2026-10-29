import type { Machine } from "./t3/machine.js";

type WatchOptions = {
	/** Opens the subscription on a machine and returns its release. */
	open: (machine: Machine) => () => void;
	/** After a machine's subscription opened. */
	opened?: (machine: Machine) => void;
	/** After a machine's subscription was released. */
	closed?: (machine: Machine) => void;
};

/**
 * One subscription per machine that a visible instance shows, opened on demand and released once none shows it, and a
 * minute tick for whoever asks while any instance shows. Nothing runs while none does. Every board change syncs again,
 * so a machine removed and added back is subscribed afresh.
 */
export class MachineWatch {
	readonly #options: WatchOptions;
	readonly #shown = new Map<string, () => readonly Machine[]>();
	readonly #open = new Map<Machine, () => void>();
	readonly #ticks = new Set<() => void>();
	#timer: ReturnType<typeof setInterval> | undefined;

	/** `onRepaint` registers a listener for board changes; the host injects it so core stays platform-free. */
	constructor(options: WatchOptions, onRepaint: (listener: () => void) => void) {
		this.#options = options;
		onRepaint(() => this.sync());
	}

	/** Watches what instance `id` shows; `machines` is asked again on every sync, so it may follow the instance's state. */
	show(id: string, machines: () => readonly Machine[]): void {
		this.#shown.set(id, machines);
		this.sync();
	}

	hide(id: string): void {
		this.#shown.delete(id);
		this.sync();
	}

	/** Runs `tick` once a minute while any instance shows. */
	onTick(tick: () => void): void {
		this.#ticks.add(tick);
	}

	/** The machines subscribed now. */
	machines(): Machine[] {
		return [...this.#open.keys()];
	}

	sync(): void {
		const wanted = new Set([...this.#shown.values()].flatMap((machines) => machines()));
		for (const [machine, release] of this.#open) {
			if (wanted.has(machine)) continue;
			release();
			this.#open.delete(machine);
			this.#options.closed?.(machine);
		}
		for (const machine of wanted) {
			if (this.#open.has(machine)) continue;
			this.#open.set(machine, this.#options.open(machine));
			this.#options.opened?.(machine);
		}
		if (this.#shown.size === 0 || this.#ticks.size === 0) {
			clearInterval(this.#timer);
			this.#timer = undefined;
		} else this.#timer ??= setInterval(() => this.#ticks.forEach((tick) => tick()), 60_000);
	}
}
