import { type Action, action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { DeckThread } from "../core/board.js";
import { organize, type OrganizeAction } from "../core/commands.js";
import { elapsed, type GlyphName, renderControlKey, renderNoticeKey, renderThreadKey } from "../core/render.js";
import { deck } from "../deck.js";
import { canOperate, connectionFace, DeckAction, openThread, preferredThread, pressWhileDisconnected } from "./base.js";

const ID = "com.alejandrom2.t3deck";

function threadFace(thread: DeckThread | undefined, emptyLabel: string): string {
	if (thread === undefined) return renderNoticeKey({ glyph: "chat", title: emptyLabel, tone: "muted" });
	return renderThreadKey({
		state: thread.deck,
		title: thread.title,
		meta: thread.active ? elapsed(thread.activeSince, Date.now()) : undefined,
		diff: thread.active ? undefined : thread.machine.turnDiff(thread),
		unseen: thread.unseen,
	});
}

type SlotSettings = { slot?: number | string; machine?: string };

/** Slot N of the board (0 = the focused thread). Tap opens it in T3 Code; hold focuses it for the dials. */
@action({ UUID: `${ID}.slot` })
export class ThreadSlot extends DeckAction<SlotSettings> {
	#threadFor(action: Action<SlotSettings>): DeckThread | undefined {
		const slot = Number(this.settingsOf(action).slot ?? 1);
		const machine = this.machineOf(action);
		return slot <= 0 ? deck.board.focusedOn(machine) : deck.board.threadsOn(machine)[slot - 1];
	}

	protected override async paint(action: Action<SlotSettings>): Promise<void> {
		if (!action.isKey()) return;
		await this.setImage(action, connectionFace(this.machineOf(action)) ?? threadFace(this.#threadFor(action), "No thread"));
	}

	override onKeyDown(ev: KeyDownEvent<SlotSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<SlotSettings>): Promise<void> {
		const long = this.wasLongPress(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const thread = this.#threadFor(ev.action);
		if (thread === undefined) return;
		if (long) deck.board.focus(thread.key);
		else await this.run(ev.action, () => openThread(thread));
	}
}

/** The thread that needs you most. Tap opens it. */
@action({ UUID: `${ID}.activity` })
export class Activity extends DeckAction {
	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const machine = this.machineOf(action);
		await this.setImage(action, connectionFace(machine) ?? threadFace(deck.board.threadsOn(machine)[0], "All quiet"));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const target = deck.board.threadsOn(this.machineOf(ev.action))[0];
		if (target !== undefined) await this.run(ev.action, () => openThread(target));
	}
}

const stopTarget = (machine?: string): DeckThread | undefined => {
	const focused = preferredThread(machine);
	return focused?.active ? focused : deck.board.threadsOn(machine).find((thread) => thread.active);
};

/** Stops the focused turn, or the most urgent running one. */
@action({ UUID: `${ID}.stop` })
export class Stop extends DeckAction {
	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const target = stopTarget(this.machineOf(action));
		await this.setImage(action, renderControlKey({ glyph: "stop", primary: true, available: target !== undefined && canOperate(target) }));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		const target = stopTarget(this.machineOf(ev.action));
		if (target !== undefined) await this.run(ev.action, () => target.machine.stopRun(target));
	}
}

type PromptSettings = { prompt?: string; label?: string };

/** Sends a saved prompt to the focused thread: tap starts, steers or queues; hold interrupts and restarts with it. */
@action({ UUID: `${ID}.send` })
export class SendPrompt extends DeckAction<PromptSettings> {
	protected override async paint(action: Action<PromptSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { prompt, label } = this.settingsOf(action);
		const thread = preferredThread(this.machineOf(action));
		const ready = Boolean(prompt?.trim()) && thread !== undefined && canOperate(thread);
		await this.setImage(action, renderControlKey({ glyph: "send", primary: true, label: label || undefined, available: ready }));
	}

	override onKeyDown(ev: KeyDownEvent<PromptSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<PromptSettings>): Promise<void> {
		const restart = this.wasLongPress(ev.action.id);
		const prompt = ev.payload.settings.prompt?.trim();
		const thread = preferredThread(this.machineOf(ev.action));
		if (!prompt || thread === undefined) return void (await ev.action.showAlert());
		await this.run(ev.action, () => thread.machine.send(thread, prompt, restart ? "restart" : "auto"));
	}
}

type NewThreadSettings = { prompt?: string; title?: string };

/** The machine a new thread starts on when no thread is near: the action's machine, else the first ready one. */
const launchMachine = (machine?: string) => deck.machines.find((candidate) => candidate.canOperate && (machine === undefined || candidate.url === machine));

/**
 * Starts a thread with `prompt` in `near`'s project, or in the scratch project when the board is empty.
 * Focuses it once the shell lists it.
 */
export async function startThread(near: DeckThread | undefined, machine: string | undefined, prompt: string, title?: string): Promise<void> {
	const target = near?.machine ?? launchMachine(machine);
	if (target === undefined) throw new Error("No machine can start threads.");
	const created = await target.launch(near ? { projectId: near.projectId } : { scratch: true }, prompt, { title, fallbackModel: near?.model });
	deck.board.focus(`${target.environmentId}/${created.threadId}`);
}

/** Starts a new thread with a saved prompt in the focused thread's project. */
@action({ UUID: `${ID}.new` })
export class NewThread extends DeckAction<NewThreadSettings> {
	protected override async paint(action: Action<NewThreadSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { prompt, title } = this.settingsOf(action);
		const machine = this.machineOf(action);
		const near = preferredThread(machine);
		const able = near !== undefined ? canOperate(near) : launchMachine(machine) !== undefined;
		await this.setImage(action, renderControlKey({ glyph: "compose", label: title || undefined, available: Boolean(prompt?.trim()) && able }));
	}

	override async onKeyUp(ev: KeyUpEvent<NewThreadSettings>): Promise<void> {
		const prompt = ev.payload.settings.prompt?.trim();
		if (!prompt) return void (await ev.action.showAlert());
		const machine = this.machineOf(ev.action);
		await this.run(ev.action, () => startThread(preferredThread(machine), machine, prompt, ev.payload.settings.title));
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
		const thread = preferredThread(this.machineOf(action));
		await this.setImage(action, renderControlKey({ glyph, label, available: thread !== undefined && canOperate(thread) }));
	}

	override async onKeyUp(ev: KeyUpEvent<OrganizeSettings>): Promise<void> {
		const thread = preferredThread(this.machineOf(ev.action));
		if (thread === undefined) return;
		const { organize: which = "settle", snoozeMinutes } = ev.payload.settings;
		await this.run(ev.action, () => organize(thread, which, Number(snoozeMinutes ?? 60) || 60));
	}
}
