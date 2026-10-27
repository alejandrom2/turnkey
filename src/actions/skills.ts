import streamDeck, { type Action, action, type DialAction, type KeyUpEvent, type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { gitCwd } from "../core/git.js";
import { t } from "../core/i18n.js";
import type { Need } from "../core/requirements.js";
import { COLORS, glyphArt, renderControlKey, toneOf } from "../core/render.js";
import { findSkill, type ProviderSkill, skillDescription, skillLabel, skillMessage } from "../core/skills.js";
import type { StripContent } from "../core/strip.js";
import type { StripList } from "../core/styles.js";
import { pinnedName } from "../core/target.js";
import { canOperate, DeckAction, errorMessage, pressWhileDisconnected, readyMachines, sendChoices, sendToThread, ultrathinkArmed } from "./base.js";
import { threadNeeds } from "./needs.js";
import { type DialSettings, StripDial } from "./strip.js";

const ID = "com.alejandrom2.turnkey";
const logger = streamDeck.logger.createScope("skills");

/** The skills the thread's composer would offer: its provider's, for its checkout. Only call it for a shown thread. */
export function skillsOf(thread: DeckThread): { skills: ProviderSkill[]; loading: boolean } {
	return thread.machine.skills(thread.model.instanceId, gitCwd(thread, thread.machine.project(thread.projectId)?.workspaceRoot));
}

/** The Confirm setting's review of running a skill on a thread. */
const skillCard = (thread: DeckThread, text: string) => ({ glyph: "skill" as const, verb: t("review.runSkill"), target: thread.title, body: text, footer: t("review.pressToSend") });

type RunSkillSettings = { machine?: string; skill?: string; prompt?: string; title?: string; target?: string; thread?: string; threadTitle?: string };

/** Runs one of the target thread's provider skills, the way picking it in T3 Code's composer and sending does. */
@action({ UUID: `${ID}.skill` })
export class RunSkillKey extends DeckAction<RunSkillSettings> {
	#state(action: Action<RunSkillSettings>) {
		const settings = this.settingsOf(action);
		const { thread, gone, pinned } = this.target(action);
		const name = settings.skill?.trim() ?? "";
		const listed = thread === undefined ? undefined : skillsOf(thread);
		const skill = listed && findSkill(listed.skills, name);
		const missing = !name
			? t("skills.pickSkill")
			: skill === undefined && listed !== undefined && !listed.loading
				? listed.skills.length === 0
					? t("skills.none")
					: t("skills.gone", { skill: name })
				: undefined;
		const text = skillMessage(skill?.name ?? name, settings.prompt);
		const check = availability("send", { thread, gone, canOperate: canOperate(thread), hasPrompt: true, missing });
		return { thread, pinned, name, skill, loading: listed?.loading === true && skill === undefined, text, check };
	}

	override needs(action: Action<RunSkillSettings>): Need[] {
		const { thread, name, skill, check } = this.#state(action);
		const target = this.target(action);
		return [
			...threadNeeds(this.machineOf(action), thread, true, target.pinned ? pinnedName(this.settingsOf(action)) : undefined),
			{ kind: "value", value: name || t("skills.pickSkill"), ok: skill !== undefined || (thread !== undefined && check.available) },
		];
	}

	protected override reviewScope(action: Action<RunSkillSettings>): string | undefined {
		const { thread, text } = this.#state(action);
		return thread && JSON.stringify([thread.key, text]);
	}

	protected override async draw(action: Action<RunSkillSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { thread, pinned, name, skill, check } = this.#state(action);
		const label = this.settingsOf(action).title?.trim() || (skill ? skillLabel(skill) : name) || t("skills.title");
		await this.setImage(action, renderControlKey({ glyph: "skill", label, available: check.available, ultrathink: ultrathinkArmed(thread), pinned, shrink: !check.available }));
	}

	override async onKeyUp(ev: KeyUpEvent<RunSkillSettings>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { thread, loading, text, check } = this.#state(ev.action);
		if (loading) return void (await this.flash(ev.action, false, t("result.loading")));
		if (!(await this.allowed(ev.action, check))) return;
		const go = await this.guard(ev.action, { scope: JSON.stringify([thread!.key, text]), held, holdHint: t("result.holdToSend"), card: () => skillCard(thread!, text) });
		if (go === undefined) return;
		await this.run(ev.action, () => sendToThread(thread!, text, "auto"));
	}

	/** The Skill choices: the target thread's skills, else every skill the machines' providers list. */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, RunSkillSettings>): Promise<void> {
		if ((ev.payload as { event?: string } | null)?.event !== "getSkills") return super.onSendToPlugin(ev);
		const items = [{ label: t("skills.chooseSkill"), value: "" }];
		const sameName = (item: { value: string }, name: string) => item.value.toLowerCase() === name.toLowerCase();
		const add = (skill: ProviderSkill) => {
			if (!items.some((item) => sameName(item, skill.name))) items.push({ label: skillLabel(skill), value: skill.name });
		};
		const thread = this.target(ev.action).thread;
		try {
			if (thread !== undefined) {
				const cwd = gitCwd(thread, thread.machine.project(thread.projectId)?.workspaceRoot);
				(await thread.machine.readSkills(thread.model.instanceId, cwd)).forEach(add);
			} else {
				for (const machine of readyMachines(this.machineOf(ev.action))) {
					for (const provider of machine.modelConfig?.providers ?? []) machine.skills(provider.instanceId, undefined).skills.forEach(add);
				}
			}
		} catch (error) {
			logger.warn(`Listing skills failed: ${errorMessage(error)}`);
		}
		await sendChoices("getSkills", items, this.settingsOf(ev.action).skill?.trim(), (skill) => t("skills.gone", { skill }), sameName);
	}
}

type SkillsDialSettings = DialSettings & { target?: string; thread?: string; threadTitle?: string };

/**
 * The target thread's provider skills. Rotate picks one; press or tap runs it on that thread, under the Confirm
 * setting; touch and hold reads its description.
 */
@action({ UUID: `${ID}.dial.skills` })
export class SkillsDial extends StripDial<SkillsDialSettings> {
	/** The skill each dial shows, by name, so it stays put as the list changes. */
	readonly #shown = new Map<string, string>();

	#state(action: Action<SkillsDialSettings>) {
		const { thread, gone } = this.target(action);
		const listed = thread === undefined ? undefined : skillsOf(thread);
		const skills = listed?.skills ?? [];
		const index = Math.max(
			0,
			skills.findIndex((skill) => skill.name === this.#shown.get(action.id)),
		);
		const skill = skills[index] as ProviderSkill | undefined;
		const missing = skill === undefined && listed !== undefined && !listed.loading ? t("skills.none") : undefined;
		const check = availability("send", { thread, gone, canOperate: canOperate(thread), hasPrompt: true, missing });
		return { thread, listed, skills, index, skill, check, text: skill && skillMessage(skill.name) };
	}

	override needs(action: Action<SkillsDialSettings>): Need[] {
		const { thread, skills, listed } = this.#state(action);
		const target = this.target(action);
		return [
			...threadNeeds(this.machineOf(action), thread, true, target.pinned ? pinnedName(this.settingsOf(action)) : undefined),
			{ kind: "value", value: t("skills.aSkill"), ok: skills.length > 0 || listed?.loading === true },
		];
	}

	protected heading(): string {
		return t("skills.title");
	}

	protected face(action: Action<SkillsDialSettings>): StripContent {
		const header = this.heading();
		const { thread, listed, skills, index, skill, check } = this.#state(action);
		const tone = toneOf(thread?.deck, thread?.unseen);
		const muted = { header, icon: glyphArt("skill", COLORS.muted), accent: COLORS.muted, tone };
		if (thread === undefined) return { ...muted, value: check.available ? t("strip.noThread") : check.reason };
		if (skill === undefined) return { ...muted, value: listed?.loading ? thread.title : check.available ? t("skills.none") : check.reason, detail: listed?.loading ? undefined : thread.title, loading: listed?.loading };
		return {
			header: `${header} · ${index + 1}/${skills.length}`,
			icon: glyphArt("skill", check.available ? COLORS.text : COLORS.muted),
			accent: check.available ? COLORS.accent : COLORS.muted,
			value: skillLabel(skill),
			detail: check.available ? (skillDescription(skill) ?? `→ ${thread.title}`) : check.reason,
			// A long touch reads the description first: that is what doesn't fit.
			scroll: ["detail", "value"],
			tone,
			ultrathink: ultrathinkArmed(thread),
		};
	}

	protected override list(action: Action<SkillsDialSettings>): StripList | undefined {
		const { thread, skills, index, check } = this.#state(action);
		if (thread === undefined || skills.length === 0) return undefined;
		const art = glyphArt("skill", check.available ? COLORS.text : COLORS.muted);
		return {
			heading: t("skills.title"),
			index,
			wrap: true,
			items: skills.map((skill, at) => ({ key: skill.name, label: skillLabel(skill), art, detail: at === index ? skillDescription(skill) : undefined })),
			note: { text: check.available ? `→ ${thread.title}` : check.reason },
		};
	}

	protected override rotated(dial: DialAction<SkillsDialSettings>, ticks: number): void {
		const { skills, index } = this.#state(dial);
		if (skills.length === 0) return;
		this.#shown.set(dial.id, skills[(((index + ticks) % skills.length) + skills.length) % skills.length]!.name);
	}

	protected override reviewScope(action: Action<SkillsDialSettings>): string | undefined {
		const { thread, text } = this.#state(action);
		return thread && text && JSON.stringify([thread.key, text]);
	}

	protected override pressed(dial: DialAction<SkillsDialSettings>, held: number): Promise<void> {
		return this.#run(dial, held);
	}

	protected override tapped(dial: DialAction<SkillsDialSettings>): Promise<void> {
		return this.#run(dial, 0);
	}

	async #run(dial: DialAction<SkillsDialSettings>, held: number): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		const { thread, listed, text, check } = this.#state(dial);
		if (listed?.loading === true && text === undefined) return void (await this.flash(dial, false, t("result.loading")));
		if (!(await this.allowed(dial, check))) return;
		const go = await this.guard(dial, { scope: JSON.stringify([thread!.key, text]), held, holdHint: t("result.holdToSend"), card: () => skillCard(thread!, text!) });
		if (go === undefined) return;
		await this.run(dial, () => sendToThread(thread!, text!, "auto"));
	}

	override onWillDisappear(ev: Parameters<StripDial<SkillsDialSettings>["onWillDisappear"]>[0]): void {
		this.#shown.delete(ev.action.id);
		super.onWillDisappear(ev);
	}
}
