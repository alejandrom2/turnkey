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
import type { AccessLevel } from "../core/oauth.js";
import { renderKey } from "../core/render.js";
import { deck } from "../deck.js";

export const LONG_PRESS_MS = 500;
const logger = streamDeck.logger.createScope("actions");

/** Shared lifecycle: visibility drives polling, every board change repaints visible instances. */
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

	/** The machine (MCP URL) this instance follows; undefined follows every machine. */
	protected machineOf(action: Action<T>): string | undefined {
		const machine = this.settingsOf(action).machine;
		return typeof machine === "string" && machine !== "" ? machine : undefined;
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
		const payload = ev.payload as { event?: string; url?: string; link?: string; access?: AccessLevel } | null;
		switch (payload?.event) {
			case "signIn":
				return deck.signIn(payload.url);
			case "signOut":
				if (payload.url) await deck.signOut(payload.url);
				return;
			case "remove":
				if (payload.url) await deck.remove(payload.url);
				return;
			case "pair":
				if (payload.link) await deck.pair(payload.link, payload.access ?? "approval-required");
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
			void deck.board.refresh(true);
		} catch (error) {
			logger.warn(`${this.manifestId} failed`, error);
			if (action.isKey() || action.isDial()) await action.showAlert();
		}
	}
}

export async function openThread(thread: DeckThread): Promise<void> {
	deck.board.focus(thread.key);
	deck.board.markSeen(thread.key);
	await openExternal(threadDeepLink(thread, deck.scheme));
}

/** Why an action pinned to `machine` (or following all) cannot show threads yet, if it cannot. */
export function connectionProblem(machine?: string): "none" | "missing" | "sign-in" | undefined {
	if (deck.connections.length === 0) return "none";
	if (machine === undefined) return deck.needsSignIn ? "sign-in" : undefined;
	const connection = deck.connections.find((candidate) => candidate.url === machine);
	if (connection === undefined) return "missing";
	return connection.state.kind === "ready" ? undefined : "sign-in";
}

/** The face shown instead of normal content while the action's machine is not usable. */
export function connectionFace(machine?: string): string | undefined {
	switch (connectionProblem(machine)) {
		case "none":
			return renderKey({ glyph: "plug", label: "Open T3 Code", detail: "then press", color: "#8A8F98" });
		case "missing":
			return renderKey({ glyph: "plug", label: "Machine removed", detail: "pick another", color: "#8A8F98" });
		case "sign-in":
			return renderKey({ glyph: "key", label: "Sign in", detail: "press", color: "#FF8549" });
		default:
			return undefined;
	}
}

export const preferredThread = (machine?: string): DeckThread | undefined => deck.board.focusedOn(machine);
