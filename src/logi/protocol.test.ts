import { describe, expect, it } from "vitest";

import { encodeMessage, parseHostMessage } from "./protocol.js";

describe("parseHostMessage", () => {
	it("parses a press", () => {
		expect(parseHostMessage('{"type":"press","action":"thread"}')).toEqual({ type: "press", action: "thread" });
	});

	it("parses an appear with its size", () => {
		expect(parseHostMessage('{"type":"appear","action":"thread","size":80}')).toEqual({ type: "appear", action: "thread", size: 80 });
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
});
