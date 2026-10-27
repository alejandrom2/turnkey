/**
 * Git keys over T3 Code's source control RPCs: `git.runStackedAction` (commit, push, create a PR and their combos)
 * and `vcs.pull`, gated the way T3 Code's git menu gates them (packages/client-runtime/src/state/gitActions.ts).
 */
import { type MessageKey, type MessageParams, t } from "./i18n.js";
import { READ_SCOPE, SOURCE_CONTROL_SCOPE } from "./t3/pairing.js";
import { RpcError } from "./t3/rpc.js";

/** `GitStackedAction` (packages/contracts/src/git.ts). */
export type GitStackedAction = "commit" | "push" | "create_pr" | "commit_push" | "commit_push_pr";
export type GitKeyAction = GitStackedAction | "pull";

export const STACKED_ACTIONS: readonly GitStackedAction[] = ["commit", "push", "create_pr", "commit_push", "commit_push_pr"];
export const isStackedAction = (value: unknown): value is GitStackedAction => STACKED_ACTIONS.includes(value as GitStackedAction);

/** The `VcsStatusResult` fields the deck reads. */
export type VcsStatus = {
	isRepo: boolean;
	hasPrimaryRemote: boolean;
	isDefaultRef: boolean;
	refName: string | null;
	hasWorkingTreeChanges: boolean;
	workingTree: { files: readonly unknown[]; insertions: number; deletions: number };
	hasUpstream: boolean;
	aheadCount: number;
	behindCount: number;
	aheadOfDefaultCount?: number;
	pr: { number: number; state: "open" | "closed" | "merged"; url: string } | null;
};

/** `GitRunStackedActionResult`'s summary: T3 Code's own toast for the outcome. */
export type GitActionResult = {
	action: GitStackedAction;
	pr: { status: "created" | "opened_existing" | "skipped_not_requested"; url?: string; number?: number };
	toast: { title: string; description?: string };
};

/** `GitActionProgressEvent`, as far as the key shows it. */
export type GitProgress =
	| { kind: "action_started" }
	| { kind: "phase_started"; label: string }
	| { kind: "hook_started"; hookName: string }
	| { kind: "hook_output" | "hook_finished" }
	| { kind: "action_finished"; result: GitActionResult }
	| { kind: "action_failed"; message: string };

/** The machine calls git keys need; tests pass a fake. */
export type GitMachine = {
	call<T>(tag: string, payload: unknown, scope?: string): Promise<T>;
	stream(tag: string, payload: unknown, onValue: (value: unknown) => void, scope?: string): Promise<void>;
};

/** Where a thread's git actions run: its own worktree, else its project's root. */
export const gitCwd = (thread: { worktreePath?: string } | undefined, workspaceRoot: string | undefined): string | undefined =>
	thread?.worktreePath ?? workspaceRoot;

/** The `git.runStackedAction` payload, field for field as T3 Code's client builds it (vcsAction.ts). */
export function stackedActionInput(input: { actionId: string; cwd: string; action: GitStackedAction; commitMessage?: string; threadId?: string }): Record<string, unknown> {
	const commitMessage = input.commitMessage?.trim();
	return {
		actionId: input.actionId,
		cwd: input.cwd,
		action: input.action,
		...(commitMessage ? { commitMessage } : {}),
		...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
	};
}

/** Actions that push, which T3 Code confirms on the default branch (`requiresDefaultBranchConfirmation`). */
export const pushes = (action: GitKeyAction): boolean => action === "push" || action === "create_pr" || action === "commit_push" || action === "commit_push_pr";
const opensPr = (action: GitKeyAction): boolean => action === "create_pr" || action === "commit_push_pr";
const commits = (action: GitKeyAction): boolean => action === "commit" || action === "commit_push" || action === "commit_push_pr";

export type GitBlocker = { key: MessageKey; params?: MessageParams };

/**
 * Why `action` can't run on `status`, from T3 Code's `buildMenuItems`/`getGitActionDisabledReason`; undefined when it
 * can. A PR from the default branch is refused: T3 Code would offer a feature branch first.
 */
export function gitBlocker(status: VcsStatus, action: GitKeyAction): GitBlocker | undefined {
	if (!status.isRepo) return { key: "repo.reason.notRepo" };
	const hasBranch = status.refName !== null;
	const hasChanges = status.hasWorkingTreeChanges;
	const hasOpenPr = status.pr?.state === "open";
	const isAhead = status.aheadCount > 0;
	const isBehind = status.behindCount > 0;
	const reachable = status.hasUpstream || status.hasPrimaryRemote;
	if (action === "pull") {
		if (!hasBranch) return { key: "repo.reason.detached" };
		if (!status.hasUpstream) return { key: "repo.reason.noUpstream" };
		if (isAhead && isBehind) return { key: "repo.reason.diverged" };
		return isBehind ? undefined : { key: "repo.reason.upToDate" };
	}
	if (commits(action) && !hasChanges) return { key: "repo.reason.clean" };
	if (action === "commit") return undefined;
	if (!hasBranch) return { key: "repo.reason.detached" };
	if (action === "push" && hasChanges) return { key: "repo.reason.uncommitted" };
	if (isBehind) return { key: "repo.reason.behind" };
	if (!reachable) return { key: "repo.reason.noRemote" };
	if (action === "push" && !isAhead) return { key: "repo.reason.nothingToPush" };
	if (opensPr(action)) {
		if (hasOpenPr) return { key: "repo.reason.prOpen", params: { number: status.pr!.number } };
		if (status.isDefaultRef) return { key: "repo.reason.prFromDefault", params: { branch: status.refName ?? "" } };
		if (action === "create_pr" && (status.aheadOfDefaultCount ?? status.aheadCount) <= 0) return { key: "repo.reason.nothingForPr" };
	}
	return undefined;
}

/** On the default branch a push needs a hold, whatever the key's setting: T3 Code asks before pushing there. */
export const needsDefaultBranchHold = (status: VcsStatus | undefined, action: GitKeyAction): boolean => status?.isDefaultRef === true && pushes(action);

/** A short summary of what the key would act on: changed files, commits ahead or behind. */
export function gitSummary(status: VcsStatus, action: GitKeyAction): string | undefined {
	if (action === "pull") return status.behindCount > 0 ? t("repo.behind", { count: status.behindCount }) : undefined;
	if (commits(action) && status.hasWorkingTreeChanges) {
		const { files, insertions, deletions } = status.workingTree;
		return files.length === 1 ? t("repo.changesOne", { insertions, deletions }) : t("repo.changes", { files: files.length, insertions, deletions });
	}
	return status.aheadCount > 0 ? t("repo.ahead", { count: status.aheadCount }) : undefined;
}

export const reasonText = (blocker: GitBlocker): string => t(blocker.key, blocker.params);

/** `vcs.refreshStatus`; `remote: false` reads git's local state only and zero-fills what it didn't read from the remote. */
export function readStatus(machine: GitMachine, cwd: string, remote: boolean): Promise<VcsStatus> {
	return machine.call<VcsStatus>("vcs.refreshStatus", remote ? { cwd } : { cwd, localOnly: true }, READ_SCOPE);
}

/**
 * Runs one stacked action to its end. Progress goes to `onProgress`; the result is T3 Code's own. A socket that
 * drops mid-run leaves the outcome unknown, so it is reported, never retried.
 */
export async function runStackedAction(
	machine: GitMachine,
	input: Parameters<typeof stackedActionInput>[0],
	onProgress: (progress: GitProgress) => void = () => undefined,
): Promise<GitActionResult> {
	let outcome: { result: GitActionResult } | { failed: string } | undefined;
	try {
		await machine.stream(
			"git.runStackedAction",
			stackedActionInput(input),
			(value) => {
				const event = value as GitProgress;
				if (event.kind === "action_finished") outcome = { result: event.result };
				else if (event.kind === "action_failed") outcome = { failed: event.message };
				onProgress(event);
			},
			SOURCE_CONTROL_SCOPE,
		);
	} catch (error) {
		if (outcome === undefined && error instanceof RpcError && error.tag === "Disconnected") throw new RpcError("Disconnected", error.message, t("repo.unknownOutcome"));
		if (outcome === undefined) throw error;
	}
	if (outcome === undefined) throw new RpcError("Incomplete", "The action ended without a result.", t("repo.unknownOutcome"));
	if ("failed" in outcome) throw new RpcError("GitActionFailed", outcome.failed, outcome.failed.length <= 160 ? outcome.failed : undefined);
	return outcome.result;
}

/** `vcs.pull` on the checkout. */
export function pull(machine: GitMachine, cwd: string): Promise<{ status: "pulled" | "skipped_up_to_date"; refName: string }> {
	return machine.call("vcs.pull", { cwd }, SOURCE_CONTROL_SCOPE);
}

/** What a progress event puts on the key while the action runs. */
export function progressLabel(progress: GitProgress): string | undefined {
	switch (progress.kind) {
		case "phase_started":
			return progress.label;
		case "hook_started":
			return t("repo.hook", { hook: progress.hookName });
		default:
			return undefined;
	}
}
