import { type Action, action, type DialAction } from "@elgato/streamdeck";

import { HOLD_CONFIRM_MS } from "../core/approvals.js";
import { availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { t } from "../core/i18n.js";
import { COLORS, glyphArt, toneOf } from "../core/render.js";
import type { StripContent } from "../core/strip.js";
import type { StripList } from "../core/styles.js";
import { type QueuedMessage, queuePress, type ThreadQueue } from "../core/t3/queue.js";
import { deck } from "../deck.js";
import { canOperate, LONG_PRESS_MS, openThread, pressWhileDisconnected, queueOf, selectedThread } from "./base.js";
import { type DialSettings, disconnectedStrip, StripDial } from "./strip.js";

const ID = "com.alejandrom2.t3deck";

/**
 * The selected thread's queued messages. Rotate picks one; press sends it now (steering it into the running turn,
 * or starting it when nothing runs, which also releases a queue Stop held); hold removes it. Tap opens the thread.
 */
@action({ UUID: `${ID}.dial.queue` })
export class QueueDial extends StripDial<DialSettings> {
	/** The message each dial shows, by run id, so it stays put as the queue moves. */
	readonly #shown = new Map<string, string>();

	#state(action: Action<DialSettings>) {
		const thread = selectedThread(this.machineOf(action));
		const queue = thread === undefined ? undefined : queueOf(thread);
		const items = queue?.items ?? [];
		const index = Math.max(
			0,
			items.findIndex((item) => item.runId === this.#shown.get(action.id)),
		);
		return { thread, queue, items, index, item: items[index] as QueuedMessage | undefined };
	}

	/** What pressing and holding do, for the strip's detail line. */
	#hint(queue: ThreadQueue): string {
		if (queue.held) return t("strip.queueHeld");
		const press = queuePress(queue);
		return press === "start" ? t("strip.queueSendNow") : press === "steer" ? t("strip.queueSteer") : t("strip.queueRemoveOnly");
	}

	protected face(action: Action<DialSettings>): StripContent {
		const header = t("strip.queue");
		const offline = disconnectedStrip(header, this.machineOf(action));
		if (offline) return offline;
		const { thread, queue, items, index, item } = this.#state(action);
		if (thread === undefined) return { header, icon: glyphArt("queued", COLORS.muted), accent: COLORS.muted, value: t("strip.noThread") };
		const tone = toneOf(thread.deck, thread.unseen);
		if (queue === undefined) return { header, icon: glyphArt("queued", COLORS.muted), accent: COLORS.muted, value: thread.title, tone, loading: true };
		if (item === undefined) return { header, icon: glyphArt("queued", COLORS.muted), accent: COLORS.muted, value: t("strip.nothingQueued"), detail: thread.title, tone };
		const check = this.#check(thread);
		return {
			header: `${header} · ${index + 1}/${items.length}`,
			icon: glyphArt("queued", check.available ? COLORS.text : COLORS.muted),
			accent: check.available ? COLORS.accent : COLORS.muted,
			value: item.text || t("strip.queuedMessage"),
			detail: check.available ? this.#hint(queue) : check.reason,
			tone,
		};
	}

	protected override list(action: Action<DialSettings>): StripList | undefined {
		if (disconnectedStrip("", this.machineOf(action))) return undefined;
		const { thread, queue, items, index } = this.#state(action);
		if (thread === undefined || queue === undefined || items.length === 0) return undefined;
		const check = this.#check(thread);
		const art = glyphArt("queued", check.available ? COLORS.text : COLORS.muted);
		return {
			heading: t("strip.queue"),
			index,
			items: items.map((item) => ({ key: item.runId, label: item.text || t("strip.queuedMessage"), art })),
			note: { text: check.available ? this.#hint(queue) : check.reason },
		};
	}

	#check(thread: DeckThread | undefined) {
		return availability("send", { thread, canOperate: canOperate(thread), hasPrompt: true });
	}

	protected override rotated(dial: DialAction<DialSettings>, ticks: number): void {
		const { items, index } = this.#state(dial);
		const next = items[Math.min(items.length - 1, Math.max(0, index + ticks))];
		if (next !== undefined) this.#shown.set(dial.id, next.runId);
	}

	protected override async pressed(dial: DialAction<DialSettings>, held: number): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		const { thread, queue, item } = this.#state(dial);
		if (!(await this.allowed(dial, this.#check(thread)))) return;
		if (queue === undefined) return void (await this.flash(dial, false, t("result.loading")));
		if (item === undefined) return void (await this.flash(dial, false, t("strip.nothingQueued")));
		const target = thread!;
		// Between a long press and a confirming hold nothing happens, so an almost-hold never sends instead of removing.
		if (held >= HOLD_CONFIRM_MS) return this.#change(dial, target, () => target.machine.cancelQueued(target, item.runId));
		if (held >= LONG_PRESS_MS) return void (await this.flash(dial, false, t("result.holdToRemove")));
		const press = queuePress(queue);
		if (press === undefined) return void (await this.flash(dial, false, t("result.cantSteerYet")));
		await this.#change(dial, target, () =>
			press === "start" ? target.machine.startQueued(target, item.runId) : target.machine.promoteQueued(target, item.runId, queue.activeRunId!),
		);
	}

	/** Runs a queue change, then reads the queue again: the shell may not move for it. */
	#change(dial: DialAction<DialSettings>, thread: DeckThread, work: () => Promise<void>): Promise<void> {
		return this.run(dial, async () => {
			try {
				await work();
			} finally {
				deck.queues.invalidate(thread.key);
			}
		});
	}

	protected override async tapped(dial: DialAction<DialSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		const thread = selectedThread(this.machineOf(dial));
		if (await this.allowed(dial, availability("open", { thread, canOperate: true }))) await this.run(dial, () => openThread(thread!));
	}

	override onWillDisappear(ev: Parameters<StripDial<DialSettings>["onWillDisappear"]>[0]): void {
		this.#shown.delete(ev.action.id);
		super.onWillDisappear(ev);
	}
}
