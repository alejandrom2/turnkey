import { describe, expect, it } from "vitest";

import type { DeckThread } from "./board.js";
import { answer, currentValue, threadDeepLink, withValue } from "./commands.js";
import { findLocalEnvironment, normalizeEnvironmentUrl } from "./connection.js";
import { wrap } from "./render.js";

describe("threadDeepLink", () => {
	it("matches the desktop app's t3code://threads/<env>/<thread> route", () => {
		expect(threadDeepLink({ environmentId: "env-1", threadId: "thread:mcp:1" })).toBe("t3code://threads/env-1/thread%3Amcp%3A1");
		expect(threadDeepLink({ environmentId: "e", threadId: "t" }, "t3code-dev")).toBe("t3code-dev://threads/e/t");
	});
});

describe("normalizeEnvironmentUrl", () => {
	it("accepts the copied MCP URL or a bare origin", () => {
		expect(normalizeEnvironmentUrl("https://box.ts.net/mcp")).toBe("https://box.ts.net/mcp");
		expect(normalizeEnvironmentUrl(" http://localhost:3773/ ")).toBe("http://localhost:3773/mcp");
		expect(normalizeEnvironmentUrl("https://box.ts.net/mcp/?x=1#y")).toBe("https://box.ts.net/mcp");
	});

	it("rejects anything that is not http(s)", () => {
		expect(normalizeEnvironmentUrl("t3code://threads")).toBeUndefined();
		expect(normalizeEnvironmentUrl("not a url")).toBeUndefined();
	});
});

describe("findLocalEnvironment", () => {
	it("picks the first port that answers as T3 Code", async () => {
		const fetchFn = (async (url: string) => {
			if (url.includes(":3773/")) throw new Error("ECONNREFUSED");
			if (url.includes(":3774/")) return Response.json({ resource_name: "Something else" });
			return Response.json({ resource_name: "T3 Code" });
		}) as typeof fetch;
		expect(await findLocalEnvironment(fetchFn)).toBe("http://127.0.0.1:3775/mcp");
	});

	it("finds nothing when T3 Code is not running", async () => {
		expect(await findLocalEnvironment((async () => Promise.reject(new Error("down"))) as typeof fetch)).toBeUndefined();
	});
});

describe("model options", () => {
	const selection = { instanceId: "codex", model: "gpt-5.5", options: [{ id: "reasoningEffort", value: "medium" }] };

	it("replaces one option and keeps the rest", () => {
		const next = withValue({ ...selection, options: [...selection.options, { id: "fast", value: false }] }, "reasoningEffort", "high");
		expect(next.options).toEqual([
			{ id: "fast", value: false },
			{ id: "reasoningEffort", value: "high" },
		]);
	});

	it("falls back to the provider default when the thread has no value", () => {
		expect(currentValue({ selection, options: [] }, { id: "fast", values: [true, false], default: false })).toBe(false);
		expect(currentValue({ selection, options: [] }, { id: "reasoningEffort", values: ["low", "high"] })).toBe("medium");
	});
});

describe("answer", () => {
	it("keys answers by question id with the option value, arrays for multi-select", async () => {
		const calls: unknown[] = [];
		const thread = { threadId: "t", source: { call: async (_: string, args: unknown) => calls.push(args) } } as unknown as DeckThread;
		await answer(
			thread,
			{
				requestId: "r1",
				questions: [
					{ id: "q1", header: "", question: "", options: [{ label: "Yes", description: "" }, { label: "No", description: "", value: "no" }] },
					{ id: "q2", header: "", question: "", multiSelect: true, options: [{ label: "A", description: "" }] },
				],
			},
			[1, 0],
		);
		expect(calls[0]).toEqual({ action: "respond", threadId: "t", requestId: "r1", answers: { q1: "no", q2: ["A"] } });
	});
});

describe("wrap", () => {
	it("wraps on words and ellipsizes overflow", () => {
		expect(wrap("Fix the flaky checkout test", 11, 2)).toEqual(["Fix the", "flaky…"]);
		expect(wrap("Short", 11, 2)).toEqual(["Short"]);
		expect(wrap("Supercalifragilistic", 11, 2)).toEqual(["Supercalif…"]);
	});
});
