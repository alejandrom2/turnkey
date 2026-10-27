/**
 * Confirm before sending. Review (the default): a first press shows what would be sent and where; a second press
 * between 750 ms and 10 s later sends it, and a press that finds anything changed reviews again. Hold: the press
 * must be held. Off: a press sends at once. One review is pending on the whole deck at a time.
 */
export type ConfirmMode = "review" | "hold" | "off";

const confirmValue = (value: unknown): ConfirmMode | undefined => (value === "review" || value === "hold" || value === "off" ? value : undefined);

/** The action's own setting when it has one, else the global one, else Review. */
export const confirmMode = (own: unknown, global: unknown): ConfirmMode => confirmValue(own) ?? confirmValue(global) ?? "review";

export const REVIEW = { minMs: 750, maxMs: 10_000 } as const;

/** What a press does under Review: show the card, nothing yet (too soon after it), or send `detail` as reviewed. */
export type ReviewPress = { kind: "review" } | { kind: "wait" } | { kind: "confirm"; detail: string };

type Pending = { owner: string; scope: string; detail: string; at: number; timer: ReturnType<typeof setTimeout> };

export class Reviews {
	#pending: Pending | undefined;

	/** `ended` hears about a card that expired or was replaced by another instance's, so its owner can repaint. */
	constructor(
		private readonly ended: (owner: string) => void,
		private readonly now: () => number = Date.now,
	) {}

	/**
	 * A press on `owner` that would send `detail` (such as a send mode) to `scope` (the target and its content). A
	 * pending review of the same scope confirms with the detail it showed, whatever this press's own.
	 */
	press(owner: string, scope: string, detail = ""): ReviewPress {
		const pending = this.#pending;
		const now = this.now();
		if (pending?.owner === owner && pending.scope === scope && now - pending.at < REVIEW.maxMs) {
			if (now - pending.at < REVIEW.minMs) return { kind: "wait" };
			this.#clear();
			return { kind: "confirm", detail: pending.detail };
		}
		this.#clear();
		if (pending !== undefined && pending.owner !== owner) this.ended(pending.owner);
		const timer = setTimeout(() => {
			if (this.#pending?.timer !== timer) return;
			this.#pending = undefined;
			this.ended(owner);
		}, REVIEW.maxMs);
		this.#pending = { owner, scope, detail, at: now, timer };
		return { kind: "review" };
	}

	/** The scope `owner` is reviewing, if it is. */
	scope(owner: string): string | undefined {
		return this.#pending?.owner === owner ? this.#pending.scope : undefined;
	}

	/** What `owner`'s pending review of `scope` would send, so a second press checks that rather than its own gesture. */
	detail(owner: string, scope: string): string | undefined {
		const pending = this.#pending;
		return pending?.owner === owner && pending.scope === scope && this.now() - pending.at < REVIEW.maxMs ? pending.detail : undefined;
	}

	/** Drops `owner`'s review; true when there was one. */
	cancel(owner: string): boolean {
		if (this.#pending?.owner !== owner) return false;
		this.#clear();
		return true;
	}

	#clear(): void {
		clearTimeout(this.#pending?.timer);
		this.#pending = undefined;
	}
}
