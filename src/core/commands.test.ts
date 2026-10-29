import { describe, expect, it } from "vitest";

import { buildAnswers, openCommand, openThread, revealCommand, threadDeepLink } from "./commands.js";
import { titleSeed } from "./t3/machine.js";

describe("threadDeepLink", () => {
	it("matches the desktop app's t3code://threads/<env>/<thread> route", () => {
		expect(threadDeepLink({ environmentId: "env-1", threadId: "thread:mcp:1" })).toBe("t3code://threads/env-1/thread%3Amcp%3A1");
		expect(threadDeepLink({ environmentId: "e", threadId: "t" }, "t3code-dev")).toBe("t3code-dev://threads/e/t");
	});
});

describe("buildAnswers", () => {
	const questions = [
		{ id: "q1", header: "", question: "", options: [{ label: "Yes" }, { label: "No", value: "no" }] },
		{ id: "q2", header: "", question: "", multiSelect: true, options: [{ label: "A" }] },
	];

	it("keys answers by question id with the option value, arrays for multi-select", () => {
		expect(buildAnswers(questions, [1, 0], false)).toEqual({ q1: "no", q2: ["A"] });
	});

	it("sends plain strings for message-mode questions, which T3 Code turns into a reply", () => {
		expect(buildAnswers(questions, [0, 0], true)).toEqual({ q1: "Yes", q2: "A" });
	});
});

describe("titleSeed", () => {
	it("uses the first line, shortened, or a placeholder", () => {
		expect(titleSeed("  Fix   the tests\nthen push")).toBe("Fix the tests");
		expect(titleSeed("x".repeat(100))).toHaveLength(80);
		expect(titleSeed("   ")).toBe("New thread");
	});
});

describe("openThread", () => {
	const thread = { key: "env/thread", environmentId: "env", threadId: "thread", machine: { url: "ws://m" } };

	it("selects the thread, then opens it", async () => {
		const calls: string[] = [];
		await openThread(thread, async (key, url) => void calls.push(`select ${key} ${url}`), undefined, async (url) => void calls.push(`open ${url}`));
		expect(calls).toEqual(["select env/thread ws://m", "open t3code://threads/env/thread"]);
	});

	it("opens even when selecting fails", async () => {
		const opened: string[] = [];
		await openThread(thread, () => Promise.reject(new Error("no")), "t3code-dev", async (url) => void opened.push(url));
		expect(opened).toEqual(["t3code-dev://threads/env/thread"]);
	});

	it("opens even when selecting throws", async () => {
		const opened: string[] = [];
		const select = () => {
			throw new Error("no");
		};
		await openThread(thread, select, undefined, async (url) => void opened.push(url));
		expect(opened).toEqual(["t3code://threads/env/thread"]);
	});

	it("opens without waiting for the selection", async () => {
		const opened: string[] = [];
		await openThread(thread, () => new Promise(() => undefined), undefined, async (url) => void opened.push(url));
		expect(opened).toEqual(["t3code://threads/env/thread"]);
	});
});

describe("openCommand", () => {
	it("uses xdg-open on Linux", () => expect(openCommand("t3code://x", "linux")).toEqual(["xdg-open", ["t3code://x"]]));
	it("keeps open on macOS", () => expect(openCommand("t3code://x", "darwin")).toEqual(["open", ["t3code://x"]]));
	it("keeps rundll32 on Windows", () => expect(openCommand("t3code://x", "win32")).toEqual(["rundll32", ["url.dll,FileProtocolHandler", "t3code://x"]]));
});

describe("revealCommand", () => {
	it("opens the folder on Linux, which can't select", () => expect(revealCommand("/l", true, "linux")).toEqual(["xdg-open", ["/l"]]));
	it("selects in Finder", () => expect(revealCommand("/l", true, "darwin")).toEqual(["open", ["-R", "/l"]]));
	it("opens the folder in Finder", () => expect(revealCommand("/l", false, "darwin")).toEqual(["open", ["/l"]]));
	it("selects in Explorer", () => expect(revealCommand("C:\\l", true, "win32")).toEqual(["explorer", ["/select,C:\\l"]]));
});
