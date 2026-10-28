import type { DeckThread } from "../core/board.js";
import { t } from "../core/i18n.js";
import { renderThreadKey } from "../core/render.js";
import type { HostMessage, SidecarMessage } from "./protocol.js";

/** What a thread key reads from a thread. */
export type KeyThread = Pick<DeckThread, "deck" | "title" | "unseen">;

/** One kind of action: its face for a key's place, and what a press does, returning the key's next place or nothing to keep it. */
export type KeyKind = {
	face(index: number): string;
	press?(index: number): number | void;
};

/** `face` is the last SVG sent: comparing it skips resvg, the expensive part, when nothing shown changed. */
type Key = { kind: KeyKind; size: number; index: number; face?: string };

/** A key showing one thread; a press steps to the next. */
export const threadKind = (threads: () => readonly KeyThread[]): KeyKind => ({
	face(index) {
		const list = threads();
		const thread = list[index % Math.max(list.length, 1)];
		return thread ? renderThreadKey({ state: thread.deck, title: thread.title, unseen: thread.unseen }) : renderThreadKey({ state: "idle", title: t("strip.noThreads") });
	},
	press: (index) => (index + 1) % Math.max(threads().length, 1),
});

/** The plugin's keys and ring slots by action id, `<kind>:<parameter>`, each painted by its kind. */
export class Keys {
	readonly #keys = new Map<string, Key>();

	constructor(
		private readonly kinds: Readonly<Record<string, KeyKind>>,
		private readonly send: (message: SidecarMessage) => void,
		private readonly raster: (dataUrl: string, size: number) => string,
	) {}

	handle(message: HostMessage): void {
		switch (message.type) {
			case "appear": {
				const kind = this.kinds[message.action.split(":")[0]!];
				if (kind === undefined) return;
				this.#keys.set(message.action, { kind, size: message.size, index: this.#keys.get(message.action)?.index ?? 0 });
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
		this.send({ type: "image", action, png: this.raster(face, key.size) });
	}
}
