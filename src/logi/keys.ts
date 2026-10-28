import type { DeckThread } from "../core/board.js";
import { t } from "../core/i18n.js";
import { renderThreadKey } from "../core/render.js";
import type { HostMessage, SidecarMessage } from "./protocol.js";

/** What a thread key reads from a thread. */
export type KeyThread = Pick<DeckThread, "deck" | "title" | "unseen">;

/** `face` is the last SVG sent: comparing it skips resvg, the expensive part, when nothing shown changed. */
type Key = { size: number; index: number; face?: string };

/** The spike's one action: a key showing a thread, and a press stepping to the next. */
export class ThreadKeys {
	readonly #keys = new Map<string, Key>();

	constructor(
		private readonly threads: () => readonly KeyThread[],
		private readonly send: (message: SidecarMessage) => void,
		private readonly raster: (dataUrl: string, size: number) => string,
	) {}

	handle(message: HostMessage): void {
		switch (message.type) {
			case "appear":
				this.#keys.set(message.action, { size: message.size, index: this.#keys.get(message.action)?.index ?? 0 });
				break;
			case "disappear":
				this.#keys.delete(message.action);
				return;
			case "press": {
				const key = this.#keys.get(message.action);
				if (key === undefined) return;
				key.index = (key.index + 1) % Math.max(this.threads().length, 1);
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
		const threads = this.threads();
		const thread = threads[key.index % Math.max(threads.length, 1)];
		const face = thread ? renderThreadKey({ state: thread.deck, title: thread.title, unseen: thread.unseen }) : renderThreadKey({ state: "idle", title: t("strip.noThreads") });
		if (face === key.face) return;
		key.face = face;
		this.send({ type: "image", action, png: this.raster(face, key.size) });
	}
}
