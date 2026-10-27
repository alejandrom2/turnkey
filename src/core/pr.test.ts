import { describe, expect, it } from "vitest";

import fixtures from "./fixtures/pr-handoffs.json";
import { buildExplainPullRequestHandoff, buildFixFindingsHandoff, changeRequestLabel, classifyChecks, findings, handoffMessage, threadPullRequestRef } from "./pr.js";

type FixInput = Parameters<typeof buildFixFindingsHandoff>[0];
type ExplainInput = Parameters<typeof buildExplainPullRequestHandoff>[0];
const expected = fixtures.expected as Record<string, { handoff: unknown; message: unknown }>;

describe("handoffs match T3 Code's own output", () => {
	it.each(Object.entries(fixtures.inputs.fix))("fix findings: %s", (name, input) => {
		const handoff = buildFixFindingsHandoff(input as unknown as FixInput);
		expect(handoff).toEqual(expected[name]!.handoff);
		expect(JSON.parse(JSON.stringify(handoffMessage(handoff)))).toEqual(expected[name]!.message);
	});

	it.each(Object.entries(fixtures.inputs.explain))("explain: %s", (name, input) => {
		const handoff = buildExplainPullRequestHandoff(input as unknown as ExplainInput);
		expect(handoff).toEqual(expected[name]!.handoff);
		expect(JSON.parse(JSON.stringify(handoffMessage(handoff)))).toEqual(expected[name]!.message);
	});
});

describe("pull request helpers", () => {
	it("count what a Fix Findings handoff would carry", () => {
		const input = fixtures.inputs.fix.mixed as unknown as FixInput;
		const found = findings(input);
		expect([found.threads.length, found.remarks.length, found.checks.length, found.total]).toEqual([2, 2, 2, 6]);
	});

	it("classify checks like T3 Code and name change requests by host", () => {
		const check = (status: string) => ({ name: status, status, description: null, url: null });
		expect(classifyChecks([])).toBe("none");
		expect(classifyChecks([check("success"), check("pending")])).toBe("pending");
		expect(classifyChecks([check("success"), check("cancelled")])).toBe("failing");
		expect(classifyChecks([check("success"), check("skipped")])).toBe("passing");
		expect(changeRequestLabel("https://gitlab.example.com/a/b/-/merge_requests/3")).toBe("MR");
		expect(changeRequestLabel("https://github.com/a/b/pull/3")).toBe("PR");
	});

	it("name a thread's pull request only when the server sent its repository", () => {
		expect(threadPullRequestRef("p-1", { host: "github.com", repository: "a/b", number: 3 })).toEqual({ projectId: "p-1", host: "github.com", repository: "a/b", number: 3 });
		expect(threadPullRequestRef("p-1", { number: 3 })).toBeUndefined();
	});
});
