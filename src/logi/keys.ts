import type { HostMessage, SidecarMessage } from "./protocol.js";

/**
 * One kind of action: its face for a key's place and parameter (the action id after the kind), what a press does
 * (returning the key's next place, or nothing to keep it), what a scroll does, and a hook for each time the key shows.
 */
export type KeyKind = {
	face(index: number, parameter: string): string;
	press?(index: number, parameter: string): number | void;
	turn?(ticks: number, parameter: string): void;
	appear?(): void;
};

const parameterOf = (action: string): string => action.slice(action.indexOf(":") + 1);

/** Logi never says a key was hidden, but asks for its image on every show, so a key unseen this long is gone. */
export const STALE_MS = 86_400_000;

/** `face` is the last SVG sent, so a repaint that changes nothing sends nothing. `seen` is the last `appear`, press or turn. */
type Key = { kind: KeyKind; index: number; seen: number; face?: string };

/** The plugin's keys and ring slots by action id, `<kind>:<parameter>`, each painted by its kind. */
export class Keys {
	readonly #keys = new Map<string, Key>();

	constructor(
		private readonly kinds: Readonly<Record<string, KeyKind>>,
		private readonly send: (message: SidecarMessage) => void,
		private readonly now: () => number = Date.now,
	) {}

	handle(message: Exclude<HostMessage, { type: "language" }>): void {
		switch (message.type) {
			case "appear": {
				const key = this.#seen(message.action);
				if (key === undefined) return;
				// Logi asked for an image, so it gets one even when the face didn't change.
				key.face = undefined;
				key.kind.appear?.();
				break;
			}
			case "disappear":
				this.#keys.delete(message.action);
				return;
			case "press": {
				const key = this.#seen(message.action);
				if (key === undefined) return;
				key.index = key.kind.press?.(key.index, parameterOf(message.action)) ?? key.index;
				break;
			}
			case "turn": {
				const key = this.#seen(message.action);
				if (key === undefined) return;
				key.kind.turn?.(message.ticks, parameterOf(message.action));
				break;
			}
		}
		this.#paint(message.action);
	}

	repaint(): void {
		const cutoff = this.now() - STALE_MS;
		for (const [action, key] of this.#keys) {
			if (key.seen < cutoff) this.#keys.delete(action);
			else this.#paint(action);
		}
	}

	/** The key as of now; a key that stayed shown with an unchanging face may have been forgotten as stale, so it's rebuilt. */
	#seen(action: string): Key | undefined {
		const kind = this.kinds[action.split(":")[0]!];
		if (kind === undefined) return undefined;
		const key = this.#keys.get(action) ?? { kind, index: 0, seen: 0 };
		key.seen = this.now();
		this.#keys.set(action, key);
		return key;
	}

	#paint(action: string): void {
		const key = this.#keys.get(action);
		if (key === undefined) return;
		const face = key.kind.face(key.index, parameterOf(action));
		if (face === key.face) return;
		key.face = face;
		this.send({ type: "image", action, svg: face });
	}
}
