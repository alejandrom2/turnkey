import streamDeck, { type Action, action, type DialAction, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";

import { HOLD_CONFIRM_MS } from "../core/approvals.js";
import type { DeckThread } from "../core/board.js";
import { failureLabel } from "../core/feedback.js";
import { type MessageKey, t } from "../core/i18n.js";
import {
	buildExplainPullRequestHandoff,
	buildFixFindingsHandoff,
	changeRequestLabel,
	classifyChecks,
	findings,
	guideState,
	handoffMessage,
	type PullRequestActivity,
	type PullRequestCheck,
	type PullRequestListEntry,
	type PullRequestRef,
	type PullRequestSummary,
	prRequests,
	type ReviewGuideResult,
	threadPullRequestRef,
} from "../core/pr.js";
import { COLORS, glyphArt, type GlyphName, renderInfoKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { grants } from "../core/scopes.js";
import type { StripContent } from "../core/strip.js";
import type { StripList } from "../core/styles.js";
import type { Machine } from "../core/t3/machine.js";
import { SOURCE_CONTROL_SCOPE } from "../core/t3/pairing.js";
import { RpcError } from "../core/t3/rpc.js";
import type { ThreadPullRequest } from "../core/t3/shell.js";
import { deck } from "../deck.js";
import { canOperate, connectionFace, DeckAction, openThread, pressWhileDisconnected, selectedThread, selectThread, ultrathinkPrompt } from "./base.js";
import { connectionOf, threadNeeds } from "./needs.js";
import { type DialSettings, disconnectedStrip, StripDial } from "./strip.js";

const ID = "com.alejandrom2.t3deck";
const logger = streamDeck.logger.createScope("pr");

/** How long a pull request's checks, review and findings stay fresh while a key shows them. */
const PR_TTL_MS = 60_000;
/** Entries no key has shown for this long stop refreshing. */
const PR_WATCH_MS = 120_000;

type PrInfo = { summary?: PullRequestSummary; checks?: readonly PullRequestCheck[]; activity?: PullRequestActivity; loadedAt: number; loading: boolean; seenAt: number };

/**
 * Live state per pull request for the keys and the dial: `pullRequests.summary` (review), `.checks` and `.activity`
 * (findings), read when a key first shows one and refreshed once a minute while one does.
 */
class PrStore {
	readonly #entries = new Map<string, PrInfo & { machine: Machine; ref: PullRequestRef }>();
	#timer: ReturnType<typeof setInterval> | undefined;

	get(machine: Machine, ref: PullRequestRef): PrInfo {
		const key = `${machine.url}|${ref.projectId}|${ref.host ?? ""}|${ref.repository}#${ref.number}`;
		const now = Date.now();
		let entry = this.#entries.get(key);
		if (entry === undefined) {
			entry = { machine, ref, loadedAt: 0, loading: false, seenAt: now };
			this.#entries.set(key, entry);
		}
		entry.seenAt = now;
		if (!entry.loading && now - entry.loadedAt > PR_TTL_MS) void this.#load(entry);
		this.#timer ??= setInterval(() => this.#refresh(), PR_TTL_MS);
		return entry;
	}

	async #load(entry: PrInfo & { machine: Machine; ref: PullRequestRef }): Promise<void> {
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
		deck.repaint();
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

const store = new PrStore();

/** The selected thread's pull request: its open one, else its first. */
export function threadPr(machine?: string): { thread: DeckThread; pr: ThreadPullRequest; ref: PullRequestRef | undefined } | undefined {
	const thread = selectedThread(machine);
	const pr = thread?.pullRequests.find((link) => link.state === "open") ?? thread?.pullRequests[0];
	if (thread === undefined || pr === undefined) return undefined;
	return { thread, pr, ref: threadPullRequestRef(thread.projectId, pr) };
}

/** "1 thread" or "3 threads". */
const counted = (count: number, one: MessageKey, many: MessageKey): string => (count === 1 ? t(one) : t(many, { count }));

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
	const failing = checks.filter((check) => check.status === "failure" || check.status === "cancelled").length;
	if (failing > 0) return { text: counted(failing, "pr.face.failingOne", "pr.face.failing"), tint: COLORS.error };
	if (found && found.total > 0) return { text: counted(found.total, "pr.face.findingsOne", "pr.face.findings"), tint: COLORS.attention };
	const state = classifyChecks(checks);
	if (state === "pending") return { text: t("pr.face.running") };
	if (info.summary?.reviewDecision === "changes-requested") return { text: t("pr.face.changesRequested"), tint: COLORS.attention };
	if (info.summary?.reviewDecision === "approved") return { text: t("pr.face.approved") };
	if (state === "passing") return { text: t("pr.face.passing") };
	return {};
}

/** The Pull Request key: number and state, with its checks, review and findings once read. */
export function pullRequestKeyFace(thread: DeckThread, pr: ThreadPullRequest): string {
	const ref = threadPullRequestRef(thread.projectId, pr);
	const info = ref && pr.state !== "merged" && pr.state !== "closed" ? store.get(thread.machine, ref) : undefined;
	const state = info?.summary?.state ?? pr.state;
	const draft = (info?.summary?.isDraft ?? pr.isDraft) === true && state === "open";
	const face = STATE_FACE[state ?? ""];
	const label = draft ? t("pr.draft") : face && t(face.label);
	const line = prStatusLine(info);
	return renderInfoKey({
		glyph: "pullRequest",
		color: draft ? COLORS.muted : (face?.color ?? COLORS.text),
		tint: line.tint,
		title: `#${pr.number}${label ? ` · ${label}` : ""}`,
		detail: line.text ?? pr.title,
	});
}

const linksPr = (thread: DeckThread, ref: PullRequestRef): boolean =>
	thread.projectId === ref.projectId && thread.pullRequests.some((link) => link.number === ref.number && link.repository === ref.repository);

/** The listed thread a pull request's work goes to: `prefer` when it links it (T3 Code's own panel thread), else a linked, unarchived one. */
async function linkedThread(machine: Machine, ref: PullRequestRef, prefer: DeckThread | undefined): Promise<DeckThread | undefined> {
	if (prefer !== undefined && linksPr(prefer, ref)) return prefer;
	const linked = await prRequests.linkedThreads(machine, ref).catch(() => ({ threads: [] }));
	for (const candidate of linked.threads) {
		if (candidate.archivedAt !== null) continue;
		const row = deck.board.threads.find((thread) => thread.machine === machine && thread.threadId === candidate.id);
		if (row !== undefined) return row;
	}
	return undefined;
}

/** Sends a handoff to an existing thread, queued behind a running turn rather than steering it. */
async function sendTo(thread: DeckThread, message: ReturnType<typeof handoffMessage>): Promise<string> {
	await thread.machine.send(thread, ultrathinkPrompt(thread, message.text), thread.active ? "queue" : "auto", message.context);
	return t(thread.active ? "pr.result.queued" : "result.sent");
}

/**
 * T3 Code's Fix findings: the unresolved review threads, line-less remarks and failing checks, sent to the thread that
 * links the pull request, or to a new thread in a worktree checked out at it (`git.preparePullRequestThread`).
 */
export async function fixFindings(machine: Machine, ref: PullRequestRef, prefer?: DeckThread): Promise<string> {
	if (!machine.canOperate) throw new Error("This pairing is read-only.");
	const [detail, activity] = await Promise.all([prRequests.detail(machine, ref), prRequests.activity(machine, ref)]);
	const message = handoffMessage(
		buildFixFindingsHandoff({ ...detail, reviewThreads: activity.reviewThreads, comments: activity.comments, checks: detail.checks, commentsTruncated: activity.commentsTruncated }),
	);
	const target = await linkedThread(machine, ref, prefer);
	if (target !== undefined) return sendTo(target, message);
	if (!grants(machine.scopes, SOURCE_CONTROL_SCOPE)) throw new RpcError("EnvironmentAuthorizationError", "missing source control access", undefined, SOURCE_CONTROL_SCOPE);
	const threadId = crypto.randomUUID();
	const prepared = await prRequests.prepareWorktree(machine, { cwd: detail.workspaceRoot, url: detail.url, threadId });
	await machine.launch({ projectId: detail.projectId }, message.text, {
		threadId,
		context: message.context,
		workspaceStrategy: prepared.worktreePath === null ? { type: "root", branch: prepared.branch } : { type: "existing_worktree", worktreePath: prepared.worktreePath, branch: prepared.branch },
	});
	if (machine.environmentId !== undefined) selectThread({ key: `${machine.environmentId}/${threadId}`, machine });
	return t(prepared.isOnPullRequestHead === false ? "pr.result.offHead" : "result.started");
}

/** T3 Code's Explain: to the thread that hosts the pull request, else a new thread in its project, never checked out. */
export async function explainPr(machine: Machine, ref: PullRequestRef, prefer?: DeckThread): Promise<string> {
	if (!machine.canOperate) throw new Error("This pairing is read-only.");
	const detail = await prRequests.detail(machine, ref);
	const message = handoffMessage(buildExplainPullRequestHandoff(detail));
	if (prefer !== undefined && linksPr(prefer, ref)) return sendTo(prefer, message);
	const { threadId } = await machine.launch({ projectId: detail.projectId }, message.text, { context: message.context });
	if (machine.environmentId !== undefined) selectThread({ key: `${machine.environmentId}/${threadId}`, machine });
	return t("result.started");
}

type PrKeySettings = { machine?: string; confirm?: string };

/** What the selected thread's pull request lets a handoff key do, and why not when it can't. */
function prCheck(machine: string | undefined, operate: boolean): { ok: true; thread: DeckThread; pr: ThreadPullRequest; ref: PullRequestRef } | { ok: false; reason: string } {
	const found = threadPr(machine);
	if (selectedThread(machine) === undefined) return { ok: false, reason: t("reason.noThread") };
	if (found === undefined) return { ok: false, reason: t("reason.noPr") };
	if (found.ref === undefined) return { ok: false, reason: t("failure.updateT3") };
	if (operate && !canOperate(found.thread)) return { ok: false, reason: t("reason.readOnly") };
	return { ok: true, thread: found.thread, pr: found.pr, ref: found.ref };
}

/** A key that hands the selected thread's pull request to an agent, as T3 Code's pull request menu does. */
abstract class PrHandoffKey extends DeckAction<PrKeySettings> {
	protected abstract readonly glyph: GlyphName;
	protected abstract label(url: string): string;
	/** Whether a press needs a hold unless set to tap. */
	protected readonly holdByDefault: boolean = false;
	protected readonly operates: boolean = true;

	protected detail(_thread: DeckThread, pr: ThreadPullRequest, _ref: PullRequestRef): { text?: string; available: boolean; tint?: string } {
		return { text: `#${pr.number} ${pr.title ?? ""}`.trim(), available: true };
	}

	protected abstract act(thread: DeckThread, ref: PullRequestRef): Promise<string>;

	protected override async paint(action: Action<PrKeySettings>): Promise<void> {
		if (!action.isKey()) return;
		const machine = this.machineOf(action);
		const offline = connectionFace(machine);
		if (offline) return void (await this.setImage(action, offline));
		const check = prCheck(machine, this.operates);
		const url = check.ok ? check.pr.url : "";
		if (!check.ok) return void (await this.setImage(action, renderInfoKey({ glyph: this.glyph, title: this.label(url), detail: check.reason, available: false })));
		const detail = this.detail(check.thread, check.pr, check.ref);
		await this.setImage(action, renderInfoKey({ glyph: this.glyph, title: this.label(url), detail: detail.text, available: detail.available, tint: detail.tint }));
	}

	override onKeyDown(ev: KeyDownEvent<PrKeySettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<PrKeySettings>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const check = prCheck(this.machineOf(ev.action), this.operates);
		if (!check.ok) return void (await this.flash(ev.action, false, check.reason));
		const confirm = this.settingsOf(ev.action).confirm;
		const hold = confirm === "hold" || (confirm !== "tap" && this.holdByDefault);
		if (hold && held < HOLD_CONFIRM_MS) return void (await this.flash(ev.action, false, t("repo.holdTo")));
		try {
			await this.flash(ev.action, true, await this.act(check.thread, check.ref));
		} catch (error) {
			logger.warn(`${this.manifestId} failed: ${error instanceof Error ? error.message : String(error)}`);
			await this.flash(ev.action, false, failureLabel(error));
		}
	}

	override needs(action: Action<PrKeySettings>): Need[] {
		const machine = this.machineOf(action);
		const found = threadPr(machine);
		return [...threadNeeds(machine, selectedThread(machine), this.operates), { kind: "pr", ok: found?.ref !== undefined }];
	}
}

/** T3 Code's Fix findings for the selected thread's pull request, sent to that thread. Hold to send by default. */
@action({ UUID: `${ID}.pr.fix` })
export class FixFindingsKey extends PrHandoffKey {
	protected readonly glyph = "hammer";
	protected override readonly holdByDefault = true;

	protected label(): string {
		return t("pr.fix.title");
	}

	protected override detail(thread: DeckThread, _pr: ThreadPullRequest, ref: PullRequestRef) {
		const info = store.get(thread.machine, ref);
		if (info.activity === undefined) return { text: t("face.loading"), available: true };
		const found = findings({ ...info.activity, checks: info.checks ?? [] });
		if (found.total === 0) return { text: t("pr.fix.none"), available: false };
		const parts = [
			found.threads.length > 0 ? counted(found.threads.length, "pr.fix.threadOne", "pr.fix.threads") : undefined,
			found.remarks.length > 0 ? counted(found.remarks.length, "pr.fix.remarkOne", "pr.fix.remarks") : undefined,
			found.checks.length > 0 ? counted(found.checks.length, "pr.fix.checkOne", "pr.fix.checks") : undefined,
		];
		return { text: parts.filter(Boolean).join(" · "), available: true, tint: found.checks.length > 0 ? COLORS.error : undefined };
	}

	protected act(thread: DeckThread, ref: PullRequestRef): Promise<string> {
		return fixFindings(thread.machine, ref, thread);
	}

	override needs(action: Action<PrKeySettings>): Need[] {
		const found = threadPr(this.machineOf(action));
		const info = found?.ref && store.get(found.thread.machine, found.ref);
		const total = info?.activity && findings({ ...info.activity, checks: info.checks ?? [] }).total;
		return [...super.needs(action), { kind: "findings", ok: total === undefined ? undefined : total > 0 }];
	}
}

/** T3 Code's Explain for the selected thread's pull request: a walk through the change, sent to that thread. */
@action({ UUID: `${ID}.pr.explain` })
export class ExplainPrKey extends PrHandoffKey {
	protected readonly glyph = "book";

	protected label(url: string): string {
		return t("pr.explain.title", { term: changeRequestLabel(url) });
	}

	protected act(thread: DeckThread, ref: PullRequestRef): Promise<string> {
		return explainPr(thread.machine, ref, thread);
	}
}

/**
 * Opens the thread that holds the selected thread's pull request in T3 Code, to ask about it there. T3 Code's own Ask
 * puts the pull request in the composer, which lives in the app and can't be filled from outside.
 */
@action({ UUID: `${ID}.pr.ask` })
export class AskPrKey extends PrHandoffKey {
	protected readonly glyph = "question";
	protected override readonly operates = false;

	protected label(url: string): string {
		return t("pr.ask.title", { term: changeRequestLabel(url) });
	}

	protected async act(thread: DeckThread): Promise<string> {
		await openThread(thread);
		return t("result.opened");
	}
}

/**
 * Writes T3 Code's review guide for the selected thread's pull request (`pullRequests.generateReviewGuide`), shows its
 * progress, then opens the thread, whose pull request panel has the guide; there is no link to the guide itself.
 */
@action({ UUID: `${ID}.pr.guide` })
export class ReviewGuideKey extends PrHandoffKey {
	protected readonly glyph = "spark";
	readonly #guides = new Map<string, { result?: ReviewGuideResult; loading: boolean; polling: boolean }>();

	protected label(): string {
		return t("pr.guide.title");
	}

	#entry(thread: DeckThread, ref: PullRequestRef) {
		const key = `${thread.machine.url}|${ref.projectId}|${ref.repository}#${ref.number}`;
		let entry = this.#guides.get(key);
		if (entry === undefined) {
			entry = { loading: true, polling: false };
			this.#guides.set(key, entry);
			const created = entry;
			void prRequests
				.reviewGuide(thread.machine, ref)
				.then((result) => (created.result = result))
				.catch(() => undefined)
				.finally(() => {
					created.loading = false;
					deck.repaint();
				});
		}
		return entry;
	}

	protected override detail(thread: DeckThread, _pr: ThreadPullRequest, ref: PullRequestRef) {
		const entry = this.#entry(thread, ref);
		if (entry.result === undefined) return { text: entry.loading ? t("face.loading") : t("pr.guide.write"), available: true };
		const state = guideState(entry.result);
		return { text: t(state === "ready" ? "pr.guide.ready" : state === "running" ? "pr.guide.writing" : state === "failed" ? "pr.guide.failed" : "pr.guide.write"), available: true };
	}

	protected async act(thread: DeckThread, ref: PullRequestRef): Promise<string> {
		const entry = this.#entry(thread, ref);
		const state = entry.result && guideState(entry.result);
		if (state === "ready") {
			await openThread(thread);
			return t("result.opened");
		}
		if (state !== "running") entry.result = await prRequests.generateReviewGuide(thread.machine, ref);
		deck.repaint();
		void this.#poll(thread, ref, entry);
		return t("pr.guide.writing");
	}

	/** Re-reads the guide while it is being written, for at most a few minutes, then opens the thread once it is done. */
	async #poll(thread: DeckThread, ref: PullRequestRef, entry: { result?: ReviewGuideResult; polling: boolean }): Promise<void> {
		if (entry.polling) return;
		entry.polling = true;
		try {
			for (let attempt = 0; attempt < 45 && entry.result && guideState(entry.result) === "running"; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 4_000));
				entry.result = await prRequests.reviewGuide(thread.machine, ref);
				deck.repaint();
			}
			if (entry.result && guideState(entry.result) === "ready") await openThread(thread);
		} catch (error) {
			logger.warn(`Review guide polling stopped: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			entry.polling = false;
		}
	}
}

type PrDialSettings = DialSettings & { confirm?: string };

const CHECK_COLOR: Record<string, string> = { failing: COLORS.error, pending: COLORS.accent, passing: COLORS.done };

/**
 * Rotate through the open pull requests T3 Code lists (`pullRequests.list`) on the dial's machine, or all. Press runs
 * Fix findings (a hold by default), a tap opens it in the browser, and a long touch reads its findings.
 */
@action({ UUID: `${ID}.dial.pr` })
export class PrDial extends StripDial<PrDialSettings> {
	readonly #index = new Map<string, number>();
	readonly #lists = new Map<string, { entries: { machine: Machine; entry: PullRequestListEntry }[]; loadedAt: number; loading: boolean }>();

	#list(action: Action<PrDialSettings>) {
		const machine = this.machineOf(action);
		const key = machine ?? "";
		let list = this.#lists.get(key);
		if (list === undefined || (!list.loading && Date.now() - list.loadedAt > PR_WATCH_MS)) {
			const next = { entries: list?.entries ?? [], loadedAt: list?.loadedAt ?? 0, loading: true };
			this.#lists.set(key, next);
			list = next;
			const machines = deck.machines.filter((candidate) => candidate.state.kind === "ready" && (machine === undefined || candidate.url === machine));
			void Promise.all(machines.map((candidate) => prRequests.list(candidate).then((result) => result.entries.map((entry) => ({ machine: candidate, entry })), () => [])))
				.then((lists) => {
					next.entries = lists.flat();
					next.loadedAt = Date.now();
				})
				.finally(() => {
					next.loading = false;
					deck.repaint();
				});
		}
		const index = Math.min(this.#index.get(action.id) ?? 0, Math.max(0, list.entries.length - 1));
		return { entries: list.entries, index, current: list.entries[index], loading: list.loading };
	}

	#refOf(entry: PullRequestListEntry): PullRequestRef {
		return { projectId: entry.projectId, host: entry.host, repository: entry.repository, number: entry.number };
	}

	#findingsText(machine: Machine, entry: PullRequestListEntry): string | undefined {
		const info = store.get(machine, this.#refOf(entry));
		if (info.activity === undefined) return undefined;
		const found = findings({ ...info.activity, checks: info.checks ?? [] });
		if (found.total === 0) return t("pr.fix.none");
		return [
			found.checks.length > 0 ? `${counted(found.checks.length, "pr.fix.checkOne", "pr.fix.checks")}: ${found.checks.map((check) => check.name).join(", ")}` : undefined,
			found.threads.length > 0 ? `${counted(found.threads.length, "pr.fix.threadOne", "pr.fix.threads")}: ${found.threads.map((thread) => thread.path).join(", ")}` : undefined,
			found.remarks.length > 0 ? counted(found.remarks.length, "pr.fix.remarkOne", "pr.fix.remarks") : undefined,
		]
			.filter(Boolean)
			.join(" · ");
	}

	protected face(action: Action<PrDialSettings>): StripContent {
		const header = t("pr.dial.title");
		const offline = disconnectedStrip(header, this.machineOf(action));
		if (offline) return offline;
		const { entries, index, current, loading } = this.#list(action);
		if (current === undefined) return { header, icon: glyphArt("pullRequest", COLORS.muted), accent: COLORS.muted, value: t(loading ? "face.loading" : "pr.dial.none") };
		const color = CHECK_COLOR[current.entry.checksState ?? ""] ?? COLORS.text;
		const found = this.#findingsText(current.machine, current.entry);
		return {
			header: `${header} · ${index + 1}/${entries.length}`,
			icon: glyphArt("pullRequest", current.entry.isDraft ? COLORS.muted : color),
			accent: color,
			value: current.entry.title,
			detail: [`#${current.entry.number}`, current.entry.repository, found].filter(Boolean).join(" · "),
			tone: current.entry.checksState === "failing" ? "failed" : "neutral",
			scroll: ["detail", "value"],
		};
	}

	protected override list(action: Action<PrDialSettings>): StripList | undefined {
		if (disconnectedStrip("", this.machineOf(action))) return undefined;
		const { entries, index } = this.#list(action);
		if (entries.length === 0) return undefined;
		return {
			heading: t("pr.dial.title"),
			index,
			items: entries.map(({ machine, entry }, at) => ({
				key: `${machine.url}|${entry.repository}#${entry.number}`,
				label: entry.title,
				art: glyphArt("pullRequest", CHECK_COLOR[entry.checksState ?? ""] ?? COLORS.text),
				detail: at === index ? [`#${entry.number} · ${entry.repository}`, this.#findingsText(machine, entry)].filter(Boolean).join("\n") : undefined,
			})),
		};
	}

	protected override rotated(dial: DialAction<PrDialSettings>, ticks: number): void {
		const { entries, index } = this.#list(dial);
		if (entries.length > 0) this.#index.set(dial.id, Math.min(entries.length - 1, Math.max(0, index + ticks)));
	}

	protected override async pressed(dial: DialAction<PrDialSettings>, heldMs: number): Promise<void> {
		const machine = this.machineOf(dial);
		if (await pressWhileDisconnected(machine)) return;
		const { current } = this.#list(dial);
		if (current === undefined) return void (await this.flash(dial, false, t("pr.dial.none")));
		if (!current.machine.canOperate) return void (await this.flash(dial, false, t("reason.readOnly")));
		if (this.settingsOf(dial).confirm !== "tap" && heldMs < HOLD_CONFIRM_MS) return void (await this.flash(dial, false, t("repo.holdTo")));
		try {
			const label = await fixFindings(current.machine, this.#refOf(current.entry), selectedThread(machine));
			await this.flash(dial, true, label);
		} catch (error) {
			logger.warn(`Fix findings failed: ${error instanceof Error ? error.message : String(error)}`);
			await this.flash(dial, false, failureLabel(error));
		}
	}

	protected override async tapped(dial: DialAction<PrDialSettings>): Promise<void> {
		const { current } = this.#list(dial);
		if (current === undefined) return;
		if (!URL.canParse(current.entry.url) || new URL(current.entry.url).protocol !== "https:") return void (await this.flash(dial, false, t("result.notWebLink")));
		await this.run(dial, () => streamDeck.system.openUrl(current.entry.url), t("result.opened"));
	}

	override needs(action: Action<PrDialSettings>): Need[] {
		const machine = this.machineOf(action);
		const { current, loading } = this.#list(action);
		const operate = current?.machine.canOperate ?? deck.machines.some((candidate) => candidate.canOperate && (machine === undefined || candidate.url === machine));
		return [
			{ kind: "paired", connection: connectionOf(machine) },
			{ kind: "operate", ok: operate },
			{ kind: "pr", ok: current !== undefined ? true : loading ? undefined : false },
			{ kind: "scope", scope: SOURCE_CONTROL_SCOPE, ok: current === undefined || grants(current.machine.scopes, SOURCE_CONTROL_SCOPE) },
		];
	}
}
