import type { Action, DialAction, DialDownEvent, DialRotateEvent, DialUpEvent, FeedbackPayload, TouchTapEvent, WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { Marquee } from "../core/marquee.js";
import type { CatalogModel } from "../core/models.js";
import { powerIconUrl } from "../core/power.js";
import { COLORS, resolveAppearance, stripIcon } from "../core/render.js";
import { scrollingLine, type StripContent, stripFeedback } from "../core/strip.js";
import { deck } from "../deck.js";
import { connectionProblem, DeckAction } from "./base.js";

/** Every dial's appearance override: "" follows the global setting. */
export type DialSettings = { machine?: string; background?: string; backgroundColor?: string };

/** How long a long touch shows a line's full text. */
export const EXPAND_MS = 4_000;

const painters = new Map<string, () => void>();
const marquee = new Marquee((owner) => painters.get(owner)?.());

/** A model's provider mark in the strip's icon slot, as the Model key draws it. */
export const markIcon = (model: CatalogModel): string => powerIconUrl({ kind: "mark", model }, { acpIcons: deck.acpIcons });

/** The strip shown instead of a dial's content while its machine is not usable. */
export function disconnectedStrip(header: string, machine: string | undefined): StripContent | undefined {
	const muted = (value: string, detail: string): StripContent => ({ header, icon: stripIcon("plug", COLORS.muted), accent: COLORS.muted, value, detail });
	switch (connectionProblem(machine)) {
		case "missing":
			return muted("Machine removed", "Pick another in settings");
		case "none":
			return muted("T3 Code not found", "Open it, then press");
		case "pair":
			return { header, icon: stripIcon("key", COLORS.attention), accent: COLORS.attention, value: "Pair T3 Deck", detail: "Paste a pair link in settings", tone: "attention" };
		case "offline":
			return muted("Connecting…", "Press to retry");
		default:
			return undefined;
	}
}

/**
 * A dial drawn on `layouts/strip.json`. Subclasses describe the face; this draws it in the dial's appearance,
 * scrolls an overflowing line once the dial rests, and shows a line in full on a long touch.
 */
export abstract class StripDial<T extends DialSettings & JsonObject> extends DeckAction<T> {
	readonly #expanded = new Map<string, ReturnType<typeof setTimeout>>();

	protected abstract face(action: Action<T>): StripContent;

	protected rotated(_action: DialAction<T>, _ticks: number): void | Promise<void> {}

	protected pressed(_action: DialAction<T>, _heldMs: number): void | Promise<void> {}

	protected tapped(_action: DialAction<T>): void | Promise<void> {}

	#appearance(action: Action<T>) {
		return resolveAppearance(deck.appearance, this.settingsOf(action));
	}

	protected override async paint(action: Action<T>): Promise<void> {
		if (!action.isDial()) return;
		painters.set(action.id, () => void this.paint(action));
		const content = this.face(action);
		const line = scrollingLine(content);
		const expanded = this.#expanded.has(action.id) && line !== undefined;
		const offset = marquee.offset(action.id, expanded ? undefined : line);
		await this.setFeedback(action, stripFeedback(content, { appearance: this.#appearance(action), offset, full: expanded ? line.text : undefined }));
	}

	protected override flashFeedback(action: Action<T>, ok: boolean, label: string): FeedbackPayload {
		marquee.stop(action.id, false);
		const color = ok ? COLORS.done : COLORS.error;
		const content: StripContent = { header: ok ? "Done" : "Not now", icon: stripIcon(ok ? "check" : "error", color), accent: color, value: label, tone: ok ? "done" : "failed" };
		return stripFeedback(content, { appearance: this.#appearance(action), full: label });
	}

	override async onDialRotate(ev: DialRotateEvent<T>): Promise<void> {
		this.#collapse(ev.action.id);
		marquee.interact(ev.action.id);
		await this.rotated(ev.action, ev.payload.ticks);
		await this.paint(ev.action);
	}

	override onDialDown(ev: DialDownEvent<T>): void {
		marquee.interact(ev.action.id);
		this.pressStarted(ev.action.id);
	}

	override async onDialUp(ev: DialUpEvent<T>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		this.#collapse(ev.action.id);
		marquee.interact(ev.action.id);
		await this.pressed(ev.action, held);
	}

	override async onTouchTap(ev: TouchTapEvent<T>): Promise<void> {
		marquee.interact(ev.action.id);
		if (ev.payload.hold) return this.#expand(ev.action);
		this.#collapse(ev.action.id);
		await this.tapped(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent<T>): void {
		this.#collapse(ev.action.id, false);
		marquee.stop(ev.action.id, false);
		painters.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	/** Shows the overflowing line in full across both lines for a few seconds. */
	async #expand(action: DialAction<T>): Promise<void> {
		if (scrollingLine(this.face(action)) === undefined) return;
		marquee.stop(action.id, false);
		clearTimeout(this.#expanded.get(action.id));
		this.#expanded.set(
			action.id,
			setTimeout(() => {
				this.#expanded.delete(action.id);
				void this.paint(action);
			}, EXPAND_MS),
		);
		await this.paint(action);
	}

	#collapse(id: string, repaint = true): void {
		const timer = this.#expanded.get(id);
		if (timer === undefined) return;
		clearTimeout(timer);
		this.#expanded.delete(id);
		if (repaint) painters.get(id)?.();
	}
}
