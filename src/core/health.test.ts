import { describe, expect, it } from "vitest";

import { type HealthMachine, healthIssues, providerProblem, type ProviderStatus, summarizeHealth } from "./health.js";

const provider = (patch: Partial<ProviderStatus> = {}): ProviderStatus => ({
	instanceId: "codex",
	driver: "codex",
	enabled: true,
	installed: true,
	status: "ready",
	auth: { status: "authenticated" },
	...patch,
});

const machine = (patch: Partial<HealthMachine> = {}): HealthMachine => ({ name: "Studio", state: "ready", canOperate: true, providers: [provider()], ...patch });

describe("providerProblem", () => {
	it("follows T3 Code's order: disabled, not installed, signed out, then status", () => {
		expect(providerProblem(provider())).toBeUndefined();
		expect(providerProblem(provider({ enabled: false, auth: { status: "unauthenticated" } }))).toBe("disabled");
		expect(providerProblem(provider({ installed: false, auth: { status: "unauthenticated" } }))).toBe("notFound");
		expect(providerProblem(provider({ status: "error", auth: { status: "unauthenticated" } }))).toBe("signedOut");
		expect(providerProblem(provider({ status: "error", compatibilityAdvisory: { status: "broken" } }))).toBe("updateRequired");
		expect(providerProblem(provider({ status: "error" }))).toBe("checkFailed");
		expect(providerProblem(provider({ status: "warning" }))).toBe("needsAttention");
		expect(providerProblem(provider({ versionAdvisory: { status: "behind_latest" } }))).toBe("updateAvailable");
	});
});

describe("summarizeHealth", () => {
	it("says the machine is connected when every provider is ready", () => {
		expect(summarizeHealth([machine()])).toEqual({ level: "ok", title: "Studio", detail: "Connected" });
		expect(summarizeHealth([machine({ canOperate: false })]).detail).toBe("Read only");
	});

	it("leads with the worst problem and counts the rest", () => {
		const summary = summarizeHealth([
			machine({
				providers: [
					provider({ versionAdvisory: { status: "behind_latest" } }),
					provider({ instanceId: "claudeAgent", driver: "claudeAgent", auth: { status: "unauthenticated" } }),
					provider({ instanceId: "cursor", driver: "cursor", status: "error" }),
				],
			}),
		]);
		expect(summary).toEqual({ level: "error", title: "Cursor", detail: "Check failed · +2 more" });
	});

	it("keeps a ready machine green with only notes, naming the note", () => {
		expect(summarizeHealth([machine({ providers: [provider({ versionAdvisory: { status: "behind_latest" } })] })])).toEqual({
			level: "note",
			title: "Studio",
			detail: "Codex update available",
		});
	});

	it("puts an offline machine before any provider, and names a provider's machine when there are several", () => {
		const issues = healthIssues([machine({ providers: [provider({ status: "warning" })] }), machine({ name: "Laptop", state: "error", message: "Unreachable" })]);
		expect(issues.map((issue) => [issue.level, issue.subject, issue.text])).toEqual([
			["error", "Laptop", "Unreachable"],
			["attention", "Codex", "Needs attention"],
		]);
		expect(summarizeHealth([machine({ providers: [provider({ auth: { status: "unauthenticated" } })] }), machine({ name: "Laptop" })])).toEqual({
			level: "attention",
			title: "Codex",
			detail: "Signed out · Studio",
		});
	});

	it("marks notes so they never fail the checklist", () => {
		const issues = healthIssues([machine({ providers: [provider({ enabled: false }), provider({ versionAdvisory: { status: "behind_latest" } })] })]);
		expect(issues.map((issue) => issue.level)).toEqual(["note", "note"]);
	});

	it("waits quietly while a single machine connects", () => {
		expect(summarizeHealth([machine({ state: "connecting", providers: undefined })])).toEqual({ level: "connecting", title: "Studio", detail: "Connecting…" });
	});
});
