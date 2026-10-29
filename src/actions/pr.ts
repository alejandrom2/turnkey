import streamDeck, { type Action, action, type DialAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { DeckThread } from "../core/board.js";
import { t } from "../core/i18n.js";
import { renderInfoBar, renderNoticeBar } from "../core/infobar.js";
import { counted, fixFindings, HANDOFFS, PR_WATCH_MS, pullRequestKey, prFindings, type PrKeySettings, prLook, type PrState, prStore, shownPr, threadPr } from "../core/keys/pr.js";
import { modeOf } from "../core/modes.js";
import { findings, type PullRequestListEntry, type PullRequestRef, prRequests } from "../core/pr.js";
import { COLORS, glyphArt } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { grants } from "../core/scopes.js";
import type { StripContent } from "../core/strip.js";
import type { StripList } from "../core/styles.js";
import type { Machine } from "../core/t3/machine.js";
import { SOURCE_CONTROL_SCOPE } from "../core/t3/pairing.js";
import type { ThreadPullRequest } from "../core/t3/shell.js";
import { deck } from "../deck.js";
import { canOperate, held, pressWhileDisconnected, readyMachines, selectedThread } from "./base.js";
import { connectionNotice } from "./infobar.js";
import { connectionOf, threadNeeds } from "./needs.js";
import { deckRuntime } from "./runtime.js";
import { SharedKey } from "./shared.js";
import { type DialSettings, StripDial } from "./strip.js";

const ID = "com.alejandrom2.turnkey";

/** The Pull Request info bar: number and title, then state and status line in the state's color. */
function pullRequestBar(thread: DeckThread, pr: ThreadPullRequest): string {
	const { label, color, line } = prLook(thread, pr, deckRuntime.repaint);
	return renderInfoBar({
		icon: { glyph: "pullRequest", color },
		wash: color,
		title: `#${pr.number} ${pr.title}`,
		detail: [label, line.text].filter(Boolean).join(" · "),
		detailColor: line.tint ?? color,
	});
}

type Settings = PrKeySettings & JsonObject;

/** The selected thread's pull request, shown or handed to an agent by its Does setting (`prKey`); on the Neo info bar, shown. */
abstract class PullRequestAction extends SharedKey<Settings, PrState> {
	protected readonly definition = pullRequestKey;

	/** A single-purpose key saved before Pull Request had a Does setting acts as its UUID says. */
	protected override definitionSettings(action: Action<Settings>): Settings {
		const settings = this.settingsOf(action);
		return { ...settings, mode: modeOf("pr", this.manifestId, settings) };
	}

	protected override async draw(action: Action<Settings>): Promise<void> {
		if (action.isNeoInfobar()) return this.#paintBar(action);
		await super.draw(action);
	}

	/** On the Neo info bar, whatever the Does setting: the selected thread's pull request. */
	async #paintBar(action: Action<Settings>): Promise<void> {
		const notice = connectionNotice(this.machineOf(action));
		if (notice) return this.setBar(action, renderNoticeBar(notice));
		const { thread, pr, check } = shownPr(deckRuntime, this.machineOf(action));
		if (pr === undefined)
			return this.setBar(action, renderInfoBar({ icon: { glyph: "pullRequest", color: COLORS.muted }, title: t("face.pullRequest"), detail: check.available ? t("reason.noPr") : check.reason, available: false }));
		await this.setBar(action, pullRequestBar(thread!, pr));
	}

	override needs(action: Action<Settings>): Need[] {
		const machine = this.machineOf(action);
		const thread = selectedThread(machine);
		const mode = modeOf("pr", this.manifestId, this.settingsOf(action));
		if (mode === "show") return [...threadNeeds(machine, thread, false), { kind: "pr", ok: (thread?.pullRequests.length ?? 0) > 0 }];
		const found = threadPr(deckRuntime, machine);
		const needs: Need[] = [...threadNeeds(machine, thread, HANDOFFS[mode].operates), { kind: "pr", ok: found?.ref !== undefined }];
		if (mode !== "fix") return needs;
		const total = found?.ref && prFindings(deckRuntime, found.thread, found.ref)?.total;
		return [...needs, { kind: "findings", ok: total === undefined ? undefined : total > 0 }];
	}
}

@action({ UUID: `${ID}.pr` })
export class PullRequest extends PullRequestAction {}

// Fix Findings, Explain PR, Ask about PR and Review Guide, which Pull Request's Does setting replaced: hidden from
// the actions list, still on decks and in older profiles.
@action({ UUID: `${ID}.pr.fix` })
export class FixFindingsKey extends PullRequestAction {}

@action({ UUID: `${ID}.pr.explain` })
export class ExplainPrKey extends PullRequestAction {}

@action({ UUID: `${ID}.pr.ask` })
export class AskPrKey extends PullRequestAction {}

@action({ UUID: `${ID}.pr.guide` })
export class ReviewGuideKey extends PullRequestAction {}

type PrDialSettings = DialSettings & { confirm?: string };

/** A listed pull request's identity across list reads. */
const prKey = ({ machine, entry }: { machine: Machine; entry: PullRequestListEntry }) => `${machine.url}|${entry.repository}#${entry.number}`;

const CHECK_COLOR: Record<string, string> = { failing: COLORS.error, pending: COLORS.accent, passing: COLORS.done };

/**
 * Rotate through the open pull requests T3 Code lists (`pullRequests.list`) on the dial's machine, or all. Press runs
 * Fix findings (a hold by default), a tap opens it in the browser, and a long touch reads its findings.
 */
@action({ UUID: `${ID}.dial.pr` })
export class PrDial extends StripDial<PrDialSettings> {
	/** The pull request each dial shows, by key, so it stays put as the list changes. */
	readonly #shown = new Map<string, string>();
	readonly #lists = new Map<string, { entries: { machine: Machine; entry: PullRequestListEntry }[]; loadedAt: number; loading: boolean }>();

	override onWillDisappear(ev: Parameters<StripDial<PrDialSettings>["onWillDisappear"]>[0]): void {
		this.#shown.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	#list(action: Action<PrDialSettings>) {
		const machine = this.machineOf(action);
		const key = machine ?? "";
		let list = this.#lists.get(key);
		if (list === undefined || (!list.loading && Date.now() - list.loadedAt > PR_WATCH_MS)) {
			const next = { entries: list?.entries ?? [], loadedAt: list?.loadedAt ?? 0, loading: true };
			this.#lists.set(key, next);
			list = next;
			const machines = readyMachines(machine);
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
		const index = Math.max(
			0,
			list.entries.findIndex((item) => prKey(item) === this.#shown.get(action.id)),
		);
		return { entries: list.entries, index, current: list.entries[index], loading: list.loading };
	}

	#refOf(entry: PullRequestListEntry): PullRequestRef {
		return { projectId: entry.projectId, host: entry.host, repository: entry.repository, number: entry.number };
	}

	#findingsText(machine: Machine, entry: PullRequestListEntry): string | undefined {
		const info = prStore.get(machine, this.#refOf(entry), deckRuntime.repaint);
		if (info.activity === undefined) return undefined;
		const found = findings({ ...info.activity, checks: info.checks ?? [] });
		if (found.total === 0) return t("pr.fix.none");
		return [
			found.checks.length > 0 ? t("pr.fix.named", { findings: counted(found.checks.length, "pr.fix.checkOne", "pr.fix.checks"), names: found.checks.map((check) => check.name).join(", ") }) : undefined,
			found.threads.length > 0 ? t("pr.fix.named", { findings: counted(found.threads.length, "pr.fix.threadOne", "pr.fix.threads"), names: found.threads.map((thread) => thread.path).join(", ") }) : undefined,
			found.remarks.length > 0 ? counted(found.remarks.length, "pr.fix.remarkOne", "pr.fix.remarks") : undefined,
		]
			.filter(Boolean)
			.join(" · ");
	}

	protected heading(): string {
		return t("pr.dial.title");
	}

	protected face(action: Action<PrDialSettings>): StripContent {
		const header = this.heading();
		const { entries, index, current, loading } = this.#list(action);
		if (current === undefined) return { header, icon: glyphArt("pullRequest", COLORS.muted), value: loading ? "" : t("pr.dial.none"), loading };
		const color = CHECK_COLOR[current.entry.checksState ?? ""] ?? COLORS.text;
		const found = this.#findingsText(current.machine, current.entry);
		return {
			header: `${header} · ${index + 1}/${entries.length}`,
			icon: glyphArt("pullRequest", current.entry.isDraft ? COLORS.muted : color),
			value: current.entry.title,
			detail: [`#${current.entry.number}`, current.entry.repository, found].filter(Boolean).join(" · "),
			tone: current.entry.checksState === "failing" ? "failed" : "neutral",
			scroll: ["detail", "value"],
		};
	}

	protected override list(action: Action<PrDialSettings>): StripList | undefined {
		const { entries, index } = this.#list(action);
		if (entries.length === 0) return undefined;
		return {
			heading: t("pr.dial.title"),
			index,
			items: entries.map((item, at) => ({
				key: prKey(item),
				label: item.entry.title,
				art: glyphArt("pullRequest", CHECK_COLOR[item.entry.checksState ?? ""] ?? COLORS.text),
				detail: at === index ? [`#${item.entry.number} · ${item.entry.repository}`, this.#findingsText(item.machine, item.entry)].filter(Boolean).join("\n") : undefined,
			})),
		};
	}

	protected override rotated(dial: DialAction<PrDialSettings>, ticks: number): void {
		const { entries, index } = this.#list(dial);
		const next = entries[Math.min(entries.length - 1, Math.max(0, index + ticks))];
		if (next !== undefined) this.#shown.set(dial.id, prKey(next));
	}

	protected override async pressed(dial: DialAction<PrDialSettings>, heldMs: number): Promise<void> {
		const machine = this.machineOf(dial);
		if (await pressWhileDisconnected(machine)) return;
		const { current } = this.#list(dial);
		if (current === undefined) return void (await this.flash(dial, false, t("pr.dial.none")));
		if (!current.machine.canOperate) return void (await this.flash(dial, false, t("reason.readOnly")));
		if (this.settingsOf(dial).confirm !== "tap" && !held(heldMs)) return void (await this.flash(dial, false, t("repo.holdTo")));
		await this.run(dial, () => fixFindings(deckRuntime, current.machine, this.#refOf(current.entry), selectedThread(machine)));
	}

	protected override async tapped(dial: DialAction<PrDialSettings>): Promise<void> {
		const { current } = this.#list(dial);
		if (current === undefined) return;
		if (!URL.canParse(current.entry.url) || new URL(current.entry.url).protocol !== "https:") return void (await this.flash(dial, false, t("result.notWebLink")));
		await this.run(dial, () => streamDeck.system.openUrl(current.entry.url));
	}

	override needs(action: Action<PrDialSettings>): Need[] {
		const machine = this.machineOf(action);
		const { current, loading } = this.#list(action);
		const operate = current?.machine.canOperate ?? canOperate(undefined, machine);
		return [
			{ kind: "paired", connection: connectionOf(machine) },
			{ kind: "operate", ok: operate },
			{ kind: "pr", ok: current !== undefined ? true : loading ? undefined : false },
			{ kind: "scope", scope: SOURCE_CONTROL_SCOPE, ok: current === undefined || grants(current.machine.scopes, SOURCE_CONTROL_SCOPE) },
		];
	}
}
