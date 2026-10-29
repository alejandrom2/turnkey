import { type Availability, availability } from "../availability.js";
import type { DeckThread } from "../board.js";
import { threadDeepLink } from "../commands.js";
import { elapsed, t } from "../i18n.js";
import { threadMotion } from "../motion.js";
import { renderControlKey, renderNoticeKey, renderThreadKey } from "../render.js";
import { matchesFilter, type SlotIndex, slotSetting, threadFilter } from "../slots.js";
import type { Machine } from "../t3/machine.js";
import { type KeyContext, type KeyDefinition, LONG_PRESS_MS, type PressPlan } from "./key.js";

/** The slot a key fills: the position its host worked out, else its own slot setting, from 1 (0 is the selected thread), else the first. */
function slotOf(ctx: KeyContext<unknown>, setting?: number | string): SlotIndex {
	if (ctx.slot !== undefined) return ctx.slot;
	const slot = slotSetting(setting);
	return slot === undefined ? 0 : slot === 0 ? "selected" : slot - 1;
}

type Motion = ReturnType<typeof threadMotion>;
export type ThreadState = { thread: DeckThread | undefined; selected: DeckThread | undefined; now: number; motion: Motion["motion"]; moving: boolean; check: Availability };

/** The state of the key at `slot` of `threads`. */
export function stateAt(ctx: KeyContext<unknown>, threads: readonly DeckThread[], slot: SlotIndex): ThreadState {
	const thread = slot === "selected" ? ctx.runtime.board.selectedOn(ctx.machine) : threads[slot];
	const now = Date.now();
	const { motion, moving } = thread === undefined ? { motion: {}, moving: false } : threadMotion(ctx.runtime.motion(), thread, ctx.runtime.transitions, now);
	return { thread, selected: ctx.runtime.board.selectedOn(ctx.machine), now, motion, moving, check: availability("open", { thread, canOperate: true }) };
}

/** A thread's key face, or `emptyLabel` when the slot holds none. */
export function threadTile({ thread, selected, now, motion }: ThreadState, ctx: KeyContext<unknown>, emptyLabel: string): string {
	if (thread === undefined) return renderNoticeKey({ glyph: "chat", title: emptyLabel, tone: "muted" });
	return renderThreadKey({
		state: thread.deck,
		title: thread.title,
		meta: elapsed(thread.active ? thread.activeSince : thread.updatedAt, now),
		worktree: thread.worktreePath !== undefined,
		diff: thread.active ? undefined : thread.machine.turnDiff(thread),
		unseen: thread.unseen,
		selected: selected === undefined ? undefined : thread.key === selected.key,
		motion,
		queued: ctx.runtime.queued(thread),
		subagents: thread.subagents,
	});
}

export type SlotSettings = { slot?: number | string; machine?: string };

/** A board slot: tap opens the thread in T3 Code; a hold selects it without opening. */
export const threadKey: KeyDefinition<SlotSettings, ThreadState> = {
	state: (ctx) => stateAt(ctx, ctx.runtime.board.threadsOn(ctx.machine), slotOf(ctx, ctx.settings.slot)),
	tile: (state, ctx) => threadTile(state, ctx, t("face.noThread")),
	moving: (state) => state.moving,
	label: (state) => state.thread?.title,
	available: (state) => state.check.available,
	press: (state, ctx, input) => opening(state, ctx, input.heldMs >= LONG_PRESS_MS),
};

function opening({ thread, check }: ThreadState, ctx: KeyContext<unknown>, selectOnly: boolean): PressPlan {
	if (!check.available) return { kind: "fail", label: check.reason };
	return { kind: "run", work: async () => (selectOnly ? ctx.runtime.selectThread(thread!) : ctx.runtime.openThread(thread!)) };
}

export type ActivitySettings = { machine?: string; filter?: string; project?: string };

/** The threads that match a filter, most urgent first, filling keys by position. Tap opens one. */
export const activityKey: KeyDefinition<ActivitySettings, ThreadState> = {
	state(ctx) {
		const { filter, project } = ctx.settings;
		const threads = ctx.runtime.board.threadsOn(ctx.machine).filter((thread) => matchesFilter(thread, threadFilter(filter), project || undefined));
		return stateAt(ctx, threads, slotOf(ctx));
	},
	tile: (state, ctx) => threadTile(state, ctx, t("face.allQuiet")),
	moving: (state) => state.moving,
	label: (state) => state.thread?.title,
	available: (state) => state.check.available,
	press: (state, ctx) => opening(state, ctx, false),
};

export type NewThreadSettings = { prompt?: string; title?: string; destination?: string; project?: string; machine?: string; startIn?: string };

type LaunchPlan = { near: DeckThread | undefined; target: Machine | undefined; where: { projectId: string } | { scratch: true }; missing?: string };
export type NewThreadState = { plan: LaunchPlan; worktree: boolean; check: Availability };

/** The machines the key follows. */
const followed = (ctx: KeyContext<unknown>): Machine[] => ctx.runtime.machines().filter((machine) => ctx.machine === undefined || machine.url === ctx.machine);

/**
 * Starts a thread where "Create in" says: the selected thread's project (the default, or no project when there
 * is none), no project, or a chosen project on whichever machine has it. Without a prompt it starts empty and
 * opens in T3 Code, where the user types.
 */
function planOf(ctx: KeyContext<NewThreadSettings>): LaunchPlan {
	const { destination, project } = ctx.settings;
	const near = ctx.runtime.board.selectedOn(ctx.machine);
	const launchMachine = () => followed(ctx).find((candidate) => candidate.canOperate);
	if (destination === "scratch") return { near, target: near?.machine ?? launchMachine(), where: { scratch: true } };
	if (destination === "project") {
		const owner = followed(ctx).find((candidate) => candidate.projects.some((known) => known.id === project));
		return { near, target: owner, where: { projectId: project ?? "" }, missing: !project ? t("reason.pickProject") : owner === undefined ? t("reason.noProject") : undefined };
	}
	return { near, target: near?.machine ?? launchMachine(), where: near ? { projectId: near.projectId } : { scratch: true } };
}

export const newThreadKey: KeyDefinition<NewThreadSettings, NewThreadState> = {
	state(ctx) {
		const plan = planOf(ctx);
		const worktree = ctx.settings.startIn === "worktree";
		// A worktree is made on the first message, as in T3 Code's composer, and needs a project's repository.
		const missing = plan.missing ?? (!worktree ? undefined : "scratch" in plan.where ? t("worktree.noProject") : !ctx.settings.prompt?.trim() ? t("worktree.needsPrompt") : undefined);
		return { plan, worktree, check: availability("launch", { canOperate: plan.target?.canOperate ?? false, missing }) };
	},
	tile: ({ worktree, check }, ctx) =>
		renderControlKey({ glyph: worktree ? "worktree" : "compose", label: ctx.settings.title || (worktree ? t("worktree.newThread") : undefined), available: check.available }),
	available: ({ check }) => check.available,
	press({ plan, worktree, check }, ctx) {
		if (!check.available) return { kind: "fail", label: check.reason };
		const target = plan.target!;
		const prompt = ctx.settings.prompt?.trim() ?? "";
		return {
			kind: "run",
			work: async () => {
				const workspaceStrategy = worktree && "projectId" in plan.where ? await target.worktreeStrategy(plan.where.projectId) : undefined;
				const created = await target.launch(plan.where, prompt, { title: ctx.settings.title, fallbackModel: plan.near?.model, workspaceStrategy });
				// Selected before the shell lists it, so the deck follows it.
				if (target.environmentId !== undefined) ctx.runtime.selectThread({ key: `${target.environmentId}/${created.threadId}`, machine: target });
				if (prompt === "" && target.environmentId !== undefined) {
					await ctx.runtime.openExternal(threadDeepLink({ environmentId: target.environmentId, threadId: created.threadId }, ctx.runtime.scheme()));
				}
			},
		};
	},
};
