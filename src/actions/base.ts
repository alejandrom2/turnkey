import streamDeck, {
	type Action,
	type DidReceiveSettingsEvent,
	type FeedbackPayload,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { HOLD_CONFIRM_MS } from "../core/approvals.js";
import type { Availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { openExternal, threadDeepLink } from "../core/commands.js";
import { FLASH_MS, failureLabel } from "../core/feedback.js";
import { messageTable, t } from "../core/i18n.js";
import { type CatalogModel, effortValues, favoriteModels, findModel, modelColor, pickableModels } from "../core/models.js";
import { COLORS, type GlyphName, maxEffortStyle, type Paint, providerGradient, renderNoticeKey, renderResultKey, renderReviewKey, stripCanvas, stripIcon } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { type ConfirmMode, confirmMode, Reviews } from "../core/review.js";
import { assignSlots, type SlotIndex } from "../core/slots.js";
import { pinnedKey, pinnedName, resolveTarget, type Target, type TargetSettings } from "../core/target.js";
import type { SendMode } from "../core/t3/machine.js";
import { normalizeEnvironmentUrl } from "../core/t3/pairing.js";
import { deck } from "../deck.js";

export const LONG_PRESS_MS = 500;
/** At most one animation write per instance in this long. */
export const FRAME_GAP_MS = 100;
const logger = streamDeck.logger.createScope("actions");

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Placement = { device: string; position?: { row: number; column: number } };

/** Repaints an instance whose review card expired or gave way to another's. */
const reviewEnded = new Map<string, () => void>();
const reviews = new Reviews((owner) => reviewEnded.get(owner)?.());

/** What a review card shows: what would happen, to which thread, with what, and how to go ahead. */
export type ReviewCard = { glyph: GlyphName; verb: string; target: string; body?: string; footer: string };

/**
 * A press that sends or changes something, for the Confirm setting: `scope` names the target and content (any
 * change reviews again), `detail` how this press would send (a mode); `held` is how long the press was held.
 */
export type Guard = { scope: string; detail?: string; held: number; card: () => ReviewCard; holdHint: string };

/** Every registered action, so the open inspector's checklist can ask the one it belongs to. */
export const deckActions = new Set<DeckAction<JsonObject>>();

/** Shared lifecycle: visibility drives the clock, every board change repaints visible instances. */
export abstract class DeckAction<T extends JsonObject = JsonObject> extends SingletonAction<T> {
	readonly #pressedAt = new Map<string, number>();
	readonly #settings = new Map<string, T>();
	readonly #placed = new Map<string, Placement>();
	/** Last image sent per key; the once-a-second clock repaints only what changed. */
	readonly #sent = new Map<string, string>();
	/** Last feedback sent per dial, item by item: a repaint sends only the items that changed. */
	readonly #fed = new Map<string, Map<string, string>>();
	/** Instances showing a press result; live repaints wait until it clears. */
	readonly #flashing = new Map<string, ReturnType<typeof setTimeout>>();
	/** When each instance last had an event-driven write, so an animation frame doesn't follow it too closely. */
	readonly #wroteAt = new Map<string, number>();
	/** Set while the animator paints a frame: such a paint is dropped when the instance was written too recently. */
	#frame = false;
	/** Instances showing a review card; live repaints wait until it is confirmed, expires or goes stale. */
	readonly #reviewing = new Set<string>();

	constructor() {
		super();
		deckActions.add(this as unknown as DeckAction<JsonObject>);
		deck.onRepaint(() => this.#repaintAll());
	}

	/** What the inspector's "What this action needs" lists; empty falls back to the shared table in needs.ts. */
	needs(_action: Action<T>): Need[] {
		return [];
	}

	/** This instance's settings, for the checklist built outside the class. */
	settingsFor(action: Action<T>): T {
		return this.settingsOf(action);
	}

	protected abstract paint(action: Action<T>): Promise<void> | void;

	/** Settings rewritten from an older shape, saved once; undefined when they are current. */
	protected migrateSettings(_settings: T): T | undefined {
		return undefined;
	}

	#store(action: Action<T>, settings: T): void {
		const migrated = this.migrateSettings(settings);
		this.#settings.set(action.id, migrated ?? settings);
		deck.board.pin(action.id, pinnedKey(migrated ?? settings));
		if (migrated !== undefined) void action.setSettings(migrated);
	}

	/**
	 * The thread this instance acts on: T3 Code's selection on its machine, or the thread its Target setting pins. A
	 * pinned thread's title is kept in the settings, so the key can still name it once it is archived or deleted.
	 */
	protected target(action: Action<T>): Target<DeckThread> {
		const settings = this.settingsOf(action);
		const target = targetOf(settings, this.machineOf(action));
		const title = target.pinned ? target.thread?.title : undefined;
		if (title !== undefined && title !== settings.threadTitle) {
			const next = { ...settings, threadTitle: title } as T;
			this.#settings.set(action.id, next);
			void action.setSettings(next);
		}
		return target;
	}

	protected settingsOf(action: Action<T>): T {
		return this.#settings.get(action.id) ?? ({} as T);
	}

	/** The machine (its URL) this instance follows; undefined follows every machine. Older `…/mcp` choices still match. */
	protected machineOf(action: Action<T>): string | undefined {
		const machine = this.settingsOf(action).machine;
		return typeof machine === "string" && machine !== "" ? normalizeEnvironmentUrl(machine) : undefined;
	}

	/** Keys of this action that fill positions together: by default, those following the same machine. */
	protected slotGroup(settings: T): string {
		return typeof settings.machine === "string" ? settings.machine : "";
	}

	/** A slot set by hand; actions without a slot setting always fill by position. */
	protected slotNumber(_settings: T): number | undefined {
		return undefined;
	}

	/** This key's place in its thread list, from its slot setting or its position on the device. */
	protected slotOf(action: Action<T>): SlotIndex {
		const keys = [...this.#placed].map(([id, placement]) => {
			const settings = this.#settings.get(id) ?? ({} as T);
			return { id, group: `${placement.device}|${this.slotGroup(settings)}`, position: placement.position, slot: this.slotNumber(settings) };
		});
		return assignSlots(keys).get(action.id) ?? 0;
	}

	/**
	 * An animation frame landing within `FRAME_GAP_MS` of an event-driven write (a board change, a turn, the marquee)
	 * is skipped, since that write already drew the current frame; the animator spaces frames themselves.
	 */
	#throttled(id: string): boolean {
		const now = Date.now();
		if (!this.#frame) this.#wroteAt.set(id, now);
		else if (now - (this.#wroteAt.get(id) ?? -Infinity) < FRAME_GAP_MS) return true;
		return false;
	}

	/** What a review on this instance covers right now; a card whose scope no longer matches gives way to the live face. */
	protected reviewScope(_action: Action<T>): string | undefined {
		return undefined;
	}

	/** Whether a press result or a review card holds the face. */
	#held(action: Action<T>): boolean {
		if (this.#flashing.has(action.id)) return true;
		if (!this.#reviewing.has(action.id)) return false;
		const scope = reviews.scope(action.id);
		if (scope !== undefined && scope === this.reviewScope(action)) return true;
		reviews.cancel(action.id);
		this.#endReview(action.id);
		return false;
	}

	#endReview(id: string): void {
		this.#reviewing.delete(id);
		reviewEnded.delete(id);
		this.forgetSent(id);
	}

	protected async setImage(action: Action<T>, image: string): Promise<void> {
		if (!action.isKey() || this.#held(action) || this.#sent.get(action.id) === image || this.#throttled(action.id)) return;
		this.#sent.set(action.id, image);
		await action.setImage(image);
	}

	/** Asks for frames while the face moves (a spinner, a pulse, a flash), and stops asking once it is still. */
	protected animate(action: Action<T>, moving: boolean): void {
		deck.animator.set(
			action.id,
			moving
				? () => {
						if (!this.#placed.has(action.id)) return deck.animator.set(action.id, undefined);
						this.#frame = true;
						try {
							void this.paint(action);
						} finally {
							this.#frame = false;
						}
					}
				: undefined,
		);
	}

	protected async setFeedback(action: Action<T>, feedback: FeedbackPayload): Promise<void> {
		if (!action.isDial() || this.#held(action)) return;
		const sent = this.#fed.get(action.id) ?? new Map<string, string>();
		const changed: FeedbackPayload = {};
		for (const [key, item] of Object.entries(feedback)) {
			if (sent.get(key) === JSON.stringify(item)) continue;
			changed[key] = item;
		}
		if (Object.keys(changed).length === 0 || this.#throttled(action.id)) return;
		for (const [key, item] of Object.entries(changed)) sent.set(key, JSON.stringify(item));
		this.#fed.set(action.id, sent);
		await action.setFeedback(changed);
	}

	/** Forgets what was sent, so the next paint sends every item: after a face drawn outside `setFeedback`. */
	protected forgetSent(id: string): void {
		this.#sent.delete(id);
		this.#fed.delete(id);
	}

	override onWillAppear(ev: WillAppearEvent<T>): void {
		this.#store(ev.action, ev.payload.settings);
		this.#placed.set(ev.action.id, { device: ev.action.device.id, position: ev.action.isKey() ? ev.action.coordinates : undefined });
		this.forgetSent(ev.action.id);
		deck.setVisible(ev.action.id, true);
		this.#repaintAll();
	}

	override onWillDisappear(ev: WillDisappearEvent<T>): void {
		this.#settings.delete(ev.action.id);
		deck.board.pin(ev.action.id, undefined);
		this.#placed.delete(ev.action.id);
		this.forgetSent(ev.action.id);
		clearTimeout(this.#flashing.get(ev.action.id));
		this.#flashing.delete(ev.action.id);
		this.#wroteAt.delete(ev.action.id);
		deck.animator.set(ev.action.id, undefined);
		reviews.cancel(ev.action.id);
		this.#endReview(ev.action.id);
		deck.setVisible(ev.action.id, false);
		this.#repaintAll();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<T>): void {
		this.#store(ev.action, ev.payload.settings);
		this.#repaintAll();
	}

	/** One key's position or slot moves the others, so every visible instance repaints; `#sent` drops repeats. */
	#repaintAll(): void {
		for (const action of this.actions) if (this.#placed.has(action.id)) void this.paint(action);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, T>): Promise<void> {
		const payload = ev.payload as { event?: string; url?: string; link?: string } | null;
		switch (payload?.event) {
			case "retry":
				return deck.retry(payload.url);
			case "signOut":
				if (payload.url) await deck.signOut(payload.url);
				return;
			case "remove":
				if (payload.url) await deck.remove(payload.url);
				return;
			case "pair":
				if (payload.link) await deck.pair(payload.link);
				return;
			case "selectMachine": {
				const settings = { ...this.settingsOf(ev.action), machine: payload.url ?? "" } as T;
				this.#settings.set(ev.action.id, settings);
				await ev.action.setSettings(settings);
				this.#repaintAll();
				await this.#sendProjects(ev.action);
				return deck.pushStatus(true);
			}
			case "status":
				return deck.pushStatus(true);
			case "strings":
				return streamDeck.ui.sendToPropertyInspector({ event: "strings", strings: messageTable("inspector") });
			case "getProjects":
				return this.#sendProjects(ev.action);
			case "getLaunchProjects":
				return this.#sendProjects(ev.action, "getLaunchProjects");
			case "getModels":
				return this.#sendModels(ev.action);
			case "getEfforts":
				return this.#sendEfforts(ev.action);
			case "getThreads":
				return this.#sendThreads(ev.action);
		}
	}

	#readyMachines(action: Action<T>) {
		const url = this.machineOf(action);
		return deck.machines.filter((machine) => machine.state.kind === "ready" && (url === undefined || machine.url === url));
	}

	/** The Model key's choices: T3 Code's favorites (or every visible model), read fresh as the inspector opens. */
	async #sendModels(action: Action<T>): Promise<void> {
		await deck.refreshConfigs(this.machineOf(action));
		const machines = this.#readyMachines(action);
		const favorites = machines.some((machine) => favoriteModels(machine.modelConfig) !== undefined);
		const items = [{ label: t(favorites ? "datasource.cycleFavorites" : "datasource.cycleModels"), value: "" }];
		for (const machine of machines) {
			for (const model of pickableModels(machine.modelConfig)) if (!items.some((item) => item.value === model.key)) items.push({ label: model.label, value: model.key });
		}
		await streamDeck.ui.sendToPropertyInspector({ event: "getModels", items });
	}

	async #sendEfforts(action: Action<T>): Promise<void> {
		await deck.refreshConfigs(this.machineOf(action));
		const items = [{ label: t("datasource.cycleEfforts"), value: "" }];
		for (const machine of this.#readyMachines(action)) {
			for (const effort of effortValues(machine.modelConfig)) if (!items.some((item) => item.value === effort.value)) items.push(effort);
		}
		await streamDeck.ui.sendToPropertyInspector({ event: "getEfforts", items });
	}

	/**
	 * The Target setting's choices: every thread on the action's machine (or all), listed or settled or snoozed, newest
	 * first. A pinned thread that is gone stays in the list as "Not available", so the saved choice keeps showing.
	 */
	async #sendThreads(action: Action<T>): Promise<void> {
		const machines = this.#readyMachines(action);
		const items: { label: string; value: string }[] = [];
		for (const machine of machines) {
			const where = machines.length > 1 && machine.state.kind === "ready" ? ` · ${machine.state.label}` : "";
			const environmentId = machine.environmentId;
			if (environmentId === undefined) continue;
			for (const row of machine.everyRow) {
				const project = machine.isScratch(row.projectId) ? t("datasource.noProject") : row.projectTitle;
				items.push({ label: `${row.title}${project ? ` · ${project}` : ""}${where}`, value: `${environmentId}/${row.threadId}` });
			}
		}
		const settings = this.settingsOf(action);
		const saved = pinnedKey(settings);
		if (saved && !items.some((item) => item.value === saved)) items.unshift({ label: t("reason.targetGone", { thread: pinnedName(settings) }), value: saved });
		await streamDeck.ui.sendToPropertyInspector({ event: "getThreads", items });
	}

	/**
	 * sdpi-components' project datasources: the projects of the action's machine, or of every machine. Activity's
	 * starts with "Any project"; New Thread's lists real projects only, since "No project" is its own choice.
	 */
	async #sendProjects(action: Action<T>, event: "getProjects" | "getLaunchProjects" = "getProjects"): Promise<void> {
		const machines = this.#readyMachines(action);
		const items = event === "getProjects" ? [{ label: t("datasource.anyProject"), value: "" }] : [];
		for (const machine of machines) {
			const where = machines.length > 1 && machine.state.kind === "ready" ? ` · ${machine.state.label}` : "";
			for (const project of machine.projects) {
				const scratch = machine.isScratch(project.id);
				if (scratch && event === "getLaunchProjects") continue;
				items.push({ label: `${scratch ? t("datasource.noProject") : project.title}${where}`, value: project.id });
			}
		}
		await streamDeck.ui.sendToPropertyInspector({ event, items });
	}

	protected pressStarted(id: string): void {
		this.#pressedAt.set(id, Date.now());
	}

	/** How long the press that just ended was held, in ms. */
	protected heldFor(id: string): number {
		const started = this.#pressedAt.get(id);
		this.#pressedAt.delete(id);
		return started === undefined ? 0 : Date.now() - started;
	}

	protected wasLongPress(id: string): boolean {
		return this.heldFor(id) >= LONG_PRESS_MS;
	}

	/** Shows a press result on the key or strip for a moment, then the live face again. */
	protected async flash(action: Action<T>, ok: boolean, label: string): Promise<void> {
		// A result ends any review this instance showed, so the live face comes back after it.
		this.#dropReview(action.id);
		clearTimeout(this.#flashing.get(action.id));
		this.#flashing.set(
			action.id,
			setTimeout(() => {
				this.#flashing.delete(action.id);
				this.forgetSent(action.id);
				if (this.#placed.has(action.id)) void this.paint(action);
			}, FLASH_MS),
		);
		if (action.isKey()) await action.setImage(renderResultKey({ ok, label }));
		else if (action.isDial()) await action.setFeedback(this.flashFeedback(action, ok, label));
	}

	/** A dial's press result; strip dials draw it in their own appearance. */
	protected flashFeedback(_action: Action<T>, ok: boolean, label: string): FeedbackPayload {
		const color = ok ? COLORS.done : COLORS.error;
		return { canvas: stripCanvas(color), header: ok ? t("strip.done") : t("strip.notNow"), glyph: stripIcon(ok ? "check" : "error", color), value: label, detail: "" };
	}

	/** The action's Confirm before sending setting, else the global one. */
	protected confirmModeOf(action: Action<T>): ConfirmMode {
		return confirmMode(this.settingsOf(action).confirmSend, deck.appearance.confirmSend);
	}

	/**
	 * Whether a press may go ahead under the Confirm setting, with the detail it was reviewed with; undefined holds
	 * it back. Under Review the first press shows `card` instead, and only a second press (750 ms to 10 s later,
	 * nothing changed) goes ahead; under Hold a press must be held.
	 */
	protected async guard(action: Action<T>, guard: Guard): Promise<string | undefined> {
		const detail = guard.detail ?? "";
		const mode = this.confirmModeOf(action);
		if (mode !== "review") this.#dropReview(action.id);
		switch (mode) {
			case "off":
				return detail;
			case "hold":
				if (guard.held >= HOLD_CONFIRM_MS) return detail;
				await this.flash(action, false, guard.holdHint);
				return undefined;
		}
		const press = reviews.press(action.id, guard.scope, detail);
		if (press.kind === "wait") return undefined;
		if (press.kind === "confirm") {
			this.#endReview(action.id);
			return press.detail;
		}
		clearTimeout(this.#flashing.get(action.id));
		this.#flashing.delete(action.id);
		this.#reviewing.add(action.id);
		reviewEnded.set(action.id, () => {
			this.#endReview(action.id);
			if (this.#placed.has(action.id)) void this.paint(action);
		});
		const card = guard.card();
		// A key has room for a short footer only; the verb already says what goes.
		if (action.isKey()) await action.setImage(renderReviewKey({ ...card, footer: t("review.pressAgain") }));
		else if (action.isDial()) await action.setFeedback(this.reviewFeedback(action, card));
		return undefined;
	}

	/** Drops this instance's review card, if it shows one: the dial turned. */
	protected cancelReview(action: Action<T>): void {
		this.#dropReview(action.id);
	}

	#dropReview(id: string): void {
		reviews.cancel(id);
		if (this.#reviewing.has(id)) this.#endReview(id);
	}

	/** What this instance's pending review of `scope` would do, if one is showing: a second press acts on that. */
	protected reviewed(action: Action<T>, scope: string | undefined): string | undefined {
		return scope === undefined ? undefined : reviews.detail(action.id, scope);
	}

	/** A dial's review card. */
	protected reviewFeedback(_action: Action<T>, card: ReviewCard): FeedbackPayload {
		return { canvas: stripCanvas(COLORS.accent), header: card.verb, glyph: stripIcon(card.glyph, COLORS.accent), value: card.body ?? card.target, detail: card.footer };
	}

	/** Flashes why the action can't act when `check` says so; true when it may go ahead. */
	protected async allowed(action: Action<T>, check: Availability): Promise<boolean> {
		if (check.available) return true;
		await this.flash(action, false, check.reason);
		return false;
	}

	/** Runs a deck command, then flashes `success`, or a short reason (logged in full) when it fails. */
	/** Runs a press's work: a success just shows the live face again, a failure shows why for a moment. */
	protected async run(action: Action<T>, work: () => Promise<unknown>): Promise<void> {
		try {
			await work();
			await this.paint(action);
		} catch (error) {
			// The message only: errors never carry tokens or ticket URLs, but their causes might.
			logger.warn(`${this.manifestId} failed: ${message(error)}`);
			await this.flash(action, false, failureLabel(error));
		}
	}
}

export const colorStyle = () => maxEffortStyle(deck.appearance.maxEffort);

/** Fast's paint: the model's gradient (or its color), the accent for white marks unless gradients are on. */
export const speedPaint = (model: CatalogModel | undefined): Paint => {
	const color = model && modelColor(model);
	return colorStyle() === "gradient" ? { gradient: providerGradient(color ?? COLORS.accent) } : (color ?? COLORS.accent);
};

/** Sends `text` to an existing thread, with T3 Code's Ultrathink prefix while the deck has it armed there. */
export function sendToThread(thread: DeckThread, text: string, mode: SendMode): Promise<void> {
	return thread.machine.send(thread, ultrathinkPrompt(thread, text), mode);
}

/** `text` as the deck sends it to `thread`. */
export const ultrathinkPrompt = (thread: DeckThread, text: string): string =>
	deck.ultrathink.prompt(thread.key, findModel(thread.machine.modelConfig, thread.model), text);

/** Whether Ultrathink is armed for `thread` and its model still offers it. */
export const ultrathinkArmed = (thread: DeckThread | undefined): boolean =>
	thread !== undefined && deck.ultrathink.armed(thread.key, findModel(thread.machine.modelConfig, thread.model));

/** Selects the thread the way T3 Code's own open does, and opens it in the desktop app. */
export async function openThread(thread: DeckThread): Promise<void> {
	selectThread(thread);
	await openExternal(threadDeepLink(thread, deck.scheme));
}

/** Selects the thread without opening the app; a failed visit only leaves T3 Code's stamp behind. */
export function selectThread(thread: Pick<DeckThread, "key" | "machine">): void {
	void deck.board.select(thread.key, thread.machine.url).catch((error: unknown) => logger.warn(`Selecting a thread failed: ${message(error)}`));
}

export type ConnectionProblem = "none" | "missing" | "pair" | "offline";

/** Why an action pinned to `machine` (or following all) cannot show threads yet, if it cannot. */
export function connectionProblem(machine?: string): ConnectionProblem | undefined {
	const machines = deck.machines;
	if (machines.length === 0) return "none";
	if (machine === undefined) {
		if (machines.some((candidate) => candidate.state.kind === "ready")) return undefined;
		return machines.every((candidate) => candidate.state.kind === "signed-out") ? "pair" : "offline";
	}
	const target = machines.find((candidate) => candidate.url === machine);
	if (target === undefined) return "missing";
	return target.state.kind === "ready" ? undefined : target.state.kind === "signed-out" ? "pair" : "offline";
}

/** The face shown instead of normal content while the action's machine is not usable. */
export function connectionFace(machine?: string): string | undefined {
	switch (connectionProblem(machine)) {
		case "none":
			return renderNoticeKey({ glyph: "plug", title: t("notice.openT3Code"), detail: t("notice.thenPress"), tone: "muted" });
		case "missing":
			return renderNoticeKey({ glyph: "plug", title: t("notice.machineRemoved"), detail: t("notice.pickAnotherMachine"), tone: "muted" });
		case "pair":
			return renderNoticeKey({ glyph: "key", title: t("notice.pairDeck"), detail: t("notice.pastePairLink"), tone: "attention" });
		case "offline":
			return renderNoticeKey({ glyph: "plug", title: t("notice.connecting"), detail: t("notice.pressToRetry"), tone: "muted" });
		default:
			return undefined;
	}
}

/** A key pressed while its machine is unusable retries the connection; pairing itself happens in settings. */
export async function pressWhileDisconnected(machine?: string): Promise<boolean> {
	if (connectionProblem(machine) === undefined) return false;
	await deck.retry(machine);
	return true;
}

/** Whether the machine that owns `thread` (or any machine) may act, not just read. */
export const canOperate = (thread?: DeckThread): boolean =>
	thread !== undefined ? thread.machine.canOperate : deck.machines.some((machine) => machine.canOperate);

/** The thread every "selected thread" action targets: T3 Code's selection on the action's machine, or across all. */
export const selectedThread = (machine?: string): DeckThread | undefined => deck.board.selectedOn(machine);

/** The thread an action with these settings acts on: the selection on `machine`, or the thread its Target pins. */
export const targetOf = (settings: TargetSettings, machine?: string): Target<DeckThread> =>
	resolveTarget(settings, () => selectedThread(machine), (key) => deck.board.lookup(key));
