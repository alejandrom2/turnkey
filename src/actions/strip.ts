import streamDeck, { type Action, type DialAction, type DialDownEvent, type DialRotateEvent, type DialUpEvent, type FeedbackPayload, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { t } from "../core/i18n.js";
import { Marquee } from "../core/marquee.js";
import { motionMode } from "../core/motion.js";
import { FEATURES } from "../core/features.js";
import { Pet, petArt } from "../core/pet.js";
import { dialGroups, type DialPlace, dialRuns, type Run } from "../core/flow.js";
import { BLANK_ART, COLORS, glyphArt, type MarkPainter, resolveAppearance, type StripAppearance, stripCanvas } from "../core/render.js";
import { type SliderInput, sliderArt, sliderLabelSlot, sliderLabelText } from "../core/slider.js";
import { Slides } from "../core/slides.js";
import { readingLength, scrollLine, scrollingLine, type StripContent, stripFeedback } from "../core/strip.js";
import {
	carouselFeedback,
	listFeedback,
	listFromContent,
	listReading,
	READING,
	readingLines,
	resolveStripStyle,
	scrollReading,
	STRIP_LAYOUTS,
	type StripList,
	type StripStyle,
	styleFlash,
	styleLine,
} from "../core/styles.js";
import { deck } from "../deck.js";
import { connectionProblem, DeckAction, type ReviewCard } from "./base.js";

/** Every dial's appearance overrides: "" follows the global setting. */
export type DialSettings = { machine?: string; background?: string; backgroundColor?: string; stripStyle?: string; textScroll?: string; confirmSend?: string };

/** How a dial presents itself: a strip style, or a picture (the Power dial's slider, a gauge) in place of the classic layout. */
type Presentation = StripStyle | "slider";

/** The slider draws everything but the background in one picture, on the carousel's layout (a canvas, a picture and a title). */
const LAYOUT: Record<Presentation, string> = { ...STRIP_LAYOUTS, slider: STRIP_LAYOUTS.carousel };

/** How long the reading view a long touch opens stays without a turn. */
export const READING_IDLE_MS = 5_000;

const painters = new Map<string, () => void>();
const repaint = (owner: string) => painters.get(owner)?.();

/** Where every visible dial of this plugin sits, for Flow runs across adjacent dials of every dial action. */
const places = new Map<string, DialPlace>();
let runs = new Map<string, Run>();
let groups: string[][] = [];

/** Walks the longest run of adjacent dials once the deck sits idle; only our own actions' input sends it away. */
const pet = new Pet({ runs: () => groups, changed: (ids) => ids.forEach(repaint) });
deck.onRepaint(() => pet.configure(FEATURES.idlePet && deck.appearance.idlePet === "on", motionMode(deck.appearance.motion)));
const leave = () => pet.input();
deck.previewPet = () => {
	if (FEATURES.idlePet) pet.preview();
};
streamDeck.actions.onKeyDown(leave);
streamDeck.actions.onDialDown(leave);
streamDeck.actions.onDialRotate(leave);
streamDeck.actions.onTouchTap(leave);

function placeDial(id: string, place: DialPlace | undefined): void {
	if (place === undefined) places.delete(id);
	else places.set(id, place);
	groups = dialGroups([...places.values()]);
	pet.dialsChanged();
	const next = dialRuns([...places.values()]);
	const changed = [...new Set([...runs.keys(), ...next.keys()])].filter((key) => JSON.stringify(runs.get(key)) !== JSON.stringify(next.get(key)));
	runs = next;
	for (const key of changed) if (key !== id) repaint(key);
}
const marquee = new Marquee(repaint);
const slides = new Slides(repaint);

/** A dim disc where a strip's icon will be, while the first connection loads. */
const SKELETON_MARK: MarkPainter = (x, y, size) => `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="#FFFFFF" fill-opacity=".1"/>`;

/** The strip shown instead of a dial's content while its machine is not usable. */
function disconnectedStrip(header: string, machine: string | undefined): StripContent | undefined {
	const muted = (value: string, detail: string): StripContent => ({ header, icon: glyphArt("plug", COLORS.muted), value, detail });
	switch (connectionProblem(machine)) {
		case "loading":
			return { header, icon: SKELETON_MARK, value: "", loading: true };
		case "missing":
			return muted(t("notice.machineRemoved"), t("notice.pickAnotherInSettings"));
		case "none":
			return muted(t("notice.notFound"), t("notice.openThenPress"));
		case "pair":
			return { header, icon: glyphArt("key", COLORS.attention), value: t("notice.pairDeck"), detail: t("notice.pastePairLink"), tone: "attention" };
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
	/** The presentation set on each dial; none means the manifest's layout, the classic one. */
	readonly #layouts = new Map<string, Presentation>();

	/** The strip's header, which also heads the connection notice while the dial's machine is unusable. */
	protected abstract heading(action: Action<T>): string;

	/** The face while the dial's machine is usable. */
	protected abstract face(action: Action<T>): StripContent;

	/** A slider that replaces the classic layout, as on the Power dial; undefined keeps the classic face. */
	protected slider(_action: Action<T>): SliderInput | undefined {
		return undefined;
	}

	/** A whole-strip picture that replaces the classic layout, as on the Threads and Limits dials; undefined keeps the classic face. */
	protected picture(_action: Action<T>): string | undefined {
		return undefined;
	}

	/** What the list and carousel turn through; undefined shows the face as one item. */
	protected list(_action: Action<T>): StripList | undefined {
		return undefined;
	}

	protected rotated(_action: DialAction<T>, _ticks: number): void | Promise<void> {}

	protected pressed(_action: DialAction<T>, _heldMs: number): void | Promise<void> {}

	protected tapped(_action: DialAction<T>): void | Promise<void> {}

	#appearance(action: Action<T>): StripAppearance {
		const appearance = resolveAppearance(deck.appearance, this.settingsOf(action));
		return appearance.background === "flow" ? { ...appearance, run: runs.get(action.id) } : appearance;
	}

	protected override migrateSettings(settings: T): T | undefined {
		return settings.background === "gradient" ? { ...settings, background: "t3" } : undefined;
	}

	#style(action: Action<T>) {
		return resolveStripStyle(deck.appearance, this.settingsOf(action), "classic");
	}

	/** The strip style this dial resolves to now. */
	protected styleOf(action: Action<T>): StripStyle {
		return this.#style(action).style;
	}

	/** The connection notice while the dial's machine is unusable; the face, slider, picture and list wait meanwhile. */
	#offline(action: Action<T>): StripContent | undefined {
		return disconnectedStrip(this.heading(action), this.machineOf(action));
	}

	protected override async draw(action: Action<T>): Promise<void> {
		if (!action.isDial()) return;
		painters.set(action.id, () => void this.paint(action));
		const { style, scroll } = this.#style(action);
		const offline = this.#offline(action);
		const slider = style === "classic" && offline === undefined ? this.slider(action) : undefined;
		const picture = style === "classic" && offline === undefined && slider === undefined ? this.picture(action) : undefined;
		const presentation: Presentation = slider === undefined && picture === undefined ? style : "slider";
		if ((this.#layouts.get(action.id) ?? "classic") !== presentation) {
			this.#layouts.set(action.id, presentation);
			this.#close(action.id, false);
			slides.stop(action.id);
			marquee.stop(action.id, false);
			await action.setFeedbackLayout(LAYOUT[presentation]);
			this.forgetSent(action.id);
		}
		const content = offline ?? this.face(action);
		const reading = this.#reading.get(action.id);
		// The pet skips a strip in the reading view; flashes and review cards build their own canvas without it.
		const walk = reading === undefined ? pet.walk() : undefined;
		const walking = walk !== undefined && walk.ids.includes(action.id);
		const appearance = { ...this.#appearance(action), pet: walking ? petArt(walk, action.id) : undefined };
		this.animate(action, (content.moving === true && reading === undefined && picture === undefined) || walking);
		if (presentation === "slider") {
			const canvas = stripCanvas(appearance, content.tone ?? "neutral", content.ultrathink === true);
			if (reading?.lines) return this.setFeedback(action, carouselFeedback(content, listFromContent(content), { appearance, scroll: "off", reading: { lines: reading.lines, top: reading.top } }));
			if (picture !== undefined) return this.setFeedback(action, { canvas, art: picture, title: { value: "", color: "#FFFFFF" }, titleArt: BLANK_ART });
			const line = scroll === "off" ? undefined : scrollLine(sliderLabelText(slider!), sliderLabelSlot(slider!), "horizontal", "slider");
			const labelOffset = marquee.offset(action.id, reading === undefined ? line : undefined);
			return this.setFeedback(action, { canvas, art: sliderArt({ ...slider!, labelOffset }), title: { value: "", color: "#FFFFFF" }, titleArt: BLANK_ART });
		}
		if (style === "classic") {
			const line = scrollingLine(content, scroll);
			const offset = marquee.offset(action.id, reading !== undefined || scroll === "off" ? undefined : line);
			return this.setFeedback(action, stripFeedback(content, { appearance, scroll, offset, full: reading?.text, top: reading?.top }));
		}
		const list = (offline === undefined ? this.list(action) : undefined) ?? listFromContent(content);
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
		const presentation = this.#layouts.get(action.id) ?? "classic";
		if (presentation !== "classic") return styleFlash(presentation === "slider" ? "carousel" : presentation, ok, label, this.#appearance(action));
		const color = ok ? COLORS.done : COLORS.error;
		const content: StripContent = { header: ok ? t("strip.done") : t("strip.notNow"), icon: glyphArt(ok ? "check" : "error", color), value: label, tone: ok ? "done" : "failed" };
		return stripFeedback(content, { appearance: this.#appearance(action), full: label });
	}

	/** A review card in the dial's presentation: the value to send or apply, its target thread, and how to go ahead. */
	protected override reviewFeedback(action: Action<T>, card: ReviewCard): FeedbackPayload {
		marquee.stop(action.id, false);
		const appearance = this.#appearance(action);
		const presentation = this.#layouts.get(action.id) ?? "classic";
		const content: StripContent = { header: card.verb, icon: glyphArt(card.glyph, COLORS.accent), value: card.body ?? card.target, detail: card.footer, detailColor: COLORS.accent };
		const target = t("review.to", { thread: card.target });
		if (presentation === "classic") return stripFeedback({ ...content, detail: `${card.footer} · ${target}` }, { appearance });
		if (presentation === "list") return listFeedback(content, { heading: card.verb, items: [{ key: "review", label: content.value, art: content.icon }], index: 0, note: { text: card.footer, color: COLORS.accent } }, { appearance, scroll: "off" });
		const lines = readingLines([card.body, target, card.footer]);
		return carouselFeedback(content, listFromContent(content), { appearance, scroll: "off", reading: { lines, top: 0 } });
	}

	override async onDialRotate(ev: DialRotateEvent<T>): Promise<void> {
		this.cancelReview(ev.action);
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
		if (ev.action.isDial()) placeDial(ev.action.id, { id: ev.action.id, device: ev.action.device.id, column: ev.action.coordinates.column });
		super.onWillAppear(ev);
	}

	override onWillDisappear(ev: WillDisappearEvent<T>): void {
		this.#close(ev.action.id, false);
		marquee.stop(ev.action.id, false);
		slides.stop(ev.action.id);
		this.#layouts.delete(ev.action.id);
		painters.delete(ev.action.id);
		placeDial(ev.action.id, undefined);
		super.onWillDisappear(ev);
	}

	/** Opens the reading view: the overflowing line in the Classic layout, the selected item's label and details otherwise. */
	async #open(action: DialAction<T>): Promise<void> {
		const { style } = this.#style(action);
		const offline = this.#offline(action);
		const content = offline ?? this.face(action);
		let reading: Reading;
		if (this.#layouts.get(action.id) === "slider") {
			const lines = readingLines([content.value, content.detail]);
			if (lines.length < 2) return;
			reading = { lines, top: 0 };
		} else if (style === "classic") {
			const line = scrollingLine(content);
			if (line === undefined) return;
			reading = { text: line.text, top: 0 };
		} else {
			const lines = listReading((offline === undefined ? this.list(action) : undefined) ?? listFromContent(content));
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
