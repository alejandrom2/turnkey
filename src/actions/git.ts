import streamDeck, { type Action, action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";

import { HOLD_CONFIRM_MS } from "../core/approvals.js";
import type { DeckThread } from "../core/board.js";
import { failureLabel } from "../core/feedback.js";
import {
	type GitKeyAction,
	gitBlocker,
	gitCwd,
	gitSummary,
	isStackedAction,
	needsDefaultBranchHold,
	progressLabel,
	pull,
	pushes,
	readStatus,
	reasonText,
	runStackedAction,
	type VcsStatus,
} from "../core/git.js";
import { type MessageKey, t } from "../core/i18n.js";
import { COLORS, type GlyphName, renderInfoKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { grants, needsAccessLabel } from "../core/scopes.js";
import type { Machine } from "../core/t3/machine.js";
import { SOURCE_CONTROL_SCOPE } from "../core/t3/pairing.js";
import { deck } from "../deck.js";
import { canOperate, connectionFace, DeckAction, pressWhileDisconnected, selectedThread } from "./base.js";
import { threadNeeds } from "./needs.js";

const ID = "com.alejandrom2.t3deck";
const logger = streamDeck.logger.createScope("git");

/** The checkout a git key acts on: the selected thread's worktree, else its project's root. */
export type GitTarget = { thread: DeckThread; machine: Machine; cwd: string | undefined };

export function gitTarget(machine?: string): GitTarget | undefined {
	const thread = selectedThread(machine);
	if (thread === undefined) return undefined;
	return { thread, machine: thread.machine, cwd: gitCwd(thread, thread.machine.project(thread.projectId)?.workspaceRoot) };
}

/**
 * Each checkout's last `vcs.refreshStatus`, shared by every git key: read when a key first shows a checkout, again
 * when its thread's turn starts or ends, and on every press. No polling. Always with the remote part: a local-only
 * read zero-fills upstream, ahead and behind until something fetched them, which would dim Push and Pull wrongly.
 */
class StatusCache {
	readonly #entries = new Map<string, { status?: VcsStatus; stamp: string; loading: boolean }>();

	get(target: GitTarget): VcsStatus | undefined {
		if (target.cwd === undefined) return undefined;
		const key = `${target.machine.url}|${target.cwd}`;
		const stamp = `${target.thread.deck}|${target.thread.active}`;
		const entry = this.#entries.get(key);
		if (entry === undefined || (entry.stamp !== stamp && !entry.loading)) {
			this.#entries.set(key, { status: entry?.status, stamp, loading: true });
			void this.refresh(target).catch(() => undefined);
		}
		return entry?.status;
	}

	async refresh(target: GitTarget): Promise<VcsStatus> {
		const key = `${target.machine.url}|${target.cwd}`;
		const stamp = `${target.thread.deck}|${target.thread.active}`;
		try {
			const status = await readStatus(target.machine, target.cwd!, true);
			this.#entries.set(key, { status, stamp, loading: false });
			return status;
		} catch (error) {
			const previous = this.#entries.get(key);
			this.#entries.set(key, { status: previous?.status, stamp, loading: false });
			throw error;
		} finally {
			deck.repaint();
		}
	}
}

export const statuses = new StatusCache();

type GitSettings = { machine?: string; gitAction?: string; commitMessage?: string; confirm?: string; title?: string };

const LABEL: Record<GitKeyAction, MessageKey> = {
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

type Check = { ok: true; target: GitTarget & { cwd: string }; status: VcsStatus | undefined } | { ok: false; reason: string; target?: GitTarget };

/**
 * A key that runs one git action on the selected thread's checkout. Push and PR actions need a hold by default,
 * and always on the default branch; the face shows what the action would act on, or why it can't.
 */
abstract class GitKey extends DeckAction<GitSettings> {
	readonly #busy = new Map<string, string>();

	protected abstract gitAction(settings: GitSettings): GitKeyAction;

	#check(action: Action<GitSettings>): Check {
		const target = gitTarget(this.machineOf(action));
		if (target === undefined) return { ok: false, reason: t("reason.noThread") };
		if (!canOperate(target.thread)) return { ok: false, reason: t("reason.readOnly"), target };
		if (!grants(target.machine.scopes, SOURCE_CONTROL_SCOPE)) return { ok: false, reason: needsAccessLabel(SOURCE_CONTROL_SCOPE), target };
		if (target.cwd === undefined) return { ok: false, reason: t("repo.reason.notRepo"), target };
		const status = statuses.get(target);
		const blocker = status && gitBlocker(status, this.gitAction(this.settingsOf(action)));
		if (blocker) return { ok: false, reason: reasonText(blocker), target };
		return { ok: true, target: target as GitTarget & { cwd: string }, status };
	}

	protected override async paint(action: Action<GitSettings>): Promise<void> {
		if (!action.isKey()) return;
		const machine = this.machineOf(action);
		const offline = connectionFace(machine);
		if (offline) return void (await this.setImage(action, offline));
		const settings = this.settingsOf(action);
		const which = this.gitAction(settings);
		const title = settings.title?.trim() || t(LABEL[which]);
		const busy = this.#busy.get(action.id);
		if (busy !== undefined) return void (await this.setImage(action, renderInfoKey({ glyph: "running", color: COLORS.accent, title, detail: busy })));
		const check = this.#check(action);
		if (!check.ok) return void (await this.setImage(action, renderInfoKey({ glyph: GLYPH[which], title, detail: check.reason, available: false })));
		const { status } = check;
		const detail =
			status === undefined
				? check.target.thread.branch
				: needsDefaultBranchHold(status, which)
					? t("repo.holdOnDefault", { branch: status.refName ?? "" })
					: (gitSummary(status, which) ?? status.refName ?? undefined);
		await this.setImage(action, renderInfoKey({ glyph: GLYPH[which], title, detail }));
	}

	override onKeyDown(ev: KeyDownEvent<GitSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<GitSettings>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		if (this.#busy.has(ev.action.id)) return void (await this.flash(ev.action, false, t("repo.running")));
		const first = this.#check(ev.action);
		if (!first.ok) return void (await this.flash(ev.action, false, first.reason));
		const settings = this.settingsOf(ev.action);
		const which = this.gitAction(settings);
		let status: VcsStatus;
		try {
			status = await statuses.refresh(first.target);
		} catch (error) {
			return void (await this.flash(ev.action, false, failureLabel(error)));
		}
		const blocker = gitBlocker(status, which);
		if (blocker) return void (await this.flash(ev.action, false, reasonText(blocker)));
		if (holdRequired(settings.confirm, which, status) && held < HOLD_CONFIRM_MS) {
			const key = needsDefaultBranchHold(status, which) ? "repo.holdOnDefault" : "repo.holdTo";
			return void (await this.flash(ev.action, false, t(key, { branch: status.refName ?? "", action: t(LABEL[which]) })));
		}
		await this.#execute(ev.action, first.target, which, settings);
	}

	async #execute(action: Action<GitSettings>, target: GitTarget & { cwd: string }, which: GitKeyAction, settings: GitSettings): Promise<void> {
		this.#busy.set(action.id, t("repo.starting"));
		this.forgetSent(action.id);
		void this.paint(action);
		let ok = false;
		let label: string;
		try {
			if (which === "pull") {
				const result = await pull(target.machine, target.cwd);
				label = t(result.status === "pulled" ? "repo.pulled" : "repo.upToDate");
			} else if (isStackedAction(which)) {
				const result = await runStackedAction(
					target.machine,
					{ actionId: crypto.randomUUID(), cwd: target.cwd, action: which, commitMessage: settings.commitMessage, threadId: target.thread.threadId },
					(progress) => {
						const text = progressLabel(progress);
						if (text === undefined || !this.#busy.has(action.id)) return;
						this.#busy.set(action.id, text);
						void this.paint(action);
					},
				);
				label = result.toast.title;
			} else label = t("result.done");
			ok = true;
		} catch (error) {
			logger.warn(`${which} failed: ${error instanceof Error ? error.message : String(error)}`);
			label = failureLabel(error);
		} finally {
			this.#busy.delete(action.id);
		}
		void statuses.refresh(target).catch(() => undefined);
		await this.flash(action, ok, label);
	}

	/** The inspector's checklist: a paired machine that may act, a thread, source control access and a checkout ready for it. */
	override needs(action: Action<GitSettings>): Need[] {
		const target = gitTarget(this.machineOf(action));
		const status = target && statuses.get(target);
		const blocker = status && gitBlocker(status, this.gitAction(this.settingsOf(action)));
		return [
			...threadNeeds(this.machineOf(action), target?.thread),
			{ kind: "scope", scope: SOURCE_CONTROL_SCOPE, ok: target !== undefined && grants(target.machine.scopes, SOURCE_CONTROL_SCOPE) },
			{ kind: "repo", ok: target === undefined ? false : status === undefined ? undefined : blocker === undefined, reason: blocker && reasonText(blocker) },
		];
	}
}

const COMMIT_ACTIONS = ["commit", "commit_push", "commit_push_pr"] as const;

/** Commits the selected thread's changes, or commits and pushes, or also opens a PR; T3 Code writes the message unless one is set. */
@action({ UUID: `${ID}.git.commit` })
export class CommitKey extends GitKey {
	protected gitAction(settings: GitSettings): GitKeyAction {
		return COMMIT_ACTIONS.find((candidate) => candidate === settings.gitAction) ?? "commit";
	}
}

/** Pushes the selected thread's branch. */
@action({ UUID: `${ID}.git.push` })
export class PushKey extends GitKey {
	protected gitAction(): GitKeyAction {
		return "push";
	}
}

/** Pushes the selected thread's branch and opens a pull request for it. */
@action({ UUID: `${ID}.git.pr` })
export class CreatePrKey extends GitKey {
	protected gitAction(): GitKeyAction {
		return "create_pr";
	}
}

/** Pulls the selected thread's branch from its upstream. */
@action({ UUID: `${ID}.git.pull` })
export class PullKey extends GitKey {
	protected gitAction(): GitKeyAction {
		return "pull";
	}
}
