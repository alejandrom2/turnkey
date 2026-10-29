import { HOLD_CONFIRM_MS } from "../approvals.js";
import { type Availability, availability } from "../availability.js";
import type { DeckThread } from "../board.js";
import { threadDeepLink } from "../commands.js";
import { branchSummary } from "../git.js";
import { t } from "../i18n.js";
import { mergeBlocked } from "../lineage.js";
import { modeOf } from "../modes.js";
import { COLORS, renderControlKey, renderInfoKey } from "../render.js";
import { ringFace, stopFace, stopTarget } from "../ring.js";
import type { Machine } from "../t3/machine.js";
import { RpcError } from "../t3/rpc.js";
import { canStopWorkflows } from "../workflows.js";
import { canOperate, confirmed, type KeyContext, type KeyDefinition, type KeyRuntime, type PressInput } from "./key.js";

export type TargetedSettings = { machine?: string; target?: string; thread?: string; threadTitle?: string; mode?: string };

/** The driver behind the thread's provider instance (`claudeAgent`, `codex`, …). */
export const driverOf = (thread: DeckThread): string | undefined =>
	thread.machine.modelConfig?.providers?.find((provider) => provider.instanceId === thread.model.instanceId)?.driver;

/** "3 subagents" while the thread has any out. */
const subagentLine = (thread: DeckThread | undefined): string | undefined =>
	thread !== undefined && thread.subagents > 0 ? t(thread.subagents === 1 ? "status.subagent" : "status.subagents", { count: thread.subagents }) : undefined;

/** A held press, as Stream Deck's lineage keys want before a change that can't be undone; a keypad hold or a Ring click on Logitech. */
const heldEnough = (input: PressInput): boolean => confirmed(input, () => input.heldMs >= HOLD_CONFIRM_MS);

/** `fallback: "newestRunning"`: Logitech's Stop run, on the open thread while it runs, else the run that started last, and no hold. */
export type StopSettings = TargetedSettings & { fallback?: string };
export type StopState = { mode: "turn" | "workflow"; thread: DeckThread | undefined; pinned: boolean; check: Availability; fallback: boolean };

/** The run Logitech's Stop run stops: running by the board's own state, so only the machine can keep it from stopping. */
function newestRunning(ctx: KeyContext<StopSettings>): StopState {
	const board = ctx.runtime.board;
	const thread = stopTarget(board.threads, board.selectedOn(ctx.machine));
	const check: Availability = thread === undefined ? { available: false, reason: t("reason.noThread") } : thread.machine.canOperate ? { available: true } : { available: false, reason: t("reason.readOnly") };
	return { mode: "turn", thread, pinned: false, check, fallback: true };
}

/**
 * Stops the target thread's turn, or the workflows it runs as T3 Code's Lineage panel does for Claude's
 * provider-native workflows (its Stops setting). Hold to stop a workflow: a stopped workflow can't be resumed.
 */
export const stopKey: KeyDefinition<StopSettings, StopState> = {
	state(ctx) {
		if (ctx.settings.fallback === "newestRunning") return newestRunning(ctx);
		const { thread, gone, pinned } = ctx.target();
		if (modeOf("stop", undefined, ctx.settings) === "turn") return { mode: "turn", thread, pinned, check: availability("stop", { thread, gone, canOperate: canOperate(ctx, thread) }), fallback: false };
		const missing = thread !== undefined && !canStopWorkflows(driverOf(thread)) ? t("workflow.notClaude") : undefined;
		return { mode: "workflow", thread, pinned, check: availability("workflow", { thread, gone, canOperate: canOperate(ctx, thread), missing }), fallback: false };
	},

	tile({ mode, thread, pinned, check }) {
		if (mode === "turn") return renderControlKey({ glyph: "stop", primary: true, available: check.available, pinned });
		const detail = check.available ? (subagentLine(thread) ?? thread?.title) : check.reason;
		return renderInfoKey({ glyph: "workflow", title: t("workflow.stop"), detail, available: check.available, pinned });
	},

	glyph: ({ mode, check }) => (mode === "turn" ? stopFace(check.available) : ringFace(COLORS.accent, "workflow", { dim: !check.available })),
	label: ({ thread }) => thread?.title,
	available: ({ check }) => check.available,

	press({ mode, thread, check, fallback }, _ctx, input) {
		if (!check.available) return { kind: "fail", label: check.reason };
		const target = thread!;
		if (mode === "turn") {
			if (!fallback && !confirmed(input, () => true)) return { kind: "needsHold", label: t("workflow.holdToStop") };
			return { kind: "run", work: () => target.machine.stopRun(target) };
		}
		if (!heldEnough(input)) return { kind: "needsHold", label: t("workflow.holdToStop") };
		return {
			kind: "run",
			work: async () => {
				const workflows = await target.machine.workflows(target);
				if (workflows.length === 0) throw new RpcError("NoWorkflow", "No workflow is running.", t("workflow.none"));
				for (const workflow of workflows) await target.machine.stopWorkflow(target, workflow.id);
			},
		};
	},
};

/** Selects a thread the shell may not list yet and opens it in the desktop app, as T3 Code navigates after a fork or merge. */
async function openNew(runtime: KeyRuntime, machine: Machine, threadId: string): Promise<void> {
	const environmentId = machine.environmentId;
	if (environmentId === undefined) return;
	runtime.selectThread({ key: `${environmentId}/${threadId}`, machine });
	await runtime.openExternal(threadDeepLink({ environmentId, threadId }, runtime.scheme()));
}

export type ForkState = { mode: "fork" | "merge"; thread: DeckThread | undefined; pinned: boolean; parent?: { title: string }; check: Availability };

/**
 * Forks the target thread from its newest finished turn, as T3 Code's fork button does, then opens the fork; or merges
 * a fork back into the thread it came from, as T3 Code's Merge in the Lineage panel does, then opens that thread (its
 * Does setting). Hold to merge: the parent's conversation takes the fork's in.
 */
export const forkKey: KeyDefinition<TargetedSettings, ForkState> = {
	state(ctx) {
		const { thread, gone, pinned } = ctx.target();
		if (modeOf("fork", undefined, ctx.settings) === "fork") {
			const missing = thread !== undefined && thread.latestRunId === null ? t("lineage.nothingToFork") : undefined;
			return { mode: "fork", thread, pinned, check: availability("lineage", { thread, gone, canOperate: canOperate(ctx, thread), missing }) };
		}
		// An archived parent leaves the shell but still takes the merge, so it is only named when listed.
		const parent = thread?.mergeInto === undefined ? undefined : (thread.machine.threadRow(thread.mergeInto) ?? undefined);
		const missing =
			thread === undefined
				? undefined
				: thread.mergeInto === undefined
					? t("lineage.notFork")
					: thread.latestRunId === null
						? t("lineage.finishRunFirst")
						: mergeBlocked(thread.runStatus)
							? t("lineage.finishTurn")
							: undefined;
		return { mode: "merge", thread, pinned, parent, check: availability("lineage", { thread, gone, canOperate: canOperate(ctx, thread), missing }) };
	},

	tile({ mode, pinned, parent, check }) {
		if (mode === "merge") {
			const detail = check.available ? (parent ? t("lineage.into", { thread: parent.title }) : undefined) : check.reason;
			return renderInfoKey({ glyph: "mergeBack", title: t("lineage.mergeBack"), detail, available: check.available, pinned });
		}
		return renderControlKey({ glyph: "fork", label: check.available ? t("lineage.fork") : check.reason, available: check.available, pinned, shrink: !check.available });
	},

	label: ({ thread }) => thread?.title,
	available: ({ check }) => check.available,

	press({ mode, thread, check }, ctx, input) {
		if (!check.available) return { kind: "fail", label: check.reason };
		if (mode === "merge") {
			if (!heldEnough(input)) return { kind: "needsHold", label: t("lineage.holdToMerge") };
			const fork = thread!;
			const into = fork.mergeInto!;
			return {
				kind: "run",
				work: async () => {
					await fork.machine.mergeBack(fork, into);
					await openNew(ctx.runtime, fork.machine, into);
				},
			};
		}
		const source = thread!;
		return {
			kind: "run",
			work: async () => {
				const { threadId } = await source.machine.fork(source);
				await openNew(ctx.runtime, source.machine, threadId);
			},
		};
	},
};

export type BranchState = { thread: DeckThread | undefined; check: Availability };

/** The selected thread's branch. Tap opens the thread in T3 Code. */
export const branchKey: KeyDefinition<{ machine?: string }, BranchState> = {
	state(ctx) {
		const thread = ctx.runtime.board.selectedOn(ctx.machine);
		return { thread, check: availability("branch", { thread, canOperate: true }) };
	},

	// The checkout's status is shared with the git keys: read when it first shows and when the turn moves, never on a press.
	tile({ thread, check }, ctx) {
		if (!check.available) return renderInfoKey({ glyph: "branch", title: t("face.branch"), detail: check.reason, available: false });
		const status = ctx.runtime.gitStatus?.(thread!);
		return renderInfoKey({ glyph: thread!.worktreePath ? "worktree" : "branch", title: thread!.branch!, detail: (status && branchSummary(status)) ?? (thread!.projectTitle || undefined) });
	},

	label: ({ thread }) => thread?.branch,
	available: ({ check }) => check.available,

	press({ thread, check }, ctx) {
		if (!check.available) return { kind: "fail", label: check.reason };
		return { kind: "run", work: () => ctx.runtime.openThread(thread!) };
	},
};
