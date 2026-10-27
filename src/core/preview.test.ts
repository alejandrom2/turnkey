import { describe, expect, it } from "vitest";

import { applyPreviewEvent, currentPreview, htmlRenderFileName, isHtmlRenderTool, isLoopbackHost, latestHtmlRender, type PreviewSession, reachableHere } from "./preview.js";

const session = (tabId: string, navStatus: PreviewSession["navStatus"], updatedAt: string): PreviewSession => ({ threadId: "t-1", tabId, navStatus, updatedAt });

describe("currentPreview", () => {
	it("takes the newest tab with a web page, named by its title or host", () => {
		const sessions = [
			session("a", { _tag: "Success", url: "http://localhost:5173/", title: "Vite App" }, "2026-10-27T10:00:00.000Z"),
			session("b", { _tag: "Idle" }, "2026-10-27T11:00:00.000Z"),
			session("c", { _tag: "Loading", url: "file:///tmp/x.html", title: "" }, "2026-10-27T12:00:00.000Z"),
		];
		expect(currentPreview(sessions)).toEqual({ url: "http://localhost:5173/", title: "Vite App" });
		expect(currentPreview([session("d", { _tag: "Loading", url: "https://example.com/a", title: " " }, "x")])).toEqual({ url: "https://example.com/a", title: "example.com" });
		expect(currentPreview([])).toBeUndefined();
	});

	it("follows tabs as they open, move and close", () => {
		const opened = applyPreviewEvent([], { type: "opened", threadId: "t-1", tabId: "a", revision: 1, snapshot: session("a", { _tag: "Loading", url: "http://localhost:3000/", title: "" }, "1") });
		const moved = applyPreviewEvent(opened, { type: "navigated", threadId: "t-1", tabId: "a", revision: 2, snapshot: session("a", { _tag: "Success", url: "http://localhost:3000/b", title: "B" }, "2") });
		expect(moved).toHaveLength(1);
		expect(currentPreview(moved)?.url).toBe("http://localhost:3000/b");
		expect(applyPreviewEvent(moved, { type: "failed", threadId: "t-1", tabId: "a", revision: 3 })).toEqual(moved);
		expect(applyPreviewEvent(moved, { type: "closed", threadId: "t-1", tabId: "a", revision: 4 })).toEqual([]);
	});
});

describe("reachability", () => {
	it("treats loopback addresses on another machine as that machine's only", () => {
		for (const host of ["localhost", "app.localhost", "127.0.0.1", "[::1]", "0.0.0.0"]) expect(isLoopbackHost(host), host).toBe(true);
		expect(isLoopbackHost("192.168.1.5")).toBe(false);
		expect(reachableHere("http://localhost:5173/", true)).toBe(true);
		expect(reachableHere("http://localhost:5173/", false)).toBe(false);
		expect(reachableHere("http://studio.tail1.ts.net:5173/", false)).toBe(true);
	});
});

describe("latestHtmlRender", () => {
	const render = (id: string, toolName: string, output: unknown) => ({ id, type: "dynamic_tool", status: "completed", toolName, output });

	it("knows T3 Code's tool by every provider's name for it", () => {
		for (const name of ["html_render", "mcp__t3-code__html_render", "t3_code.html_render", "t3-code · html_render", "mcp-t3code__html_render", "html_render completed"]) expect(isHtmlRenderTool(name), name).toBe(true);
		for (const name of ["mcp__other__html_render", "html_preview", null]) expect(isHtmlRenderTool(name), String(name)).toBe(false);
	});

	it("finds the newest render in structured, text or block output, and asks for withheld output", () => {
		const items = [
			render("i-1", "mcp__t3-code__html_render", { structuredContent: { htmlRender: { attachmentId: "att-1", title: "Old", height: 400 } } }),
			render("i-2", "html_render", [{ type: "text", text: JSON.stringify({ htmlRender: { attachmentId: "att-2", title: "Chart", height: 300 } }) }]),
			render("i-3", "html_render", { isError: true, structuredContent: { htmlRender: { attachmentId: "att-3", title: "Broken", height: 1 } } }),
			{ id: "i-4", type: "dynamic_tool", status: "running", toolName: "html_render" },
		];
		expect(latestHtmlRender(items)).toEqual({ itemId: "i-2", attachmentId: "att-2", title: "Chart" });
		expect(latestHtmlRender([...items, { id: "i-5", type: "dynamic_tool", status: "completed", toolName: "html_render", outputOmitted: true }])).toEqual({ itemId: "i-5", omitted: true });
		expect(latestHtmlRender([render("i-6", "shell", "{}")])).toBeUndefined();
	});

	it("names the page file as T3 Code does", () => {
		expect(htmlRenderFileName('Q3: "Revenue" / Costs')).toBe("Q3 Revenue Costs.html");
		expect(htmlRenderFileName("  ")).toBe("Page.html");
	});
});
