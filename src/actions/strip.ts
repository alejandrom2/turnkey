import type { Action, DialAction, DialDownEvent, DialRotateEvent, DialUpEvent, FeedbackPayload, TouchTapEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { t } from "../core/i18n.js";
import { Marquee } from "../core/marquee.js";
import type { CatalogModel } from "../core/models.js";
import { powerArt } from "../core/power.js";
import { COLORS, glyphArt, type MarkPainter, resolveAppearance } from "../core/render.js";
import { Slides } from "../core/slides.js";
import { readingLength, scrollingLine, type StripContent, stripFeedback } from "../core/strip.js";
import {
	carouselFeedback,
	listFeedback,
	listFromContent,
	listReading,
	READING,
	resolveStripStyle,
	scrollReading,
	STRIP_LAYOUTS,
	type StripList,
	type StripStyle,
	styleFlash,
	styleLine,
} from "../core/styles.js";
import { deck } from "../deck.js";
import { connectionProblem, DeckAction } from "./base.js";

/** Every dial's appearance overrides: "" follows the global setting. */
export type DialSettings = { machine?: string; background?: string; backgroundColor?: string; stripStyle?: string; textScroll?: string };

/** How long the reading view a long touch opens stays without a turn. */
export const READING_IDLE_MS = 5_000;

const painters = new Map<string, () => void>();
const repaint = (owner: string) => painters.get(owner)?.();
const marquee = new Marquee(repaint);
const slides = new Slides(repaint);

/** A model's provider mark, as the Model key draws it. */
export const markArt = (model: CatalogModel): MarkPainter => powerArt({ kind: "mark", model }, { acpIcons: deck.acpIcons });

/** The strip shown instead of a dial's content while its machine is not usable. */
export function disconnectedStrip(header: string, machine: string | undefined): StripContent | undefined {
	const muted = (value: string, detail: string): StripContent => ({ header, icon: glyphArt("plug", COLORS.muted), accent: COLORS.muted, value, detail });
	switch (connectionProblem(machine)) {
		case "missing":
			return muted(t("notice.machineRemoved"), t("notice.pickAnotherInSettings"));
		case "none":
			return muted(t("notice.notFound"), t("notice.openThenPress"));
		case "pair":
			return { header, icon: glyphArt("key", COLORS.attention), accent: COLORS.attention, value: t("notice.pairDeck"), detail: t("notice.pastePairLink"), tone: "attention" };
		case "offline":
			return muted(t("notice.connecting"), t("notice.pressToRetry"));
		default:
			return undefined;
	}
}

/** A long touch's full text: the Classic layout keeps the text and the wrapped line it starts at, the others wrapped lines. */
type Reading = { text?: string; lines?: string[]; top: number; timer?: ReturnType<typeof setTimeout> };

/**
 * A dial on the touch strip, in the style its settings pick: the Classic layout (`layouts/strip.json`), a list wheel or a
 * carousel. Subclasses describe the face, and the items to browse for the other styles; this draws it in the dial's
 * appearance, scrolls an overflowing line once the dial rests, and shows the full text on a long touch, which turning
 * then scrolls.
 */
export abstract class StripDial<T extends DialSettings & JsonObject> extends DeckAction<T> {
	readonly #reading = new Map<string, Reading>();
	/** The layout set on each dial; none means the manifest's, Classic. */
	readonly #layouts = new Map<string, StripStyle>();

	protected abstract face(action: Action<T>): StripContent;

	/** What the list and carousel turn through; undefined shows the face as one item. */
	protected list(_action: Action<T>): StripList | undefined {
		return undefined;
	}

	protected rotated(_action: DialAction<T>, _ticks: number): void | Promise<void> {}

	protected pressed(_action: DialAction<T>, _heldMs: number): void | Promise<void> {}

	protected tapped(_action: DialAction<T>): void | Promise<void> {}

	#appearance(action: Action<T>) {
		return resolveAppearance(deck.appearance, this.settingsOf(action));
	}

	#style(action: Action<T>) {
		return resolveStripStyle(deck.appearance, this.settingsOf(action));
	}

	protected override async paint(action: Action<T>): Promise<void> {
		if (!action.isDial()) return;
		painters.set(action.id, () => void this.paint(action));
		const { style, scroll } = this.#style(action);
		if ((this.#layouts.get(action.id) ?? "classic") !== style) {
			this.#layouts.set(action.id, style);
			this.#close(action.id, false);
			slides.stop(action.id);
			marquee.stop(action.id, false);
			await action.setFeedbackLayout(STRIP_LAYOUTS[style]);
			this.forgetSent(action.id);
		}
		const appearance = this.#appearance(action);
		const content = this.face(action);
		const reading = this.#reading.get(action.id);
		if (style === "classic") {
			const line = scrollingLine(content, scroll);
			const offset = marquee.offset(action.id, reading !== undefined || scroll === "off" ? undefined : line);
			return this.setFeedback(action, stripFeedback(content, { appearance, scroll, offset, full: reading?.text, top: reading?.top }));
		}
		const list = this.list(action) ?? listFromContent(content);
		const target = list.items[list.index];
		const position =
			style === "carousel" && target !== undefined ? slides.position(action.id, { index: list.index, key: target.key, count: list.items.length, wrap: list.wrap }) : list.index;
		const line = styleLine(style, list, scroll, position);
		const offset = marquee.offset(action.id, reading !== undefined || scroll === "off" ? undefined : line);
		const options = { appearance, scroll, offset, position, reading: reading?.lines && { lines: reading.lines, top: reading.top } };
		await this.setFeedback(action, style === "list" ? listFeedback(content, list, options) : carouselFeedback(content, list, options));
	}

	protected override flashFeedback(action: Action<T>, ok: boolean, label: string): FeedbackPayload {
		marquee.stop(action.id, false);
		const style = this.#layouts.get(action.id) ?? "classic";
		if (style !== "classic") return styleFlash(style, ok, label, this.#appearance(action));
		const color = ok ? COLORS.done : COLORS.error;
		const content: StripContent = { header: ok ? t("strip.done") : t("strip.notNow"), icon: glyphArt(ok ? "check" : "error", color), accent: color, value: label, tone: ok ? "done" : "failed" };
		return stripFeedback(content, { appearance: this.#appearance(action), full: label });
	}

	override async onDialRotate(ev: DialRotateEvent<T>): Promise<void> {
		const reading = this.#reading.get(ev.action.id);
		if (reading !== undefined) {
			const [count, visible] = reading.lines ? [reading.lines.length, READING.visible] : [readingLength(reading.text ?? ""), 2];
			reading.top = scrollReading(reading.top, ev.payload.ticks, count, visible);
			this.#keepReading(ev.action, reading);
			return this.paint(ev.action);
		}
		marquee.interact(ev.action.id);
		slides.turn(ev.action.id);
		await this.rotated(ev.action, ev.payload.ticks);
		await this.paint(ev.action);
	}

	override onDialDown(ev: DialDownEvent<T>): void {
		marquee.interact(ev.action.id);
		this.pressStarted(ev.action.id);
	}

	/** A press or tap while the reading view is open only closes it, since turning there scrolls rather than picks. */
	override async onDialUp(ev: DialUpEvent<T>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		marquee.interact(ev.action.id);
		if (this.#close(ev.action.id)) return;
		await this.pressed(ev.action, held);
	}

	override async onTouchTap(ev: TouchTapEvent<T>): Promise<void> {
		marquee.interact(ev.action.id);
		if (ev.payload.hold) return this.#open(ev.action);
		if (this.#close(ev.action.id)) return;
		await this.tapped(ev.action);
	}

	override onWillAppear(ev: WillAppearEvent<T>): void {
		this.#layouts.delete(ev.action.id);
		super.onWillAppear(ev);
	}

	override onWillDisappear(ev: WillDisappearEvent<T>): void {
		this.#close(ev.action.id, false);
		marquee.stop(ev.action.id, false);
		slides.stop(ev.action.id);
		this.#layouts.delete(ev.action.id);
		painters.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	/** Opens the reading view: the overflowing line in the Classic layout, the selected item's label and details otherwise. */
	async #open(action: DialAction<T>): Promise<void> {
		const { style } = this.#style(action);
		const content = this.face(action);
		let reading: Reading;
		if (style === "classic") {
			const line = scrollingLine(content);
			if (line === undefined) return;
			reading = { text: line.text, top: 0 };
		} else {
			const lines = listReading(this.list(action) ?? listFromContent(content));
			if (lines.length < 2) return;
			reading = { lines, top: 0 };
		}
		marquee.stop(action.id, false);
		clearTimeout(this.#reading.get(action.id)?.timer);
		this.#reading.set(action.id, reading);
		this.#keepReading(action, reading);
		await this.paint(action);
	}

	/** Restarts the reading view's idle timer. */
	#keepReading(action: DialAction<T>, reading: Reading): void {
		clearTimeout(reading.timer);
		reading.timer = setTimeout(() => {
			this.#reading.delete(action.id);
			void this.paint(action);
		}, READING_IDLE_MS);
	}

	/** Closes the reading view; false when none was open. */
	#close(id: string, repaint = true): boolean {
		const reading = this.#reading.get(id);
		if (reading === undefined) return false;
		clearTimeout(reading.timer);
		this.#reading.delete(id);
		if (repaint) painters.get(id)?.();
		return true;
	}
}
