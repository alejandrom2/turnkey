import { HOLD_CONFIRM_MS } from "../approvals.js";
import { type Availability, availability } from "../availability.js";
import type { DeckThread } from "../board.js";
import { type MessageKey, t } from "../i18n.js";
import { findModel } from "../models.js";
import {
	buildExplainPullRequestHandoff,
	buildFixFindingsHandoff,
	changeRequestLabel,
	classifyChecks,
	failing,
	findings,
	guideState,
	handoffMessage,
	type PullRequestActivity,
	type PullRequestCheck,
	type PullRequestRef,
	type PullRequestSummary,
	prRequests,
	type ReviewGuideResult,
	threadPullRequest,
	threadPullRequestRef,
} from "../pr.js";
import { modeOf } from "../modes.js";
import { COLORS, type GlyphName, renderInfoKey } from "../render.js";
import { grants } from "../scopes.js";
import type { Machine } from "../t3/machine.js";
import { SOURCE_CONTROL_SCOPE } from "../t3/pairing.js";
import { RpcError } from "../t3/rpc.js";
import type { ThreadPullRequest } from "../t3/shell.js";
import { setCapped } from "../capped.js";
import { confirmed, type KeyDefinition, type KeyRuntime, withHold } from "./key.js";

/** How long a pull request's checks, review and findings stay fresh while a key shows them. */
const PR_TTL_MS = 60_000;
/** Entries no key has shown for this long stop refreshing. */
export const PR_WATCH_MS = 120_000;

type PrInfo = { summary?: PullRequestSummary; checks?: readonly PullRequestCheck[]; activity?: PullRequestActivity; loadedAt: number; loading: boolean; seenAt: number };

/**
 * Live state per pull request for the keys and the dial: `pullRequests.summary` (review), `.checks` and `.activity`
 * (findings), read when a key first shows one and refreshed once a minute while one does. `repaint` is the host's,
 * called when a read lands.
 */
class PrStore {
	readonly #entries = new Map<string, PrInfo & { machine: Machine; ref: PullRequestRef; repaint: () => void }>();
	#timer: ReturnType<typeof setInterval> | undefined;

	get(machine: Machine, ref: PullRequestRef, repaint: () => void): PrInfo {
		const key = `${machine.url}|${ref.projectId}|${ref.host ?? ""}|${ref.repository}#${ref.number}`;
		const now = Date.now();
		let entry = this.#entries.get(key);
		if (entry === undefined) {
			entry = { machine, ref, repaint, loadedAt: 0, loading: false, seenAt: now };
			this.#entries.set(key, entry);
		}
		entry.seenAt = now;
		if (!entry.loading && now - entry.loadedAt > PR_TTL_MS) void this.#load(entry);
		this.#timer ??= setInterval(() => this.#refresh(), PR_TTL_MS);
		return entry;
	}

	async #load(entry: PrInfo & { machine: Machine; ref: PullRequestRef; repaint: () => void }): Promise<void> {
		entry.loading = true;
		const [summary, checks, activity] = await Promise.allSettled([
			prRequests.summary(entry.machine, entry.ref),
			prRequests.checks(entry.machine, entry.ref),
			prRequests.activity(entry.machine, entry.ref),
		]);
		if (summary.status === "fulfilled") entry.summary = summary.value;
		if (checks.status === "fulfilled") entry.checks = checks.value?.checks ?? [];
		if (activity.status === "fulfilled") entry.activity = activity.value;
		entry.loading = false;
		entry.loadedAt = Date.now();
		entry.repaint();
	}

	#refresh(): void {
		const now = Date.now();
		for (const [key, entry] of this.#entries) {
			if (now - entry.seenAt > PR_WATCH_MS) this.#entries.delete(key);
			else if (!entry.loading && entry.machine.state.kind === "ready") void this.#load(entry);
		}
		if (this.#entries.size === 0) {
			clearInterval(this.#timer);
			this.#timer = undefined;
		}
	}
}

export const prStore = new PrStore();

/** The selected thread's pull request: the open one for its branch (not another layer of a stack), else any open one, else its first. */
export function threadPr(runtime: Pick<KeyRuntime, "board">, machine?: string): { thread: DeckThread; pr: ThreadPullRequest; ref: PullRequestRef | undefined } | undefined {
	const thread = runtime.board.selectedOn(machine);
	const pr = thread && threadPullRequest(thread.pullRequests, thread.branch);
	if (thread === undefined || pr === undefined) return undefined;
	return { thread, pr, ref: threadPullRequestRef(thread.projectId, pr) };
}

/** "1 thread" or "3 threads". */
export const counted = (count: number, one: MessageKey, many: MessageKey): string => (count === 1 ? t(one) : t(many, { count }));

const STATE_FACE: Record<string, { label: MessageKey; color: string }> = {
	open: { label: "pr.open", color: COLORS.done },
	merged: { label: "pr.merged", color: "#A371F7" },
	closed: { label: "pr.closed", color: COLORS.error },
};

/** One line about a pull request: failing checks, then findings, running checks, the review, passing checks. */
function prStatusLine(info: PrInfo | undefined): { text?: string; tint?: string } {
	if (info === undefined) return {};
	const checks = info.checks ?? [];
	const found = info.activity && findings({ ...info.activity, checks });
	const failed = checks.filter(failing).length;
	if (failed > 0) return { text: counted(failed, "pr.face.failingOne", "pr.face.failing"), tint: COLORS.error };
	if (found && found.total > 0) return { text: counted(found.total, "pr.face.findingsOne", "pr.face.findings"), tint: COLORS.attention };
	const state = classifyChecks(checks);
	if (state === "pending") return { text: t("pr.face.running") };
	if (info.summary?.reviewDecision === "changes-requested") return { text: t("pr.face.changesRequested"), tint: COLORS.attention };
	if (info.summary?.reviewDecision === "approved") return { text: t("pr.face.approved") };
	if (state === "passing") return { text: t("pr.face.passing") };
	return {};
}

/** How a pull request looks on the deck: its state's word and color (draft included), and its status line once read. */
export function prLook(thread: DeckThread, pr: ThreadPullRequest, repaint: () => void): { label: string | undefined; color: string; line: { text?: string; tint?: string } } {
	const ref = threadPullRequestRef(thread.projectId, pr);
	const info = ref && pr.state !== "merged" && pr.state !== "closed" ? prStore.get(thread.machine, ref, repaint) : undefined;
	const state = info?.summary?.state ?? pr.state;
	const draft = (info?.summary?.isDraft ?? pr.isDraft) === true && state === "open";
	const face = STATE_FACE[state ?? ""];
	return { label: draft ? t("pr.draft") : face && t(face.label), color: draft ? COLORS.muted : (face?.color ?? COLORS.text), line: prStatusLine(info) };
}

/** The Pull Request key: number and state, with its checks, review and findings once read. */
export function pullRequestKeyFace(thread: DeckThread, pr: ThreadPullRequest, repaint: () => void): string {
	const { label, color, line } = prLook(thread, pr, repaint);
	return renderInfoKey({ glyph: "pullRequest", color, tint: line.tint, title: `#${pr.number}${label ? ` · ${label}` : ""}`, detail: line.text ?? pr.title });
}

const linksPr = (thread: DeckThread, machine: Machine, ref: PullRequestRef): boolean =>
	thread.machine === machine && thread.projectId === ref.projectId && thread.pullRequests.some((link) => link.number === ref.number && link.repository === ref.repository);

/** The listed thread a pull request's work goes to: `prefer` when it links it (T3 Code's own panel thread), else a linked, unarchived one. */
async function linkedThread(runtime: KeyRuntime, machine: Machine, ref: PullRequestRef, prefer: DeckThread | undefined): Promise<DeckThread | undefined> {
	if (prefer !== undefined && linksPr(prefer, machine, ref)) return prefer;
	const linked = await prRequests.linkedThreads(machine, ref).catch(() => ({ threads: [] }));
	for (const candidate of linked.threads) {
		if (candidate.archivedAt !== null) continue;
		const row = runtime.board.threads.find((thread) => thread.machine === machine && thread.threadId === candidate.id);
		if (row !== undefined) return row;
	}
	return undefined;
}

/** Sends a handoff to an existing thread, queued behind a running turn rather than steering it; with the host's Ultrathink prefix while it has it armed there. */
async function sendTo(runtime: KeyRuntime, thread: DeckThread, message: ReturnType<typeof handoffMessage>): Promise<string> {
	const text = runtime.ultrathink?.prompt(thread.key, findModel(thread.machine.modelConfig, thread.model), message.text) ?? message.text;
	await thread.machine.send(thread, text, thread.active ? "queue" : "auto", message.context);
	return t(thread.active ? "pr.result.queued" : "result.sent");
}

/** Selects a thread `machine` just made, before its shell lists it. */
function selectNew(runtime: KeyRuntime, machine: Machine, threadId: string): void {
	if (machine.environmentId !== undefined) runtime.selectThread({ key: `${machine.environmentId}/${threadId}`, machine });
}

/**
 * T3 Code's Fix findings: the unresolved review threads, line-less remarks and failing checks, sent to the thread that
 * links the pull request, or to a new thread in a worktree checked out at it (`git.preparePullRequestThread`).
 */
export async function fixFindings(runtime: KeyRuntime, machine: Machine, ref: PullRequestRef, prefer?: DeckThread): Promise<string> {
	if (!machine.canOperate) throw new Error("This pairing is read-only.");
	const [detail, activity] = await Promise.all([prRequests.detail(machine, ref), prRequests.activity(machine, ref)]);
	const message = handoffMessage(
		buildFixFindingsHandoff({ ...detail, reviewThreads: activity.reviewThreads, comments: activity.comments, checks: detail.checks, commentsTruncated: activity.commentsTruncated }),
	);
	const target = await linkedThread(runtime, machine, ref, prefer);
	if (target !== undefined) return sendTo(runtime, target, message);
	if (!grants(machine.scopes, SOURCE_CONTROL_SCOPE)) throw new RpcError("EnvironmentAuthorizationError", "missing source control access", undefined, SOURCE_CONTROL_SCOPE);
	const threadId = crypto.randomUUID();
	const prepared = await prRequests.prepareWorktree(machine, { cwd: detail.workspaceRoot, url: detail.url, threadId });
	await machine.launch({ projectId: detail.projectId }, message.text, {
		threadId,
		context: message.context,
		workspaceStrategy: prepared.worktreePath === null ? { type: "root", branch: prepared.branch } : { type: "existing_worktree", worktreePath: prepared.worktreePath, branch: prepared.branch },
	});
	selectNew(runtime, machine, threadId);
	return t(prepared.isOnPullRequestHead === false ? "pr.result.offHead" : "result.started");
}

/** T3 Code's Explain: to the thread that hosts the pull request, else a new thread in its project, never checked out. */
export async function explainPr(runtime: KeyRuntime, machine: Machine, ref: PullRequestRef, prefer?: DeckThread): Promise<string> {
	if (!machine.canOperate) throw new Error("This pairing is read-only.");
	const detail = await prRequests.detail(machine, ref);
	const message = handoffMessage(buildExplainPullRequestHandoff(detail));
	if (prefer !== undefined && linksPr(prefer, machine, ref)) return sendTo(runtime, prefer, message);
	const { threadId } = await machine.launch({ projectId: detail.projectId }, message.text, { context: message.context });
	selectNew(runtime, machine, threadId);
	return t("result.started");
}

export type PrKeySettings = { machine?: string; confirm?: string; mode?: string };

type PrCheck = { ok: true; thread: DeckThread; pr: ThreadPullRequest; ref: PullRequestRef } | { ok: false; reason: string };

/** What the selected thread's pull request lets a handoff do, and why not when it can't. */
function prCheck(runtime: KeyRuntime, machine: string | undefined, operate: boolean): PrCheck {
	const found = threadPr(runtime, machine);
	if (runtime.board.selectedOn(machine) === undefined) return { ok: false, reason: t("reason.noThread") };
	if (found === undefined) return { ok: false, reason: t("reason.noPr") };
	if (found.ref === undefined) return { ok: false, reason: t("failure.updateT3") };
	if (operate && !found.thread.machine.canOperate) return { ok: false, reason: t("reason.readOnly") };
	return { ok: true, thread: found.thread, pr: found.pr, ref: found.ref };
}

/** What a face line says about the pull request, and whether the handoff can go ahead. */
type HandoffDetail = { text?: string; available: boolean; tint?: string };

/** Handing the selected thread's pull request to an agent, as T3 Code's pull request menu does. */
type Handoff = {
	glyph: GlyphName;
	label: (url: string) => string;
	/** Whether the pairing must be able to act, not just read. */
	operates: boolean;
	detail?: (runtime: KeyRuntime, thread: DeckThread, pr: ThreadPullRequest, ref: PullRequestRef) => HandoffDetail;
	act: (runtime: KeyRuntime, thread: DeckThread, ref: PullRequestRef) => Promise<string>;
};

/** Each pull request's review guide as last read, shared by every key that shows it. */
const guides = new Map<string, { result?: ReviewGuideResult; loading: boolean; polling: boolean }>();

function guideEntry(runtime: KeyRuntime, thread: DeckThread, ref: PullRequestRef) {
	const key = `${thread.machine.url}|${ref.projectId}|${ref.repository}#${ref.number}`;
	let entry = guides.get(key);
	if (entry === undefined) {
		entry = { loading: true, polling: false };
		setCapped(guides, key, entry);
		const created = entry;
		void prRequests
			.reviewGuide(thread.machine, ref)
			.then((result) => (created.result = result))
			.catch(() => undefined)
			.finally(() => {
				created.loading = false;
				runtime.repaint();
			});
	}
	return entry;
}

/** Re-reads the guide while it is being written, for at most a few minutes, then opens the thread once it is done. */
async function pollGuide(runtime: KeyRuntime, thread: DeckThread, ref: PullRequestRef, entry: { result?: ReviewGuideResult; polling: boolean }): Promise<void> {
	if (entry.polling) return;
	entry.polling = true;
	try {
		for (let attempt = 0; attempt < 45 && entry.result && guideState(entry.result) === "running"; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 4_000));
			entry.result = await prRequests.reviewGuide(thread.machine, ref);
			runtime.repaint();
		}
		if (entry.result && guideState(entry.result) === "ready") await runtime.openThread(thread);
	} catch (error) {
		runtime.warn(`Review guide polling stopped: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		entry.polling = false;
	}
}

/** The findings Fix findings would send, once the pull request's activity is read. */
export function prFindings(runtime: Pick<KeyRuntime, "repaint">, thread: DeckThread, ref: PullRequestRef) {
	const info = prStore.get(thread.machine, ref, runtime.repaint);
	return info.activity && findings({ ...info.activity, checks: info.checks ?? [] });
}

export type HandoffMode = "fix" | "explain" | "ask" | "guide";

export const HANDOFFS: Record<HandoffMode, Handoff> = {
	/** T3 Code's Fix findings, sent to the selected thread. Hold to send by default. */
	fix: {
		glyph: "hammer",
		label: () => t("pr.fix.title"),
		operates: true,
		detail: (runtime, thread, _pr, ref) => {
			const found = prFindings(runtime, thread, ref);
			if (found === undefined) return { available: true };
			if (found.total === 0) return { text: t("pr.fix.none"), available: false };
			const parts = [
				found.threads.length > 0 ? counted(found.threads.length, "pr.fix.threadOne", "pr.fix.threads") : undefined,
				found.remarks.length > 0 ? counted(found.remarks.length, "pr.fix.remarkOne", "pr.fix.remarks") : undefined,
				found.checks.length > 0 ? counted(found.checks.length, "pr.fix.checkOne", "pr.fix.checks") : undefined,
			];
			return { text: parts.filter(Boolean).join(" · "), available: true, tint: found.checks.length > 0 ? COLORS.error : undefined };
		},
		act: (runtime, thread, ref) => fixFindings(runtime, thread.machine, ref, thread),
	},
	/** T3 Code's Explain: a walk through the change, sent to the selected thread. */
	explain: {
		glyph: "book",
		label: (url) => t("pr.explain.title", { term: changeRequestLabel(url) }),
		operates: true,
		act: (runtime, thread, ref) => explainPr(runtime, thread.machine, ref, thread),
	},
	/**
	 * Opens the thread that holds the pull request in T3 Code, to ask about it there. T3 Code's own Ask puts the pull
	 * request in the composer, which lives in the app and can't be filled from outside.
	 */
	ask: {
		glyph: "question",
		label: (url) => t("pr.ask.title", { term: changeRequestLabel(url) }),
		operates: false,
		act: async (runtime, thread) => {
			await runtime.openThread(thread);
			return t("result.opened");
		},
	},
	/**
	 * Writes T3 Code's review guide (`pullRequests.generateReviewGuide`), shows its progress, then opens the thread,
	 * whose pull request panel has the guide; there is no link to the guide itself.
	 */
	guide: {
		glyph: "spark",
		label: () => t("pr.guide.title"),
		operates: true,
		detail: (runtime, thread, _pr, ref) => {
			const entry = guideEntry(runtime, thread, ref);
			if (entry.result === undefined) return { text: entry.loading ? undefined : t("pr.guide.write"), available: true };
			const state = guideState(entry.result);
			return { text: t(state === "ready" ? "pr.guide.ready" : state === "running" ? "pr.guide.writing" : state === "failed" ? "pr.guide.failed" : "pr.guide.write"), available: true };
		},
		act: async (runtime, thread, ref) => {
			const entry = guideEntry(runtime, thread, ref);
			// New commits make a written guide stale, so the press decides on a fresh read.
			entry.result = await prRequests.reviewGuide(thread.machine, ref);
			const state = guideState(entry.result);
			if (state === "ready") {
				await runtime.openThread(thread);
				return t("result.opened");
			}
			if (state !== "running") entry.result = await prRequests.generateReviewGuide(thread.machine, ref);
			runtime.repaint();
			void pollGuide(runtime, thread, ref, entry);
			return t("pr.guide.writing");
		},
	},
};

const defaultDetail = (pr: ThreadPullRequest): HandoffDetail => ({ text: `#${pr.number} ${pr.title ?? ""}`.trim(), available: true });

/** The pull request Show draws and opens: the same one the handoffs act on. */
export function shownPr(runtime: KeyRuntime, machine: string | undefined) {
	const thread = runtime.board.selectedOn(machine);
	const pr = thread && threadPullRequest(thread.pullRequests, thread.branch);
	return { thread, pr, check: availability("pr", { thread, canOperate: true }) };
}

export type PrState =
	| { mode: "show"; thread: DeckThread | undefined; pr: ThreadPullRequest | undefined; check: Availability }
	| { mode: HandoffMode; thread: DeckThread | undefined; check: PrCheck; detail: HandoffDetail | undefined };

/**
 * The selected thread's pull request (its Does setting): Show draws its number and state, with live checks, review and
 * findings, and a press opens it in the browser; the rest hand it to an agent as T3 Code's pull request menu does.
 * Only Fix findings asks for a hold (Stream Deck's To send setting), since it sends review comments to an agent.
 */
export const pullRequestKey: KeyDefinition<PrKeySettings, PrState> = {
	state(ctx) {
		const mode = modeOf("pr", undefined, ctx.settings);
		if (mode === "show") return { mode, ...shownPr(ctx.runtime, ctx.machine) };
		const handoff = HANDOFFS[mode];
		const check = prCheck(ctx.runtime, ctx.machine, handoff.operates);
		const thread = ctx.runtime.board.selectedOn(ctx.machine);
		if (!check.ok) return { mode, thread, check, detail: undefined };
		return { mode, thread, check, detail: handoff.detail?.(ctx.runtime, check.thread, check.pr, check.ref) ?? defaultDetail(check.pr) };
	},

	tile(state, ctx) {
		if (state.mode === "show") {
			const { thread, pr, check } = state;
			if (pr === undefined) return renderInfoKey({ glyph: "pullRequest", title: t("face.pullRequest"), detail: check.available ? undefined : check.reason, available: false });
			return pullRequestKeyFace(thread!, pr, ctx.runtime.repaint);
		}
		const handoff = HANDOFFS[state.mode];
		const { check, detail } = state;
		if (!check.ok) return renderInfoKey({ glyph: handoff.glyph, title: handoff.label(""), detail: check.reason, available: false });
		const title = handoff.label(check.pr.url);
		return renderInfoKey({ glyph: handoff.glyph, title: state.mode === "fix" && detail!.available ? withHold(ctx, title) : title, detail: detail!.text, available: detail!.available, tint: detail!.tint });
	},

	label: ({ thread }) => thread?.title,
	available: (state) => (state.mode === "show" ? state.pr !== undefined : state.check.ok && state.detail!.available),

	press(state, ctx, input) {
		if (state.mode === "show") {
			const { pr, check } = state;
			if (!check.available) return { kind: "fail", label: check.reason };
			if (!URL.canParse(pr!.url) || new URL(pr!.url).protocol !== "https:") return { kind: "fail", label: t("result.notWebLink") };
			return { kind: "run", work: () => ctx.runtime.openUrl(pr!.url) };
		}
		const { mode, check, detail } = state;
		if (!check.ok) return { kind: "fail", label: check.reason };
		if (!detail!.available) return { kind: "fail", label: detail!.text ?? t("strip.notNow") };
		if (mode === "fix" && !confirmed(input, () => ctx.settings.confirm === "tap" || input.heldMs >= HOLD_CONFIRM_MS)) return { kind: "needsHold", label: t("repo.holdTo") };
		return { kind: "run", work: () => HANDOFFS[mode].act(ctx.runtime, check.thread, check.ref) };
	},
};
