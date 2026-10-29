import type { Action } from "@elgato/streamdeck";
import { action } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { branchSummary, checkoutOf, gitBlocker, reasonText } from "../core/git.js";
import { t } from "../core/i18n.js";
import { renderInfoBar, renderNoticeBar } from "../core/infobar.js";
import { gitCheck, gitKey, type GitSettings, type GitState } from "../core/keys/git.js";
import { prLook } from "../core/keys/pr.js";
import { threadPullRequest } from "../core/pr.js";
import { modeOf } from "../core/modes.js";
import { COLORS } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { grants } from "../core/scopes.js";
import { SOURCE_CONTROL_SCOPE } from "../core/t3/pairing.js";
import { selectedThread } from "./base.js";
import { connectionNotice } from "./infobar.js";
import { threadNeeds } from "./needs.js";
import { deckRuntime } from "./runtime.js";
import { SharedKey } from "./shared.js";

const ID = "com.alejandrom2.turnkey";

type Settings = GitSettings & JsonObject;

/**
 * A key that runs one git action on the selected thread's checkout, picked by its Action setting (`gitKey`); on the
 * Neo info bar, the checkout at a glance.
 */
abstract class GitAction extends SharedKey<Settings, GitState> {
	protected readonly definition = gitKey;

	/** A single-purpose key saved before Git had an Action setting acts as its UUID says. */
	protected override definitionSettings(action: Action<Settings>): Settings {
		const settings = this.settingsOf(action);
		return { ...settings, gitAction: modeOf("git", this.manifestId, settings) };
	}

	protected override async draw(action: Action<Settings>): Promise<void> {
		if (action.isNeoInfobar()) return this.#paintBar(action);
		await super.draw(action);
	}

	/** On the Neo info bar: the selected thread's branch, its changes and commits ahead or behind, and its pull request. */
	async #paintBar(action: Action<Settings>): Promise<void> {
		const notice = connectionNotice(this.machineOf(action));
		if (notice) return this.setBar(action, renderNoticeBar(notice));
		const check = gitCheck(deckRuntime, this.machineOf(action), modeOf("git", this.manifestId, this.settingsOf(action)));
		const thread = check.target?.thread;
		const status = check.ok ? check.status : undefined;
		const branch = status?.refName ?? thread?.branch;
		if (thread === undefined || branch === undefined || (!check.ok && check.target?.cwd === undefined))
			return this.setBar(action, renderInfoBar({ icon: { glyph: "branch", color: COLORS.muted }, title: branch ?? t("face.branch"), detail: check.ok ? "" : check.reason, available: false }));
		const pr = threadPullRequest(thread.pullRequests, thread.branch);
		const look = pr && prLook(thread, pr, deckRuntime.repaint);
		await this.setBar(
			action,
			renderInfoBar({
				icon: { glyph: "branch", color: COLORS.text },
				title: branch,
				detail: status === undefined ? "" : (branchSummary(status) ?? t("repo.reason.upToDate")),
				...(pr && look ? { right: { text: `#${pr.number}`, color: look.color } } : {}),
			}),
		);
	}

	/** The inspector's checklist: a paired machine that may act, a thread, source control access and a checkout ready for it. */
	override needs(action: Action<Settings>): Need[] {
		const thread = selectedThread(this.machineOf(action));
		const target = thread && checkoutOf(thread);
		const status = target && deckRuntime.git.get(target);
		const blocker = status && gitBlocker(status, modeOf("git", this.manifestId, this.settingsOf(action)));
		return [
			...threadNeeds(this.machineOf(action), target?.thread),
			{ kind: "scope", scope: SOURCE_CONTROL_SCOPE, ok: target !== undefined && grants(target.machine.scopes, SOURCE_CONTROL_SCOPE) },
			{ kind: "repo", ok: target === undefined ? false : status === undefined ? undefined : blocker === undefined, reason: blocker && reasonText(blocker) },
		];
	}
}

/** Commits, commits and pushes, opens a PR, pushes or pulls; T3 Code writes the commit message unless one is set. */
@action({ UUID: `${ID}.git` })
export class GitKey extends GitAction {}

// The single-purpose git keys Git replaced: hidden from the actions list, still on decks and in older profiles.
@action({ UUID: `${ID}.git.commit` })
export class CommitKey extends GitAction {}

@action({ UUID: `${ID}.git.push` })
export class PushKey extends GitAction {}

@action({ UUID: `${ID}.git.pr` })
export class CreatePrKey extends GitAction {}

@action({ UUID: `${ID}.git.pull` })
export class PullKey extends GitAction {}
