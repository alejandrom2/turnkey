import type { HostMessage, SidecarMessage } from "./protocol.js";

/**
 * One kind of action: its face for a key's place, parameter (the action id after the kind) and pixel size, or none for
 * a parameter it doesn't know; what a press does (returning the key's next place, or nothing to keep it), with the
 * hold time a keypad reports; what a scroll does, and hooks for each time the key shows (with its action id) and for
 * when Logi says it is hidden (only the Turnkey folder's keys do).
 */
export type KeyKind = {
	face(index: number, parameter: string, size: number): string | undefined;
	/** The name Logi shows for the key, such as the model a slot stands for; the action's own name without one. */
	label?(index: number, parameter: string): string | undefined;
	/** The action's own translated name, for an entry Logi lists without one; not a thread title. */
	name?(parameter: string): string | undefined;
	press?(index: number, parameter: string, heldMs?: number): number | void;
	turn?(ticks: number, parameter: string): void;
	appear?(action: string): void;
	disappear?(action: string): void;
};

const parameterOf = (action: string): string => action.slice(action.indexOf(":") + 1);

/** Logi never says a key was hidden, but asks for its image on every show, so a key unseen this long is gone. */
export const STALE_MS = 86_400_000;

/**
 * One face of an action at one pixel size, as the Ring (80 px) and a keypad (116 px) can show the same action at once.
 * `face` is the last SVG sent, so a repaint that changes nothing sends nothing. `seen` is the last `appear`, press or
 * turn; a key pressed before any `appear` is taken for the Ring's 80 px.
 */
type Key = { kind: KeyKind; index: number; seen: number; face?: string; label?: string; name?: string };

/** The plugin's keys and ring slots by action id, `<kind>:<parameter>`, then by size, each painted by its kind. */
export class Keys {
	readonly #keys = new Map<string, Map<number, Key>>();

	constructor(
		private readonly kinds: Readonly<Record<string, KeyKind>>,
		private readonly send: (message: SidecarMessage) => void,
		private readonly now: () => number = Date.now,
	) {}

	handle(message: Exclude<HostMessage, { type: "language" }>): void {
		switch (message.type) {
			case "appear": {
				const kind = this.#kind(message.action);
				if (kind === undefined) return;
				const sizes = this.#keys.get(message.action) ?? new Map<number, Key>();
				this.#keys.set(message.action, sizes);
				const key = sizes.get(message.size) ?? { kind, index: 0, seen: 0 };
				key.seen = this.now();
				sizes.set(message.size, key);
				// An unchanged face isn't resent: the plugin still holds it, and each image makes Logi ask again.
				kind.appear?.(message.action);
				this.#paint(message.action, message.size, key);
				return;
			}
			case "disappear": {
				// The folder closing hides its keys at every size.
				const sizes = this.#keys.get(message.action);
				this.#keys.delete(message.action);
				if (sizes !== undefined) this.#kind(message.action)?.disappear?.(message.action);
				return;
			}
			case "press": {
				const sizes = this.#seen(message.action);
				if (sizes === undefined) return;
				// One press acts once, whichever sizes show it; each of them then moves to the place it returns.
				const [first] = sizes.values();
				const index = first!.kind.press?.(first!.index, parameterOf(message.action), message.heldMs) ?? first!.index;
				for (const key of sizes.values()) key.index = index;
				break;
			}
			case "turn": {
				const sizes = this.#seen(message.action);
				if (sizes === undefined) return;
				this.#kind(message.action)?.turn?.(message.ticks, parameterOf(message.action));
				break;
			}
		}
		for (const [size, key] of this.#keys.get(message.action) ?? []) this.#paint(message.action, size, key);
	}

	repaint(): void {
		const cutoff = this.now() - STALE_MS;
		for (const [action, sizes] of this.#keys) {
			for (const [size, key] of sizes) {
				if (key.seen < cutoff) sizes.delete(size);
				else this.#paint(action, size, key);
			}
			if (sizes.size === 0) this.#keys.delete(action);
		}
	}

	#kind(action: string): KeyKind | undefined {
		return this.kinds[action.split(":")[0]!];
	}

	/** The action's keys as of now; one that stayed shown with an unchanging face may have been forgotten as stale, so it's rebuilt at 80 px. */
	#seen(action: string): Map<number, Key> | undefined {
		const kind = this.#kind(action);
		if (kind === undefined) return undefined;
		const sizes = this.#keys.get(action) ?? new Map<number, Key>();
		if (sizes.size === 0) sizes.set(80, { kind, index: 0, seen: 0 });
		for (const key of sizes.values()) key.seen = this.now();
		this.#keys.set(action, sizes);
		return sizes;
	}

	#paint(action: string, size: number, key: Key): void {
		const face = key.kind.face(key.index, parameterOf(action), size);
		const label = key.kind.label?.(key.index, parameterOf(action));
		const name = key.kind.name?.(parameterOf(action));
		if (face === undefined || (face === key.face && label === key.label && name === key.name)) return;
		key.face = face;
		key.label = label;
		key.name = name;
		this.send({ type: "image", action, size, svg: face, ...(label === undefined ? {} : { label }), ...(name === undefined ? {} : { name }) });
	}
}
