import { type Action, action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { DeckThread } from "../core/board.js";
import { launch, organize, type OrganizeAction, send, stop } from "../core/commands.js";
import { COLORS, elapsed, type GlyphName, renderKey, STATE_COLOR, STATE_GLYPH } from "../core/render.js";
import { isActive } from "../core/t3.js";
import { deck } from "../deck.js";
import { connectionFace, DeckAction, openThread, preferredThread } from "./base.js";

const ID = "com.alejandrom2.t3deck";

function threadFace(thread: DeckThread | undefined, emptyLabel: string): string {
	if (thread === undefined) return renderKey({ glyph: "idle", label: emptyLabel, color: COLORS.dim });
	const detail = isActive(thread.status) ? elapsed(thread.activeSince, Date.now()) : thread.deck === "approval" ? "approve" : thread.deck === "question" ? "answer" : thread.projectTitle;
	return renderKey({
		glyph: STATE_GLYPH[thread.deck],
		color: STATE_COLOR[thread.deck],
		label: thread.title,
		detail,
		badge: thread.unseen ? STATE_COLOR[thread.deck] : undefined,
	});
}

type SlotSettings = { slot?: number | string; machine?: string };

/** Slot N of the board (0 = the focused thread). Tap opens it in T3 Code; hold focuses it for the dials. */
@action({ UUID: `${ID}.slot` })
export class ThreadSlot extends DeckAction<SlotSettings> {
	#threadFor(settings: SlotSettings): DeckThread | undefined {
		const slot = Number(settings.slot ?? 1);
		const machine = settings.machine || undefined;
		return slot <= 0 ? deck.board.focusedOn(machine) : deck.board.threadsOn(machine)[slot - 1];
	}

	protected override async paint(action: Action<SlotSettings>): Promise<void> {
		if (!action.isKey()) return;
		await this.setImage(action, connectionFace(this.machineOf(action)) ?? threadFace(this.#threadFor(this.settingsOf(action)), "No thread"));
	}

	override onKeyDown(ev: KeyDownEvent<SlotSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<SlotSettings>): Promise<void> {
		const long = this.wasLongPress(ev.action.id);
		if (connectionFace(this.machineOf(ev.action)) !== undefined) return void (await deck.signIn(this.machineOf(ev.action)));
		const thread = this.#threadFor(ev.payload.settings);
		if (thread === undefined) return;
		if (long) deck.board.focus(thread.key);
		else await this.run(ev.action, () => openThread(thread));
	}
}

/** Board summary: how many turns run and how many need you. Tap jumps to the thread that needs you most. */
@action({ UUID: `${ID}.activity` })
export class Activity extends DeckAction {
	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const machine = this.machineOf(action);
		const face = connectionFace(machine);
		if (face !== undefined) return void (await this.setImage(action, face));
		const threads = deck.board.threadsOn(machine);
		const blocked = threads.filter((thread) => thread.deck === "approval" || thread.deck === "question").length;
		const running = threads.filter((thread) => isActive(thread.status)).length;
		const unseen = threads.filter((thread) => thread.unseen).length;
		const [glyph, color, label]: [GlyphName, string, string] =
			blocked > 0
				? ["shield", COLORS.attention, `${blocked} need you`]
				: running > 0
					? ["running", COLORS.accent, `${running} running`]
					: unseen > 0
						? ["check", COLORS.done, `${unseen} done`]
						: ["idle", COLORS.muted, "All quiet"];
		await this.setImage(action, renderKey({ glyph, color, label, detail: blocked > 0 && running > 0 ? `${running} running` : undefined }));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (connectionFace(this.machineOf(ev.action)) !== undefined) return void (await deck.signIn(this.machineOf(ev.action)));
		const target = deck.board.threadsOn(this.machineOf(ev.action))[0];
		if (target !== undefined) await this.run(ev.action, () => openThread(target));
	}
}

const stopTarget = (machine?: string): DeckThread | undefined => {
	const focused = preferredThread(machine);
	return focused !== undefined && isActive(focused.status) ? focused : deck.board.threadsOn(machine).find((thread) => isActive(thread.status));
};

/** Interrupts the focused turn, or the most urgent running one. */
@action({ UUID: `${ID}.stop` })
export class Stop extends DeckAction {
	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const target = stopTarget(this.machineOf(action));
		await this.setImage(action, renderKey({ glyph: "stop", color: COLORS.error, dimmed: target === undefined || !deck.canOperate }));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		const target = stopTarget(this.machineOf(ev.action));
		if (target !== undefined) await this.run(ev.action, () => stop(target));
	}
}

type PromptSettings = { prompt?: string; label?: string };

/** Sends a saved prompt to the focused thread: tap starts, steers or queues; hold interrupts and restarts with it. */
@action({ UUID: `${ID}.send` })
export class SendPrompt extends DeckAction<PromptSettings> {
	protected override async paint(action: Action<PromptSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { prompt, label } = this.settingsOf(action);
		const ready = Boolean(prompt?.trim()) && preferredThread(this.machineOf(action)) !== undefined && deck.canOperate;
		await this.setImage(action, renderKey({ glyph: "send", label: label || (prompt ? prompt : "Set prompt"), dimmed: !ready }));
	}

	override onKeyDown(ev: KeyDownEvent<PromptSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<PromptSettings>): Promise<void> {
		const restart = this.wasLongPress(ev.action.id);
		const prompt = ev.payload.settings.prompt?.trim();
		const thread = preferredThread(this.machineOf(ev.action));
		if (!prompt || thread === undefined) return void (await ev.action.showAlert());
		await this.run(ev.action, () => send(thread, prompt, restart ? "restart" : "auto"));
	}
}

type NewThreadSettings = { prompt?: string; title?: string };

/** Starts a new thread with a saved prompt in the focused thread's project. */
@action({ UUID: `${ID}.new` })
export class NewThread extends DeckAction<NewThreadSettings> {
	protected override async paint(action: Action<NewThreadSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { prompt, title } = this.settingsOf(action);
		const near = preferredThread(this.machineOf(action));
		await this.setImage(action, 
			renderKey({ glyph: "plus", label: title || "New thread", detail: near?.projectTitle, dimmed: !prompt?.trim() || near === undefined || !deck.canOperate }),
		);
	}

	override async onKeyUp(ev: KeyUpEvent<NewThreadSettings>): Promise<void> {
		const prompt = ev.payload.settings.prompt?.trim();
		const near = preferredThread(this.machineOf(ev.action));
		if (!prompt || near === undefined) return void (await ev.action.showAlert());
		const title = ev.payload.settings.title?.trim() || prompt.slice(0, 60);
		await this.run(ev.action, async () => {
			const created = await launch(near, prompt, title);
			deck.board.focus(`${near.environmentId}/${created.threadId}`);
		});
	}
}

type OrganizeSettings = { organize?: OrganizeAction; snoozeMinutes?: number | string };

const ORGANIZE_FACE: Record<OrganizeAction, [GlyphName, string]> = {
	settle: ["settle", "Settle"],
	pin: ["pin", "Pin"],
	unpin: ["pin", "Unpin"],
	snooze: ["moon", "Snooze"],
	archive: ["archive", "Archive"],
	mark_unread: ["chat", "Unread"],
};

/** Settle, pin, snooze, archive or mark the focused thread unread; the reverse lives in T3 Code or another key. */
@action({ UUID: `${ID}.organize` })
export class Organize extends DeckAction<OrganizeSettings> {
	protected override async paint(action: Action<OrganizeSettings>): Promise<void> {
		if (!action.isKey()) return;
		const [glyph, label] = ORGANIZE_FACE[this.settingsOf(action).organize ?? "settle"];
		await this.setImage(action, renderKey({ glyph, label, dimmed: preferredThread(this.machineOf(action)) === undefined || !deck.canOperate }));
	}

	override async onKeyUp(ev: KeyUpEvent<OrganizeSettings>): Promise<void> {
		const thread = preferredThread(this.machineOf(ev.action));
		if (thread === undefined) return;
		const { organize: which = "settle", snoozeMinutes } = ev.payload.settings;
		await this.run(ev.action, () => organize(thread, which, Number(snoozeMinutes ?? 60)));
	}
}
