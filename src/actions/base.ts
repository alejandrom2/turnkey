import streamDeck, {
	type Action,
	type DidReceiveSettingsEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import type { DeckThread } from "../core/board.js";
import { openExternal, threadDeepLink } from "../core/commands.js";
import { renderNoticeKey } from "../core/render.js";
import { normalizeEnvironmentUrl } from "../core/t3/pairing.js";
import { deck } from "../deck.js";

export const LONG_PRESS_MS = 500;
const logger = streamDeck.logger.createScope("actions");

/** Shared lifecycle: visibility drives the clock, every board change repaints visible instances. */
export abstract class DeckAction<T extends JsonObject = JsonObject> extends SingletonAction<T> {
	readonly #pressedAt = new Map<string, number>();
	readonly #settings = new Map<string, T>();
	/** Last image or feedback sent per instance; the once-a-second clock repaints only what changed. */
	readonly #sent = new Map<string, string>();

	constructor() {
		super();
		deck.onRepaint(() => {
			for (const action of this.actions) void this.paint(action);
		});
	}

	protected abstract paint(action: Action<T>): Promise<void> | void;

	protected settingsOf(action: Action<T>): T {
		return this.#settings.get(action.id) ?? ({} as T);
	}

	/** The machine (its URL) this instance follows; undefined follows every machine. Older `…/mcp` choices still match. */
	protected machineOf(action: Action<T>): string | undefined {
		const machine = this.settingsOf(action).machine;
		return typeof machine === "string" && machine !== "" ? normalizeEnvironmentUrl(machine) : undefined;
	}

	protected async setImage(action: Action<T>, image: string): Promise<void> {
		if (!action.isKey() || this.#sent.get(action.id) === image) return;
		this.#sent.set(action.id, image);
		await action.setImage(image);
	}

	protected async setFeedback(action: Action<T>, feedback: Record<string, string>): Promise<void> {
		const signature = JSON.stringify(feedback);
		if (!action.isDial() || this.#sent.get(action.id) === signature) return;
		this.#sent.set(action.id, signature);
		await action.setFeedback(feedback);
	}

	override async onWillAppear(ev: WillAppearEvent<T>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings);
		this.#sent.delete(ev.action.id);
		deck.setVisible(ev.action.id, true);
		await this.paint(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent<T>): void {
		this.#settings.delete(ev.action.id);
		this.#sent.delete(ev.action.id);
		deck.setVisible(ev.action.id, false);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<T>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings);
		await this.paint(ev.action);
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
				await this.paint(ev.action);
				return deck.pushStatus(true);
			}
			case "status":
				return deck.pushStatus(true);
		}
	}

	protected pressStarted(id: string): void {
		this.#pressedAt.set(id, Date.now());
	}

	protected wasLongPress(id: string): boolean {
		const started = this.#pressedAt.get(id);
		this.#pressedAt.delete(id);
		return started !== undefined && Date.now() - started >= LONG_PRESS_MS;
	}

	/** Runs a deck command, flashing the key or dial red with a logged reason when it fails. */
	protected async run(action: Action<T>, work: () => Promise<unknown>): Promise<void> {
		try {
			await work();
			if (action.isKey()) await action.showOk();
		} catch (error) {
			// The message only: errors never carry tokens or ticket URLs, but their causes might.
			logger.warn(`${this.manifestId} failed: ${error instanceof Error ? error.message : String(error)}`);
			if (action.isKey() || action.isDial()) await action.showAlert();
		}
	}
}

export async function openThread(thread: DeckThread): Promise<void> {
	deck.board.focus(thread.key);
	void deck.board.markSeen(thread.key).catch(() => undefined);
	await openExternal(threadDeepLink(thread, deck.scheme));
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
			return renderNoticeKey({ glyph: "plug", title: "Open T3 Code", detail: "then press", tone: "muted" });
		case "missing":
			return renderNoticeKey({ glyph: "plug", title: "Machine removed", detail: "Pick another machine", tone: "muted" });
		case "pair":
			return renderNoticeKey({ glyph: "key", title: "Pair T3 Deck", detail: "Paste a pair link in settings", tone: "attention" });
		case "offline":
			return renderNoticeKey({ glyph: "plug", title: "Connecting…", detail: "Press to retry", tone: "muted" });
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

export const preferredThread = (machine?: string): DeckThread | undefined => deck.board.focusedOn(machine);
