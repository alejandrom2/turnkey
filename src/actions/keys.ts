import { type Action, action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { organize, type OrganizeAction } from "../core/commands.js";
import { elapsed, type GlyphName, renderControlKey, renderNoticeKey, renderThreadKey } from "../core/render.js";
import { matchesFilter, type SlotIndex, slotSetting, threadFilter } from "../core/slots.js";
import { deck } from "../deck.js";
import { canOperate, connectionFace, DeckAction, openThread, pressWhileDisconnected, selectedThread, selectThread } from "./base.js";

const ID = "com.alejandrom2.t3deck";

function threadFace(thread: DeckThread | undefined, emptyLabel: string, selected: DeckThread | undefined): string {
	if (thread === undefined) return renderNoticeKey({ glyph: "chat", title: emptyLabel, tone: "muted" });
	return renderThreadKey({
		state: thread.deck,
		title: thread.title,
		meta: thread.active ? elapsed(thread.activeSince, Date.now()) : undefined,
		diff: thread.active ? undefined : thread.machine.turnDiff(thread),
		unseen: thread.unseen,
		selected: thread.key === selected?.key,
	});
}

const pick = (threads: readonly DeckThread[], slot: SlotIndex, machine?: string): DeckThread | undefined =>
	slot === "selected" ? selectedThread(machine) : threads[slot];

type SlotSettings = { slot?: number | string; machine?: string };

/** A board slot: by position on the device, by number, or the selected thread. Tap opens it in T3 Code; hold selects it. */
@action({ UUID: `${ID}.slot` })
export class ThreadSlot extends DeckAction<SlotSettings> {
	protected override slotNumber(settings: SlotSettings): number | undefined {
		return slotSetting(settings.slot);
	}

	#threadFor(action: Action<SlotSettings>): DeckThread | undefined {
		const machine = this.machineOf(action);
		return pick(deck.board.threadsOn(machine), this.slotOf(action), machine);
	}

	protected override async paint(action: Action<SlotSettings>): Promise<void> {
		if (!action.isKey()) return;
		const machine = this.machineOf(action);
		await this.setImage(action, connectionFace(machine) ?? threadFace(this.#threadFor(action), "No thread", selectedThread(machine)));
	}

	override onKeyDown(ev: KeyDownEvent<SlotSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<SlotSettings>): Promise<void> {
		const long = this.wasLongPress(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const thread = this.#threadFor(ev.action);
		if (!(await this.allowed(ev.action, availability("open", { thread, canOperate: true })))) return;
		if (!long) return void (await this.run(ev.action, () => openThread(thread!), "Opened"));
		selectThread(thread!);
		await this.flash(ev.action, true, "Selected");
	}
}

type ActivitySettings = { machine?: string; filter?: string; project?: string };

/** The threads that match a filter, most urgent first, filling keys by position. Tap opens one. */
@action({ UUID: `${ID}.activity` })
export class Activity extends DeckAction<ActivitySettings> {
	protected override slotGroup(settings: ActivitySettings): string {
		return `${settings.machine ?? ""}|${threadFilter(settings.filter)}|${settings.project ?? ""}`;
	}

	#threadFor(action: Action<ActivitySettings>): DeckThread | undefined {
		const machine = this.machineOf(action);
		const { filter, project } = this.settingsOf(action);
		const threads = deck.board.threadsOn(machine).filter((thread) => matchesFilter(thread, threadFilter(filter), project || undefined));
		return pick(threads, this.slotOf(action), machine);
	}

	protected override async paint(action: Action<ActivitySettings>): Promise<void> {
		if (!action.isKey()) return;
		const machine = this.machineOf(action);
		await this.setImage(action, connectionFace(machine) ?? threadFace(this.#threadFor(action), "All quiet", selectedThread(machine)));
	}

	override async onKeyUp(ev: KeyUpEvent<ActivitySettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const target = this.#threadFor(ev.action);
		if (await this.allowed(ev.action, availability("open", { thread: target, canOperate: true }))) await this.run(ev.action, () => openThread(target!), "Opened");
	}
}

/** Stops the selected thread's turn. */
@action({ UUID: `${ID}.stop` })
export class Stop extends DeckAction {
	#check(action: Action<JsonObject>) {
		const thread = selectedThread(this.machineOf(action));
		return { thread, check: availability("stop", { thread, canOperate: canOperate(thread) }) };
	}

	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		await this.setImage(action, renderControlKey({ glyph: "stop", primary: true, available: this.#check(action).check.available }));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { thread, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		await this.run(ev.action, () => thread!.machine.stopRun(thread!), "Stopped");
	}
}

type PromptSettings = { prompt?: string; label?: string; machine?: string };

/** Sends a saved prompt to the selected thread: tap starts, steers or queues; hold interrupts and restarts with it. */
@action({ UUID: `${ID}.send` })
export class SendPrompt extends DeckAction<PromptSettings> {
	#check(action: Action<PromptSettings>) {
		const prompt = this.settingsOf(action).prompt?.trim();
		const thread = selectedThread(this.machineOf(action));
		return { prompt, thread, check: availability("send", { thread, canOperate: canOperate(thread), hasPrompt: Boolean(prompt) }) };
	}

	protected override async paint(action: Action<PromptSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { label } = this.settingsOf(action);
		await this.setImage(action, renderControlKey({ glyph: "send", primary: true, label: label || undefined, available: this.#check(action).check.available }));
	}

	override onKeyDown(ev: KeyDownEvent<PromptSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<PromptSettings>): Promise<void> {
		const restart = this.wasLongPress(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { prompt, thread, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		await this.run(ev.action, () => thread!.machine.send(thread!, prompt!, restart ? "restart" : "auto"), restart ? "Restarted" : "Sent");
	}
}

type NewThreadSettings = { prompt?: string; title?: string; machine?: string };

/** The machine a new thread starts on when no thread is near: the action's machine, else the first that may act. */
const launchMachine = (machine?: string) => deck.machines.find((candidate) => candidate.canOperate && (machine === undefined || candidate.url === machine));

/**
 * Starts a thread with `prompt` in `near`'s project, or in the scratch project when the board is empty,
 * and selects it so the deck follows it once the shell lists it.
 */
export async function startThread(near: DeckThread | undefined, machine: string | undefined, prompt: string, title?: string): Promise<void> {
	const target = near?.machine ?? launchMachine(machine);
	if (target === undefined) throw new Error("No machine can start threads.");
	const created = await target.launch(near ? { projectId: near.projectId } : { scratch: true }, prompt, { title, fallbackModel: near?.model });
	selectThread({ key: `${target.environmentId}/${created.threadId}`, machine: target });
}

export const launchable = (near: DeckThread | undefined, machine: string | undefined): boolean => (near !== undefined ? canOperate(near) : launchMachine(machine) !== undefined);

/** Starts a new thread with a saved prompt in the selected thread's project. */
@action({ UUID: `${ID}.new` })
export class NewThread extends DeckAction<NewThreadSettings> {
	#check(action: Action<NewThreadSettings>) {
		const prompt = this.settingsOf(action).prompt?.trim();
		const machine = this.machineOf(action);
		const near = selectedThread(machine);
		return { prompt, machine, near, check: availability("new", { canOperate: launchable(near, machine), hasPrompt: Boolean(prompt) }) };
	}

	protected override async paint(action: Action<NewThreadSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { title } = this.settingsOf(action);
		await this.setImage(action, renderControlKey({ glyph: "compose", label: title || undefined, available: this.#check(action).check.available }));
	}

	override async onKeyUp(ev: KeyUpEvent<NewThreadSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { prompt, machine, near, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		await this.run(ev.action, () => startThread(near, machine, prompt!, ev.payload.settings.title), "Started");
	}
}

type OrganizeSettings = { organize?: OrganizeAction; snoozeMinutes?: number | string; machine?: string };

const ORGANIZE_FACE: Record<OrganizeAction, [GlyphName, string, string]> = {
	settle: ["settle", "Settle", "Settled"],
	pin: ["pin", "Pin", "Pinned"],
	unpin: ["pin", "Unpin", "Unpinned"],
	snooze: ["moon", "Snooze", "Snoozed"],
	archive: ["archive", "Archive", "Archived"],
	mark_unread: ["chat", "Unread", "Marked unread"],
};

/** Settle, pin, snooze, archive or mark the selected thread unread; the reverse lives in T3 Code or another key. */
@action({ UUID: `${ID}.organize` })
export class Organize extends DeckAction<OrganizeSettings> {
	#check(action: Action<OrganizeSettings>) {
		const which = this.settingsOf(action).organize ?? "settle";
		const thread = selectedThread(this.machineOf(action));
		const kind = which === "pin" || which === "unpin" ? which : "organize";
		return { which, thread, check: availability(kind, { thread, canOperate: canOperate(thread) }) };
	}

	protected override async paint(action: Action<OrganizeSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { which, check } = this.#check(action);
		const [glyph, label] = ORGANIZE_FACE[which];
		await this.setImage(action, renderControlKey({ glyph, label, available: check.available }));
	}

	override async onKeyUp(ev: KeyUpEvent<OrganizeSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { which, thread, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		const minutes = Number(ev.payload.settings.snoozeMinutes ?? 60) || 60;
		await this.run(ev.action, () => organize(thread!, which, minutes), ORGANIZE_FACE[which][2]);
	}
}
