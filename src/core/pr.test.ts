import { describe, expect, it } from "vitest";

import fixtures from "./fixtures/pr-handoffs.json";
import {
	buildExplainPullRequestHandoff,
	buildFixFindingsHandoff,
	changeRequestLabel,
	classifyChecks,
	findings,
	guideState,
	handoffMessage,
	type PrMachine,
	prRequests,
	threadPullRequest,
	threadPullRequestRef,
	visibleBody,
} from "./pr.js";

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
	it("treats comments revealed by overlapping delimiters as hidden", () => {
		expect(visibleBody("<!<!--x-->-->payload-->")).toBeNull();
	});

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

	it("pick the open pull request for the thread's branch over another open one, else any open one, else the first", () => {
		const link = (number: number, state: "open" | "merged", headBranch: string) => ({ number, state, headBranch });
		const stack = [link(1, "open", "base-layer"), link(2, "open", "feature"), link(3, "merged", "old")];
		expect(threadPullRequest(stack, "feature")?.number).toBe(2);
		expect(threadPullRequest(stack, "elsewhere")?.number).toBe(1);
		expect(threadPullRequest([link(3, "merged", "old")], "feature")?.number).toBe(3);
		expect(threadPullRequest([], "feature")).toBeUndefined();
	});

	it("name a thread's pull request only when the server sent its repository", () => {
		expect(threadPullRequestRef("p-1", { host: "github.com", repository: "a/b", number: 3 })).toEqual({ projectId: "p-1", host: "github.com", repository: "a/b", number: 3 });
		expect(threadPullRequestRef("p-1", { number: 3 })).toBeUndefined();
	});
});

describe("pull request requests", () => {
	const ref = { projectId: "p-1", host: "github.com", repository: "pingdotgg/t3code", number: 42 };

	it("name the pull request by reference and ask for each call's scope", async () => {
		const calls: unknown[][] = [];
		const machine: PrMachine = { call: async (tag, payload, scope) => void calls.push([tag, payload, scope]) as never };
		await prRequests.detail(machine, ref);
		await prRequests.activity(machine, ref);
		await prRequests.linkedThreads(machine, ref);
		await prRequests.list(machine);
		await prRequests.generateReviewGuide(machine, ref);
		await prRequests.prepareWorktree(machine, { cwd: "/w/app", url: "https://github.com/pingdotgg/t3code/pull/42", threadId: "thr_new" });
		expect(calls).toEqual([
			["pullRequests.detail", ref, undefined],
			["pullRequests.activity", ref, undefined],
			["pullRequests.linkedThreads", ref, undefined],
			["pullRequests.list", { state: "open", limit: 50 }, undefined],
			["pullRequests.generateReviewGuide", ref, "orchestration:operate"],
			["git.preparePullRequestThread", { cwd: "/w/app", reference: "https://github.com/pingdotgg/t3code/pull/42", mode: "worktree", threadId: "thr_new" }, "source-control:write"],
		]);
	});

	it("tell a guide for the current head from a stale, running or failed one", () => {
		const guide = { headSha: "abc" };
		expect(guideState({ guide, run: null, currentHeadSha: "abc" })).toBe("ready");
		expect(guideState({ guide, run: null, currentHeadSha: "def" })).toBe("none");
		expect(guideState({ guide: null, run: { _tag: "Running", headSha: "def" }, currentHeadSha: "def" })).toBe("running");
		expect(guideState({ guide: null, run: { _tag: "Failed", headSha: "def", detail: "x" }, currentHeadSha: "def" })).toBe("failed");
	});
});
