/**
 * The inspector's "What this action needs" list: each condition an action checks before acting, met or not, with
 * up to a few fixes. Built from the same facts the keys' availability uses, so the two never disagree.
 */
import { type MessageKey, t } from "./i18n.js";
import { DIAGNOSTICS_SCOPE, SOURCE_CONTROL_SCOPE } from "./t3/pairing.js";

/** Why the action's machine can't be used: none found, removed, unpaired or unreachable (base.ts `ConnectionProblem`). */
export type Connection = "ready" | "none" | "missing" | "pair" | "offline";

/** One condition. `ok: undefined` means it is still being checked. */
export type Need =
	| { kind: "paired"; connection: Connection }
	| { kind: "operate"; ok: boolean }
	| { kind: "thread"; ok: boolean }
	| { kind: "running"; ok: boolean }
	| { kind: "pending"; ok: boolean }
	| { kind: "prompt"; ok: boolean }
	| { kind: "scope"; scope: string; ok: boolean }
	| { kind: "option"; option: string; ok: boolean }
	| { kind: "pr"; ok: boolean | undefined }
	| { kind: "branch"; ok: boolean }
	| { kind: "repo"; ok: boolean | undefined; reason?: string }
	| { kind: "editor"; ok: boolean }
	/** A saved setting that no longer matches anything: a model, effort, mode, project or editor. */
	| { kind: "value"; value: string; ok: boolean };

export type RequirementState = "met" | "unmet" | "checking";
export type Requirement = { id: string; label: string; state: RequirementState; fixes: string[] };

/** At most this many fixes per condition. */
export const MAX_FIXES = 4;

const SCOPE_LABEL: Record<string, MessageKey> = { [SOURCE_CONTROL_SCOPE]: "needs.scope.sourceControl", [DIAGNOSTICS_SCOPE]: "needs.scope.diagnostics" };

const CONNECTION_FIX: Record<Exclude<Connection, "ready">, MessageKey[]> = {
	none: ["needs.fix.openT3", "needs.fix.addMachine"],
	missing: ["needs.fix.pickMachine"],
	pair: ["needs.fix.pairLink"],
	offline: ["needs.fix.reachable", "needs.fix.pressRetry"],
};

const state = (ok: boolean | undefined): RequirementState => (ok === undefined ? "checking" : ok ? "met" : "unmet");

function describe(need: Need): Requirement {
	const make = (id: string, label: string, ok: boolean | undefined, fixes: MessageKey[] = [], extra: string[] = []): Requirement => ({
		id,
		label,
		state: state(ok),
		fixes: ok === false ? [...extra, ...fixes.map((key) => t(key))].slice(0, MAX_FIXES) : [],
	});
	switch (need.kind) {
		case "paired":
			return make("paired", t("needs.paired"), need.connection === "ready", need.connection === "ready" ? [] : CONNECTION_FIX[need.connection]);
		case "operate":
			return make("operate", t("needs.operate"), need.ok, ["needs.fix.canAct"]);
		case "thread":
			return make("thread", t("needs.thread"), need.ok, ["needs.fix.openThread", "needs.fix.selectThread"]);
		case "running":
			return make("running", t("needs.running"), need.ok, ["needs.fix.startTurn"]);
		case "pending":
			return make("pending", t("needs.pending"), need.ok, ["needs.fix.waitForAgent"]);
		case "prompt":
			return make("prompt", t("needs.prompt"), need.ok, ["needs.fix.typePrompt"]);
		case "scope":
			return make(`scope:${need.scope}`, t(SCOPE_LABEL[need.scope] ?? "needs.scope.other", { scope: need.scope }), need.ok, ["needs.fix.newPairLink", "needs.fix.standardAccess"]);
		case "option":
			return make(`option:${need.option}`, t("needs.option", { option: need.option }), need.ok, ["needs.fix.switchModel"]);
		case "pr":
			return make("pr", t("needs.pr"), need.ok, ["needs.fix.createPr"]);
		case "branch":
			return make("branch", t("needs.branch"), need.ok, ["needs.fix.checkoutBranch"]);
		case "repo":
			return make("repo", t("needs.repo"), need.ok, [], need.reason ? [need.reason] : []);
		case "editor":
			return make("editor", t("needs.editor"), need.ok, ["needs.fix.installEditor"]);
		case "value":
			return make(`value:${need.value}`, need.ok ? need.value : t("needs.notAvailable", { value: need.value }), need.ok, ["needs.fix.pickAnother"]);
	}
}

/** The checklist, in the order the needs were given, and how many are not met. */
export function requirements(needs: readonly Need[]): { items: Requirement[]; unmet: number } {
	const items = needs.map(describe);
	return { items, unmet: items.filter((item) => item.state === "unmet").length };
}
