import { type Availability, availability } from "../availability.js";
import type { DeckThread } from "../board.js";
import { organize, type OrganizeAction } from "../commands.js";
import { elapsed, type MessageKey, t } from "../i18n.js";
import { type GlyphName, renderControlKey, renderInfoKey } from "../render.js";
import { latestSnoozed } from "../t3/shell.js";
import { canOperate, confirmed, type KeyDefinition, type KeyRuntime, withHold } from "./key.js";

export type OrganizeSettings = { organize?: OrganizeAction; snoozeMinutes?: number | string; confirm?: string; confirmSettle?: string; machine?: string };

/** Logitech's organize actions: no Unpin, since Pin toggles as Stream Deck's Organize does, so it would be a second Pin. */
export const ORGANIZE_ACTIONS = ["settle", "pin", "snooze", "archive", "mark_unread", "wake"] as const satisfies readonly OrganizeAction[];

const ORGANIZE_FACE: Record<OrganizeAction, [GlyphName, MessageKey]> = {
	settle: ["settle", "organize.settle"],
	pin: ["pin", "organize.pin"],
	unpin: ["pin", "organize.unpin"],
	snooze: ["moon", "organize.snooze"],
	archive: ["archive", "organize.archive"],
	mark_unread: ["chat", "organize.markUnread"],
	wake: ["moon", "organize.wake"],
};

/** Settle and Snooze ask first on Stream Deck (Review by default): both take the thread off the board. */
export const asksFirst = (which: OrganizeAction) => which === "settle" || which === "snooze";

export const snoozeMinutes = (settings: OrganizeSettings) => Number(settings.snoozeMinutes ?? 60) || 60;

/** How long the key snoozes for, short: "30m", "1h", "1d". */
const snoozeLabel = (settings: OrganizeSettings) => {
	const minutes = snoozeMinutes(settings);
	if (minutes % 1440 === 0) return t("time.days", { days: minutes / 1440 });
	return elapsed(0, minutes * 60_000);
};

/** The thread snoozed last on `url`'s machine (or any), while it still sleeps: what Wake brings back. */
function latestAsleep(runtime: KeyRuntime, url: string | undefined): DeckThread | undefined {
	const asleep: DeckThread[] = [];
	for (const machine of runtime.machines()) {
		const environmentId = machine.environmentId;
		if (machine.state.kind !== "ready" || environmentId === undefined || (url !== undefined && machine.url !== url)) continue;
		const row = latestSnoozed(machine.everyRow);
		if (row !== undefined) asleep.push({ ...row, key: `${environmentId}/${row.threadId}`, machine, environmentId });
	}
	return latestSnoozed(asleep);
}

export type OrganizeState = { which: OrganizeAction; pinned: boolean; targeted: boolean; thread: DeckThread | undefined; check: Availability };

/**
 * Settle, pin or unpin, snooze, archive or mark the selected thread unread, or wake the thread snoozed last. Pin
 * toggles and Wake undoes a Snooze; the rest are undone in T3 Code.
 */
export const organizeKey: KeyDefinition<OrganizeSettings, OrganizeState> = {
	state(ctx) {
		const setting = ctx.settings.organize ?? "settle";
		if (setting === "wake") {
			const thread = latestAsleep(ctx.runtime, ctx.machine);
			const check: Availability = thread === undefined ? { available: false, reason: t("organize.nothingSnoozed") } : availability("organize", { thread, canOperate: canOperate(ctx, thread) });
			return { which: setting, pinned: false, targeted: false, thread, check };
		}
		const { thread, gone, pinned: targeted } = ctx.target();
		const pinning = setting === "pin" || setting === "unpin";
		const pin = thread?.pinned ? "unpin" : "pin";
		const which: OrganizeAction = pinning ? pin : setting;
		const kind = pinning ? pin : "organize";
		return { which, pinned: pinning && thread?.pinned === true, targeted, thread, check: availability(kind, { thread, gone, canOperate: canOperate(ctx, thread) }) };
	},

	tile({ which, pinned, targeted, thread, check }, ctx) {
		const [glyph, label] = ORGANIZE_FACE[which];
		if (which === "wake") {
			const detail = check.available ? thread?.title : check.reason;
			return renderInfoKey({ glyph, title: t(label), detail, available: check.available });
		}
		const text = which === "snooze" ? t("organize.snoozeFor", { duration: snoozeLabel(ctx.settings) }) : which === "archive" && check.available ? withHold(ctx, t(label)) : t(label);
		return renderControlKey({ glyph, label: text, available: check.available, active: pinned, pinned: targeted });
	},

	label: ({ thread }) => thread?.title,
	available: ({ check }) => check.available,

	press({ which, thread, check }, ctx, input) {
		if (!check.available) return { kind: "fail", label: check.reason };
		const minutes = snoozeMinutes(ctx.settings);
		const work = () => organize(thread!, which, minutes);
		if (input.confirmBy === "settings") {
			const duration = snoozeLabel(ctx.settings);
			return {
				kind: "guard",
				guard: {
					scope: JSON.stringify([which, thread!.key, minutes]),
					holdHint: t(which === "snooze" ? "result.holdToSnooze" : "result.holdToSettle"),
					card: () => ({
						glyph: ORGANIZE_FACE[which][0],
						verb: which === "snooze" ? t("review.snooze", { duration }) : t("review.settle"),
						target: thread!.title,
						footer: t("review.pressAgain"),
					}),
				},
				work,
			};
		}
		// Logitech has no Confirm setting: Archive alone can't be undone from the deck, so a keypad holds for it.
		if (which === "archive" && !confirmed(input, () => true)) return { kind: "needsHold", label: t("result.holdToArchive") };
		return { kind: "run", work };
	},
};
