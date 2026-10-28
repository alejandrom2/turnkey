import type { HostMessage, SidecarMessage } from "./protocol.js";

/** One kind of action: its face for a key's place, and what a press does, returning the key's next place or nothing to keep it. */
export type KeyKind = {
	face(index: number): string;
	press?(index: number): number | void;
};

/** `face` is the last SVG sent, so a repaint that changes nothing sends nothing. */
type Key = { kind: KeyKind; index: number; face?: string };

/** The plugin's keys and ring slots by action id, `<kind>:<parameter>`, each painted by its kind. */
export class Keys {
	readonly #keys = new Map<string, Key>();

	constructor(
		private readonly kinds: Readonly<Record<string, KeyKind>>,
		private readonly send: (message: SidecarMessage) => void,
	) {}

	handle(message: Exclude<HostMessage, { type: "language" }>): void {
		switch (message.type) {
			case "appear": {
				const kind = this.kinds[message.action.split(":")[0]!];
				if (kind === undefined) return;
				this.#keys.set(message.action, { kind, index: this.#keys.get(message.action)?.index ?? 0 });
				break;
			}
			case "disappear":
				this.#keys.delete(message.action);
				return;
			case "press": {
				const key = this.#keys.get(message.action);
				if (key === undefined) return;
				key.index = key.kind.press?.(key.index) ?? key.index;
				break;
			}
		}
		this.#paint(message.action);
	}

	repaint(): void {
		for (const action of this.#keys.keys()) this.#paint(action);
	}

	#paint(action: string): void {
		const key = this.#keys.get(action);
		if (key === undefined) return;
		const face = key.kind.face(key.index);
		if (face === key.face) return;
		key.face = face;
		this.send({ type: "image", action, svg: face });
	}
}
