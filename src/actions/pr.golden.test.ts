import { describe, it, vi } from "vitest";

import type { DeckThread } from "../core/board.js";
import { AskPrKey, ExplainPrKey, FixFindingsKey, PullRequest, ReviewGuideKey } from "./pr.js";
import { type GoldenOptions, recordFace, recordPress } from "./testing/harness.js";
import { machine, RUNNING, scene, STATES } from "./testing/fixtures.js";

vi.mock("@elgato/streamdeck", async () => await import("./testing/streamdeck.js"));
vi.mock("node:child_process", async () => await import("./testing/process.js"));
vi.mock("../deck.js", async () => await import("./testing/deck.js"));

// Recorded from today's keys so the shared-keys refactor can prove no Stream Deck key changed. Never update these to make
// a refactor pass: a changed golden is a bug.

type Setup = [name: string, make: () => GoldenOptions, settings?: Record<string, unknown>, held?: number | number[]];

const faces = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings] of setups) it(`${key} face: ${name}`, () => recordFace(`${key}-${name}`, Class, { ...make(), settings }));
};
const presses = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings, held] of setups) it(`${key} press: ${name}`, () => recordPress(`${key}-press-${name}`, Class, { ...make(), settings }, held ?? 0));
};

const link = (overrides: Partial<DeckThread["pullRequests"][number]> = {}): DeckThread["pullRequests"][number] => ({
	url: "https://github.com/acme/app/pull/7",
	number: 7,
	repository: "acme/app",
	state: "open",
	title: "Fix the build",
	headBranch: "feat/x",
	...overrides,
});

const failingCheck = { name: "build", status: "failure", description: "exit 1", url: null };
const passingCheck = { name: "lint", status: "success", description: null, url: null };
const pendingCheck = { name: "test", status: "pending", description: null, url: null };
const actor = { login: "reviewer" };
const reviewThread = { id: "thread-a", path: "src/app.ts", line: 4, side: "right" as const, isResolved: false, comments: [{ id: "c1", author: actor, body: "Handle the null case." }] };
const remark = { id: "r1", kind: "review" as const, author: actor, body: "Please add a test.", path: null };
const quiet = { comments: [], reviewThreads: [], commentsTruncated: false };

const detail = (checks: unknown[] = []) => ({
	projectId: "project",
	workspaceRoot: "/work/project",
	number: 7,
	title: "Fix the build",
	url: "https://github.com/acme/app/pull/7",
	state: "open",
	isDraft: false,
	headBranch: "feat/x",
	baseBranch: "main",
	checks,
});

type Reads = { summary?: unknown; checks?: unknown[] | null; activity?: unknown; detail?: unknown; guide?: unknown; generated?: unknown };
/** A selected thread linking a pull request, whose reads are `reads`. */
const withPr = (reads: Reads = {}, links = [link()], thread: Partial<DeckThread> = {}, extra: Parameters<typeof machine>[0] = {}): GoldenOptions =>
	scene(
		{ branch: "feat/x", pullRequests: links, ...thread },
		{
			rpc: {
				"pullRequests.summary": reads.summary ?? { number: 7, title: "Fix the build", url: link().url, state: "open" },
				"pullRequests.checks": reads.checks === undefined ? { checks: [] } : reads.checks === null ? null : { checks: reads.checks },
				"pullRequests.activity": reads.activity ?? quiet,
				"pullRequests.detail": reads.detail ?? detail(),
				"pullRequests.linkedThreads": { threads: [] },
				"pullRequests.reviewGuide": reads.guide ?? { guide: null, run: null, currentHeadSha: "abc" },
				"pullRequests.generateReviewGuide": reads.generated ?? { guide: null, run: { _tag: "Running", headSha: "abc" }, currentHeadSha: "abc" },
			},
			...extra,
		},
	);

const connection: Setup[] = [
	["none", STATES.none],
	["offline", STATES.offline],
	["no-thread", STATES["no-thread"]],
	["no-pr", STATES.idle],
];

describe("Pull Request goldens", () => {
	faces("pr", PullRequest, [
		...connection,
		["open", () => withPr()],
		["draft", () => withPr({ summary: { number: 7, title: "x", url: link().url, state: "open", isDraft: true } })],
		["merged", () => withPr({}, [link({ state: "merged" })])],
		["closed", () => withPr({}, [link({ state: "closed" })])],
		["failing", () => withPr({ checks: [failingCheck, passingCheck] })],
		["failing-one-of-two", () => withPr({ checks: [failingCheck, { ...failingCheck, name: "e2e" }] })],
		["findings", () => withPr({ activity: { ...quiet, reviewThreads: [reviewThread] } })],
		["findings-one", () => withPr({ activity: { ...quiet, comments: [remark] } })],
		["running", () => withPr({ checks: [pendingCheck, passingCheck] })],
		["changes-requested", () => withPr({ summary: { number: 7, title: "x", url: link().url, state: "open", reviewDecision: "changes-requested" }, checks: [passingCheck] })],
		["approved", () => withPr({ summary: { number: 7, title: "x", url: link().url, state: "open", reviewDecision: "approved" }, checks: [passingCheck] })],
		["passing", () => withPr({ checks: [passingCheck] })],
		["read-failed", () => withPr({ summary: new Error("boom"), checks: null, activity: new Error("boom") })],
		["no-repository", () => withPr({}, [link({ repository: undefined })])],
		["running-thread", () => withPr({}, [link()], RUNNING)],
		["stacked", () => withPr({}, [link({ number: 6, headBranch: "feat/base", title: "Base" }), link()])],
		["read-only", () => withPr({}, [link()], {}, { canOperate: false })],
	]);
	faces("pr-legacy-fix", FixFindingsKey, [["findings", () => withPr({ activity: { ...quiet, reviewThreads: [reviewThread] } })]]);
	faces("pr-legacy-explain", ExplainPrKey, [["open", () => withPr()]]);
	faces("pr-legacy-ask", AskPrKey, [["open", () => withPr()]]);
	faces("pr-legacy-guide", ReviewGuideKey, [["none", () => withPr()]]);

	const fix = { mode: "fix" };
	faces("pr-fix", PullRequest, [
		...connection.map(([name, make]): Setup => [name, make, fix]),
		["no-findings", () => withPr(), fix],
		["threads", () => withPr({ activity: { ...quiet, reviewThreads: [reviewThread] } }), fix],
		["remarks", () => withPr({ activity: { ...quiet, comments: [remark, { ...remark, id: "r2" }] } }), fix],
		["checks", () => withPr({ checks: [failingCheck] }), fix],
		["everything", () => withPr({ activity: { ...quiet, reviewThreads: [reviewThread], comments: [remark] }, checks: [failingCheck] }), fix],
		["read-only", () => withPr({}, [link()], {}, { canOperate: false }), fix],
		["no-repository", () => withPr({}, [link({ repository: undefined })]), fix],
	]);
	const explain = { mode: "explain" };
	faces("pr-explain", PullRequest, [
		["open", () => withPr(), explain],
		["no-pr", STATES.idle, explain],
		["read-only", () => withPr({}, [link()], {}, { canOperate: false }), explain],
		["gitlab", () => withPr({}, [link({ url: "https://gitlab.com/acme/app/-/merge_requests/7" })]), explain],
	]);
	const ask = { mode: "ask" };
	faces("pr-ask", PullRequest, [
		["open", () => withPr(), ask],
		["no-pr", STATES.idle, ask],
		["read-only", () => withPr({}, [link()], {}, { canOperate: false }), ask],
	]);
	const guide = { mode: "guide" };
	const written = { guide: { headSha: "abc" }, run: null, currentHeadSha: "abc" };
	faces("pr-guide", PullRequest, [
		["none", () => withPr(), guide],
		["writing", () => withPr({ guide: { guide: null, run: { _tag: "Running", headSha: "abc" }, currentHeadSha: "abc" } }), guide],
		["ready", () => withPr({ guide: written }), guide],
		["failed", () => withPr({ guide: { guide: null, run: { _tag: "Failed", headSha: "abc" }, currentHeadSha: "abc" } }), guide],
		["stale", () => withPr({ guide: { guide: { headSha: "old" }, run: null, currentHeadSha: "abc" } }), guide],
		["no-pr", STATES.idle, guide],
		["read-only", () => withPr({}, [link()], {}, { canOperate: false }), guide],
	]);

	const pr = (reads: Reads = {}, thread: Partial<DeckThread> = {}) => withPr(reads, [link()], { threadId: "pr-1", ...thread });
	presses("pr", PullRequest, [
		["open", () => pr()],
		["not-web-link", () => withPr({}, [link({ url: "http://example.test/pr/7" })], { threadId: "pr-1" })],
		["no-pr", STATES.idle],
		["no-thread", STATES["no-thread"]],
		["offline", STATES.offline],
	]);
	presses("pr-legacy-fix", FixFindingsKey, [["held", () => pr({ activity: { ...quiet, reviewThreads: [reviewThread] } }), undefined, 600]]);
	presses("pr-legacy-explain", ExplainPrKey, [["tap", () => pr()]]);
	presses("pr-legacy-ask", AskPrKey, [["tap", () => pr()]]);
	presses("pr-legacy-guide", ReviewGuideKey, [["tap", () => pr({ guide: written })]]);

	const findingsReads: Reads = { activity: { ...quiet, reviewThreads: [reviewThread], comments: [remark] }, checks: [failingCheck], detail: detail([failingCheck]) };
	presses("pr-fix", PullRequest, [
		["tap", () => pr(findingsReads), fix],
		["held", () => pr(findingsReads), fix, 600],
		["held-running", () => pr(findingsReads, RUNNING), fix, 600],
		["tap-setting", () => pr(findingsReads), { ...fix, confirm: "tap" }],
		["none", () => pr(), { ...fix, confirm: "tap" }],
		["read-only", () => withPr(findingsReads, [link()], { threadId: "pr-1" }, { canOperate: false }), { ...fix, confirm: "tap" }],
		["no-repository", () => withPr({}, [link({ repository: undefined })]), { ...fix, confirm: "tap" }],
		["failure", () => pr({ ...findingsReads, detail: new Error("boom") }), { ...fix, confirm: "tap" }, 600],
	]);
	presses("pr-explain", PullRequest, [
		["tap", () => pr(), explain],
		["running", () => pr({}, RUNNING), explain],
		["read-only", () => withPr({}, [link()], { threadId: "pr-1" }, { canOperate: false }), explain],
		["failure", () => pr({ detail: new Error("boom") }), explain],
	]);
	presses("pr-ask", PullRequest, [
		["tap", () => pr(), ask],
		["read-only", () => withPr({}, [link()], { threadId: "pr-1" }, { canOperate: false }), ask],
	]);
	presses("pr-guide", PullRequest, [
		["ready", () => pr({ guide: written }), guide],
		["none", () => pr(), guide],
		["writing", () => pr({ guide: { guide: null, run: { _tag: "Running", headSha: "abc" }, currentHeadSha: "abc" } }), guide],
		["failed", () => pr({ guide: { guide: null, run: { _tag: "Failed", headSha: "abc" }, currentHeadSha: "abc" } }), guide],
	]);
});
