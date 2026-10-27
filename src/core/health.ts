import { type MessageKey, t } from "./i18n.js";
import { type ConfigProvider, providerDisplayName } from "./models.js";

/**
 * What can be wrong with a provider, from `ServerProvider` (packages/contracts/src/server.ts), in T3 Code's own order
 * and words (apps/web/src/components/settings/providerStatus.ts): disabled, not found, not authenticated, then its
 * compatibility and status.
 */
export type ProviderProblem = "disabled" | "notFound" | "unauthenticated" | "unsupported" | "broken" | "unavailable" | "needsAttention" | "updateAvailable";

/** How loud an issue is: `note` never colors the key. */
export type HealthLevel = "error" | "attention" | "note";

/** The `ServerProvider` status fields Health reads. */
export type ProviderStatus = Pick<ConfigProvider, "instanceId" | "driver" | "displayName" | "enabled" | "installed" | "status" | "availability"> & {
	auth?: { status?: string; type?: string };
	versionAdvisory?: { status?: string } | null;
	compatibilityAdvisory?: { status?: string } | null;
};

/** `key` labels the problem under the provider's name; a note says both in one line (`note`, with `{provider}`). */
const PROBLEM: Record<ProviderProblem, { level: HealthLevel; key: MessageKey; note?: MessageKey }> = {
	notFound: { level: "error", key: "health.notFound" },
	unavailable: { level: "error", key: "health.unavailable" },
	unauthenticated: { level: "attention", key: "health.unauthenticated" },
	unsupported: { level: "attention", key: "health.unsupported" },
	broken: { level: "attention", key: "health.broken" },
	needsAttention: { level: "attention", key: "health.needsAttention" },
	updateAvailable: { level: "note", key: "health.updateAvailable", note: "health.providerUpdate" },
	disabled: { level: "note", key: "health.disabled", note: "health.providerOff" },
};

/** Antigravity's check sees the install, not the Google sign-in: T3 Code shows that warning as neutral ("Sign-in not checked"). */
const signInUnchecked = (provider: ProviderStatus): boolean =>
	provider.driver === "antigravity" &&
	provider.status === "warning" &&
	provider.auth?.status === "unknown" &&
	(provider.auth.type === undefined || provider.auth.type === "oauth-personal" || provider.auth.type === "oauth-business");

/** The one thing to say about a provider, worst first; undefined when it is ready. */
export function providerProblem(provider: ProviderStatus): ProviderProblem | undefined {
	if (provider.enabled === false || provider.status === "disabled") return "disabled";
	if (provider.installed === false) return "notFound";
	if (provider.auth?.status === "unauthenticated") return "unauthenticated";
	const compatibility = provider.compatibilityAdvisory?.status;
	if (compatibility === "unsupported" || compatibility === "broken") return compatibility;
	if (provider.status === "error" || provider.availability === "unavailable") return "unavailable";
	if (provider.status === "warning" && !signInUnchecked(provider)) return "needsAttention";
	if (provider.versionAdvisory?.status === "behind_latest") return "updateAvailable";
	return undefined;
}

/** One machine as Health sees it: its connection and, once connected, its providers. */
export type HealthMachine = {
	name: string;
	state: "ready" | "connecting" | "signed-out" | "error";
	canOperate?: boolean;
	message?: string;
	providers?: readonly ProviderStatus[];
};

export type HealthIssue = { level: HealthLevel; subject: string; text: string; machine: string; note?: string };

const RANK: Record<HealthLevel, number> = { error: 0, attention: 1, note: 2 };

/** Every problem on the machines, worst first: connections, then providers in T3 Code's order. */
export function healthIssues(machines: readonly HealthMachine[]): HealthIssue[] {
	const issues: HealthIssue[] = [];
	for (const machine of machines) {
		if (machine.state === "error") issues.push({ level: "error", subject: machine.name, text: machine.message || t("health.offline"), machine: machine.name });
		else if (machine.state === "signed-out") issues.push({ level: "attention", subject: machine.name, text: t("health.needsPairing"), machine: machine.name });
		if (machine.state !== "ready") continue;
		for (const provider of machine.providers ?? []) {
			const problem = providerProblem(provider);
			if (problem === undefined) continue;
			const { level, key, note } = PROBLEM[problem];
			const subject = providerDisplayName(provider);
			issues.push({ level, subject, text: t(key), machine: machine.name, note: note && t(note, { provider: subject }) });
		}
	}
	return issues.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/** The Health key's face: the worst problem first, how many more there are, else that every machine is fine. */
export type HealthSummary = { level: HealthLevel | "ok" | "connecting"; title: string; detail: string };

export function summarizeHealth(machines: readonly HealthMachine[]): HealthSummary {
	const issues = healthIssues(machines);
	const [worst] = issues;
	const many = machines.length > 1;
	const more = issues.length > 1 ? t("health.more", { count: issues.length - 1 }) : undefined;
	const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");
	if (worst !== undefined && worst.level !== "note") {
		// A provider names its machine when there are several; a machine's own problem already does.
		const where = many && worst.subject !== worst.machine ? worst.machine : undefined;
		return { level: worst.level, title: worst.subject, detail: join(worst.text, where, more) };
	}
	const connecting = machines.some((machine) => machine.state === "connecting");
	const ready = machines.filter((machine) => machine.state === "ready");
	const note = worst === undefined ? undefined : join(worst.note ?? worst.text, more);
	if (many) {
		const title = t(ready.length === machines.length ? "health.allConnected" : "health.someOffline");
		return { level: worst?.level ?? (connecting ? "connecting" : "ok"), title, detail: note ?? t("health.readyCount", { ready: ready.length, total: machines.length }) };
	}
	const [machine] = machines;
	if (machine === undefined) return { level: "error", title: t("notice.notFound"), detail: "" };
	if (machine.state === "connecting") return { level: "connecting", title: machine.name, detail: t("health.connecting") };
	return { level: worst?.level ?? "ok", title: machine.name, detail: note ?? t(machine.canOperate ? "health.connected" : "health.readOnly") };
}
