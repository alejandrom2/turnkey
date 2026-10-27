import type { Action } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { DeckThread } from "../core/board.js";
import { t } from "../core/i18n.js";
import { findModel, modelKey, parseModelKey, pickableModels, RUNTIME_MODES, runtimeModes, speedToggle } from "../core/models.js";
import { effortChoices } from "../core/power.js";
import { dialPrompts, quickPrompt } from "../core/prompts.js";
import { type Connection, type Need, requirements } from "../core/requirements.js";
import { normalizeEnvironmentUrl } from "../core/t3/pairing.js";
import { deck } from "../deck.js";
import { pinnedName } from "../core/target.js";
import { canOperate, connectionProblem, deckActions, queueOf, targetOf } from "./base.js";

const ID = "com.alejandrom2.t3deck.";

export const connectionOf = (machine: string | undefined): Connection => connectionProblem(machine) ?? "ready";

/**
 * The needs every thread action starts with: a paired machine, a thread (the selection, or the one its Target pins,
 * by name), and a pairing that may act.
 */
export function threadNeeds(machine: string | undefined, thread: DeckThread | undefined, operate = true, pinned?: string): Need[] {
	return [
		{ kind: "paired", connection: connectionOf(machine) },
		pinned === undefined ? { kind: "thread", ok: thread !== undefined } : { kind: "value", value: thread?.title ?? pinned, ok: thread !== undefined },
		...(operate ? [{ kind: "operate", ok: canOperate(thread) } satisfies Need] : []),
	];
}

const projectKnown = (machine: string | undefined, project: string): boolean =>
	deck.machines.some((candidate) => (machine === undefined || candidate.url === machine) && candidate.projects.some((known) => known.id === project));

const modelLabel = (thread: DeckThread | undefined) => thread && findModel(thread.machine.modelConfig, thread.model);

/**
 * The checklist for the actions whose classes don't list their own needs (keys.ts, dials.ts): the same checks their
 * availability makes. Saved values that no longer match anything show as "Not available: X".
 */
export function defaultNeeds(manifestId: string, settings: Record<string, unknown>, machine: string | undefined): Need[] {
	const kind = manifestId.startsWith(ID) ? manifestId.slice(ID.length) : manifestId;
	const target = targetOf(settings, machine);
	const thread = target.thread;
	const pinned = target.pinned ? pinnedName(settings) : undefined;
	const needsFor = (machine: string | undefined, thread: DeckThread | undefined, operate = true) => threadNeeds(machine, thread, operate, pinned);
	const paired: Need = { kind: "paired", connection: connectionOf(machine) };
	const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
	const project = text(settings.project);
	const projectNeed: Need[] = project && connectionOf(machine) === "ready" ? [{ kind: "value", value: project, ok: projectKnown(machine, project) }] : [];
	switch (kind) {
		case "activity":
		case "slot":
		case "dial.threads":
			return [paired, ...projectNeed];
		case "health":
			return [paired];
		case "new":
			return [paired, { kind: "operate", ok: deck.machines.some((candidate) => candidate.canOperate && (machine === undefined || candidate.url === machine)) }, ...(settings.destination === "project" ? projectNeed : [])];
		case "send":
		case "steer":
			return [...needsFor(machine, thread), ...(kind === "steer" ? [{ kind: "running", ok: thread?.active === true } satisfies Need] : []), { kind: "prompt", ok: text(settings.prompt) !== "" }];
		case "quick":
			return [...needsFor(machine, thread), { kind: "prompt", ok: quickPrompt(settings).text !== "" }];
		case "dial.prompts":
			return [...needsFor(machine, thread), { kind: "prompt", ok: dialPrompts(settings).length > 0 }];
		case "stop":
			return [...needsFor(machine, thread), { kind: "running", ok: thread?.active === true }];
		case "model": {
			const fixed = parseModelKey(settings.model);
			const known = fixed && deck.machines.some((candidate) => pickableModels(candidate.modelConfig).some((model) => model.key === modelKey(fixed.instanceId, fixed.model)));
			return [...needsFor(machine, thread), ...(fixed && connectionOf(machine) === "ready" ? [{ kind: "value", value: fixed.model, ok: known === true } satisfies Need] : [])];
		}
		case "effort": {
			const values = effortChoices(modelLabel(thread)).map((choice) => String(choice.value));
			const fixed = text(settings.effort);
			return [
				...needsFor(machine, thread),
				{ kind: "option", option: t("needs.optionEffort"), ok: values.length > 0 },
				...(fixed && thread ? [{ kind: "value", value: fixed, ok: values.includes(fixed) } satisfies Need] : []),
			];
		}
		case "speed":
			return [...needsFor(machine, thread), { kind: "option", option: t("needs.optionFast"), ok: thread !== undefined && speedToggle(modelLabel(thread), thread.model) !== undefined }];
		case "permissions": {
			const fixed = RUNTIME_MODES.find((mode) => mode === settings.mode);
			const offered = thread ? runtimeModes(thread.machine.modelConfig, thread.model.instanceId).map((mode) => mode.value) : [];
			return [...needsFor(machine, thread), ...(fixed && thread ? [{ kind: "value", value: fixed, ok: offered.includes(fixed) } satisfies Need] : [])];
		}
		case "plan": {
			const toggle = thread?.machine.modelConfig?.providers?.find((provider) => provider.instanceId === thread.model.instanceId)?.showInteractionModeToggle;
			return [...needsFor(machine, thread), { kind: "option", option: t("needs.optionPlan"), ok: thread !== undefined && toggle !== false }];
		}
		case "approve":
		case "deny":
		case "dial.answer": {
			const opensOnly = kind === "approve" && (settings.approvalAuthority ?? "open") === "open";
			const pending = thread?.pendingRequest !== undefined && (thread.deck === "approval" || (kind === "dial.answer" && thread.deck === "question"));
			return [...needsFor(machine, thread, !opensOnly), { kind: "pending", ok: pending }];
		}
		case "dial.queue": {
			const queue = thread && queueOf(thread);
			return [...needsFor(machine, thread), { kind: "queued", ok: queue === undefined ? (thread === undefined ? false : undefined) : queue.items.length > 0 }];
		}
		case "pr":
			return [...needsFor(machine, thread, false), { kind: "pr", ok: (thread?.pullRequests.length ?? 0) > 0 }];
		case "branch":
			return [...needsFor(machine, thread, false), { kind: "branch", ok: thread?.branch !== undefined }];
		default:
			return needsFor(machine, thread);
	}
}

/** The open inspector's checklist: the action's own needs, else the shared table. */
deck.useChecklist((action: Action<JsonObject>) => {
	const owner = [...deckActions].find((candidate) => candidate.manifestId === action.manifestId);
	if (owner === undefined) return undefined;
	const settings = owner.settingsFor(action);
	const machine = typeof settings.machine === "string" && settings.machine !== "" ? normalizeEnvironmentUrl(settings.machine) : undefined;
	const own = owner.needs(action);
	return requirements(own.length > 0 ? own : defaultNeeds(action.manifestId, settings, machine));
});
