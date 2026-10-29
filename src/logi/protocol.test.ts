import { describe, expect, it } from "vitest";

import { encodeMessage, parseHostMessage } from "./protocol.js";

describe("parseHostMessage", () => {
	it("clamps a press's hold time, and never reads a bad one as a Ring click", () => {
		const press = (heldMs: unknown) => parseHostMessage(JSON.stringify({ type: "press", action: "a:", heldMs }));
		expect(press(620)).toEqual({ type: "press", action: "a:", heldMs: 620 });
		for (const bad of [-1, "620", 1.5, null]) expect(press(bad)).toEqual({ type: "press", action: "a:", heldMs: 0 });
		expect(press(1e9)).toEqual({ type: "press", action: "a:", heldMs: 600000 });
		expect(parseHostMessage('{"type":"press","action":"a:"}')).toEqual({ type: "press", action: "a:" });
	});

	it("parses a press", () => {
		expect(parseHostMessage('{"type":"press","action":"thread"}')).toEqual({ type: "press", action: "thread" });
	});

	it("parses an appear with its size", () => {
		expect(parseHostMessage('{"type":"appear","action":"thread","size":80}')).toEqual({ type: "appear", action: "thread", size: 80 });
	});

	it("parses a scroll on an adjustment, in whole ticks", () => {
		expect(parseHostMessage('{"type":"turn","action":"effort:","ticks":-2}')).toEqual({ type: "turn", action: "effort:", ticks: -2 });
		expect(parseHostMessage('{"type":"turn","action":"effort:","ticks":1.5}')).toBeUndefined();
		expect(parseHostMessage('{"type":"turn","action":"effort:"}')).toBeUndefined();
	});

	it("parses the plugin's language", () => {
		expect(parseHostMessage('{"type":"language","language":"de-DE"}')).toEqual({ type: "language", language: "de-DE" });
		expect(parseHostMessage('{"type":"language","language":7}')).toBeUndefined();
	});

	it("drops what isn't a host message", () => {
		for (const line of [
			"not json",
			"null",
			'{"type":"boom"}',
			'{"type":"press"}',
			'{"type":"appear","action":"a","size":0}',
			'{"type":"appear","action":"a","size":81.5}',
			'{"type":"appear","action":"a","size":1000}',
		]) {
			expect(parseHostMessage(line), line).toBeUndefined();
		}
	});
});

describe("encodeMessage", () => {
	it("encodes one line", () => {
		const line = encodeMessage({ type: "log", level: "info", message: "two\nlines" });
		expect(line.endsWith("\n")).toBe(true);
		expect(line.slice(0, -1)).not.toContain("\n");
	});

	it("says which size a face was drawn for, as one action can show at two", () => {
		expect(JSON.parse(encodeMessage({ type: "image", action: "stop:", size: 116, svg: "<svg/>" }))).toEqual({ type: "image", action: "stop:", size: 116, svg: "<svg/>" });
	});
});
