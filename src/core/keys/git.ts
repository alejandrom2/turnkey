import { HOLD_CONFIRM_MS } from "../approvals.js";
import {
	checkoutOf,
	type GitKeyAction,
	type GitTarget,
	gitBlocker,
	gitSummary,
	needsDefaultBranchHold,
	progressLabel,
	pull,
	pushes,
	reasonText,
	runStackedAction,
	type VcsStatus,
} from "../git.js";
import { type MessageKey, t } from "../i18n.js";
import { modeOf } from "../modes.js";
import { COLORS, type GlyphName, renderInfoKey } from "../render.js";
import { grants, needsAccessLabel } from "../scopes.js";
import { SOURCE_CONTROL_SCOPE } from "../t3/pairing.js";
import { RpcError } from "../t3/rpc.js";
import { confirmed, type KeyContext, type KeyDefinition, type KeyRuntime, withHold } from "./key.js";

export type GitSettings = { machine?: string; gitAction?: string; commitMessage?: string; confirm?: string; title?: string };

export const GIT_LABEL: Record<GitKeyAction, MessageKey> = {
	commit: "repo.action.commit",
	commit_push: "repo.action.commitPush",
	commit_push_pr: "repo.action.commitPushPr",
	push: "repo.action.push",
	create_pr: "repo.action.createPr",
	pull: "repo.action.pull",
};

const GLYPH: Record<GitKeyAction, GlyphName> = {
	commit: "gitCommit",
	commit_push: "gitCommit",
	commit_push_pr: "gitCommit",
	push: "gitPush",
	create_pr: "gitPrCreate",
	pull: "gitPull",
};

/** Whether a press needs a hold: the key's setting, by default only for actions that push. */
export function holdRequired(setting: unknown, action: GitKeyAction, status: VcsStatus | undefined): boolean {
	if (needsDefaultBranchHold(status, action)) return true;
	if (setting === "tap") return false;
	if (setting === "hold") return true;
	return pushes(action);
}

export type GitCheck = { ok: true; target: GitTarget & { cwd: string }; status: VcsStatus | undefined } | { ok: false; reason: string; target?: GitTarget };

/** What `which` would act on, the selected thread's checkout, or why it can't. */
export function gitCheck(runtime: KeyRuntime, machine: string | undefined, which: GitKeyAction): GitCheck {
	const thread = runtime.board.selectedOn(machine);
	const target = thread && checkoutOf(thread);
	if (target === undefined) return { ok: false, reason: t("reason.noThread") };
	if (!target.thread.machine.canOperate) return { ok: false, reason: t("reason.readOnly"), target };
	if (!grants(target.machine.scopes, SOURCE_CONTROL_SCOPE)) return { ok: false, reason: needsAccessLabel(SOURCE_CONTROL_SCOPE), target };
	if (target.cwd === undefined) return { ok: false, reason: t("repo.reason.notRepo"), target };
	const status = runtime.git.get(target);
	const blocker = status && gitBlocker(status, which);
	if (blocker) return { ok: false, reason: reasonText(blocker), target };
	return { ok: true, target: target as GitTarget & { cwd: string }, status };
}

/** The progress each key's running action last reported, by key instance. */
const running = new Map<string, string>();

/** A press the checkout turned down, in `label`'s words: the message stays plain so a failure shows the reason alone. */
const refused = (label: string) => new RpcError("GitRefused", "The checkout refused the press.", label);

/** Shows the action's progress on the key while it runs; a success then shows on the live face (changes, ahead and behind). */
async function execute(ctx: KeyContext<GitSettings>, target: GitTarget & { cwd: string }, which: GitKeyAction): Promise<void> {
	const instance = ctx.instance ?? "";
	running.set(instance, t("repo.starting"));
	ctx.runtime.repaint();
	try {
		if (which === "pull") return void (await pull(target.machine, target.cwd));
		const input = { actionId: crypto.randomUUID(), cwd: target.cwd, action: which, commitMessage: ctx.settings.commitMessage, threadId: target.thread.threadId };
		await runStackedAction(target.machine, input, (progress) => {
			const text = progressLabel(progress);
			if (text === undefined || !running.has(instance)) return;
			running.set(instance, text);
			ctx.runtime.repaint();
		});
	} finally {
		running.delete(instance);
		void ctx.runtime.git.refresh(target).catch(() => undefined);
	}
}

export type GitState = { which: GitKeyAction; title: string; busy: string | undefined; check: GitCheck | undefined };

/**
 * Runs one git action on the selected thread's checkout, picked by its Action setting; T3 Code writes the commit
 * message unless one is set. On Stream Deck push and PR actions need a hold by default, and always on the default
 * branch; on Logitech every one does, on a keypad. The face shows what it would act on, or why it can't.
 */
export const gitKey: KeyDefinition<GitSettings, GitState> = {
	state(ctx) {
		const which = modeOf("git", undefined, ctx.settings);
		const title = ctx.settings.title?.trim() || t(GIT_LABEL[which]);
		const busy = running.get(ctx.instance ?? "");
		// A running action owns the face: the checkout isn't read again until it ends.
		return { which, title, busy, check: busy === undefined ? gitCheck(ctx.runtime, ctx.machine, which) : undefined };
	},

	tile({ which, title, busy, check }, ctx) {
		if (busy !== undefined) return renderInfoKey({ glyph: "running", color: COLORS.accent, title, detail: busy });
		if (!check!.ok) return renderInfoKey({ glyph: GLYPH[which], title, detail: check!.reason, available: false });
		const { status } = check!;
		const detail =
			status === undefined
				? check!.target.thread.branch
				: needsDefaultBranchHold(status, which)
					? t("repo.holdOnDefault", { branch: status.refName ?? "" })
					: (gitSummary(status, which) ?? status.refName ?? undefined);
		return renderInfoKey({ glyph: GLYPH[which], title: withHold(ctx, title), detail });
	},

	label: ({ check }) => check?.target?.thread.title,
	available: ({ busy, check }) => busy !== undefined || check!.ok,

	press({ which, busy, check }, ctx, input) {
		if (busy !== undefined) return { kind: "fail", label: t("repo.running") };
		if (!check!.ok) return { kind: "fail", label: check!.reason };
		const { target } = check!;
		// Logitech has no Confirm setting: every git action reaches past the machine, so a keypad holds for it.
		if (input.confirmBy !== "settings" && !confirmed(input, () => true)) return { kind: "needsHold", label: t("repo.holdTo") };
		return {
			kind: "run",
			work: async () => {
				const status = await ctx.runtime.git.refresh(target);
				const blocker = gitBlocker(status, which);
				if (blocker) throw refused(reasonText(blocker));
				if (input.confirmBy === "settings" && holdRequired(ctx.settings.confirm, which, status) && input.heldMs < HOLD_CONFIRM_MS) {
					const key = needsDefaultBranchHold(status, which) ? "repo.holdOnDefault" : "repo.holdTo";
					throw refused(t(key, { branch: status.refName ?? "", action: t(GIT_LABEL[which]) }));
				}
				await execute(ctx, target, which);
			},
		};
	},
};
