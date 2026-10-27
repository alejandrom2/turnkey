import { describe, expect, it } from "vitest";
import { renderControlKey, renderInfoKey, renderNoticeKey, renderResultKey, renderThreadKey, textWidth, wrapText } from "./render.js";

const svg = (dataUrl: string) => Buffer.from(dataUrl.replace(/^data:image\/svg\+xml;base64,/, ""), "base64").toString("utf8");

describe("wrapText", () => {
	it("keeps short text on one line", () => {
		expect(wrapText("Short", 114, 17, 3)).toEqual({ lines: ["Short"], overflowed: false });
	});

	it("wraps on word boundaries within the width", () => {
		const { lines, overflowed } = wrapText("Fix the flaky checkout test", 80, 17, 5);
		expect(overflowed).toBe(false);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.join(" ")).toBe("Fix the flaky checkout test");
		for (const line of lines) expect(textWidth(line, 17)).toBeLessThanOrEqual(80);
	});

	it("flags overflow and fills the last line to the edge", () => {
		const { lines, overflowed } = wrapText("Refactor the websocket reconnect logic so tunnels survive sleep", 114, 17, 3);
		expect(overflowed).toBe(true);
		expect(lines).toHaveLength(3);
		expect(textWidth(lines[2], 17)).toBeLessThanOrEqual(114);
	});

	it("breaks a word wider than the line by character", () => {
		const { lines, overflowed } = wrapText("Supercalifragilisticexpialidocious", 60, 17, 1);
		expect(overflowed).toBe(true);
		expect(lines).toHaveLength(1);
		expect("Supercalifragilisticexpialidocious".startsWith(lines[0])).toBe(true);
		expect(textWidth(lines[0], 17)).toBeLessThanOrEqual(60);
	});

	it("measures wide characters wider than narrow ones", () => {
		expect(textWidth("WWW", 10)).toBeGreaterThan(textWidth("iii", 10));
	});
});

describe("renderThreadKey", () => {
	it("escapes markup in titles", () => {
		const out = svg(renderThreadKey({ state: "idle", title: "<b>a & b</b>" }));
		expect(out).toContain("&lt;b&gt;a &amp; b&lt;/b&gt;");
		expect(out).not.toContain("<b>");
	});

	it("shows the unread badge only when unseen", () => {
		expect(svg(renderThreadKey({ state: "done", title: "Done", unseen: true }))).toContain(`fill="#007BE5"`);
		expect(svg(renderThreadKey({ state: "done", title: "Done" }))).not.toContain(`fill="#007BE5"`);
	});

	it("lifts the background while running and tints failures red", () => {
		expect(svg(renderThreadKey({ state: "running", title: "Work" }))).toContain(`<rect width="144" height="144" fill="#292929"/>`);
		const failed = svg(renderThreadKey({ state: "failed", title: "Work" }));
		expect(failed).toContain(`<rect width="144" height="144" fill="#111111"/>`);
		expect(failed).toContain(`fill="#FF6764" fill-opacity="0.2"`);
	});

	it("tints threads waiting on the user green", () => {
		expect(svg(renderThreadKey({ state: "approval", title: "Work" }))).toContain(`fill="#40C977" fill-opacity="0.25"`);
	});

	it("shows the diff instead of the elapsed meta", () => {
		const out = svg(renderThreadKey({ state: "done", title: "Work", meta: "4:12", diff: { additions: 12, deletions: 3 } }));
		expect(out).toContain(">+12<");
		expect(out).toContain(">-3<");
		expect(out).not.toContain(">4:12<");
	});

	it("fades the last title line only when the title overflowed", () => {
		expect(svg(renderThreadKey({ state: "idle", title: "Refactor the websocket reconnect logic so tunnels survive sleep" }))).toContain(`mask="url(#fade`);
		expect(svg(renderThreadKey({ state: "idle", title: "Short" }))).not.toContain("mask=");
	});
});

describe("renderControlKey", () => {
	it("dims unavailable controls with opacity rather than colour", () => {
		expect(svg(renderControlKey({ glyph: "send", primary: true, available: false }))).toContain(`<g opacity=".5">`);
		expect(svg(renderControlKey({ glyph: "send", primary: true }))).not.toContain(`opacity=".5"`);
		expect(svg(renderControlKey({ glyph: "compose", label: "New chat", available: false }))).toContain(`<g opacity=".5">`);
	});

	it("puts a label on one line at the bottom, or two lines above it", () => {
		const one = svg(renderControlKey({ glyph: "send", primary: true, label: "Fix tests" }));
		expect(one).toContain(`y="123"`);
		expect(one).not.toContain(`y="101"`);
		const two = svg(renderControlKey({ glyph: "approve", label: "Approve always for session" }));
		expect(two).toContain(`y="101"`);
		expect(two).toContain(`y="123"`);
	});

	it("fits a refusal reason in smaller lines instead of cutting it off", () => {
		const out = svg(renderResultKey({ ok: false, label: "The target provider instance is unavailable" }));
		expect(out).toContain(`font-size="14"`);
		expect(out).not.toContain("mask=");
		expect(out).toContain("unavailable</text>");
	});

	it("draws a provider mark in place of the glyph", () => {
		const out = svg(renderControlKey({ glyph: "model", label: "Opus 4.5", mark: (x, y, size) => `<rect x="${x}" y="${y}" width="${size}" id="mark"/>` }));
		expect(out).toContain(`<rect x="15" y="12" width="42" id="mark"/>`);
	});
});

describe("renderInfoKey", () => {
	it("dims an unavailable status and escapes its text", () => {
		const out = svg(renderInfoKey({ glyph: "pullRequest", title: "#12 <draft>", detail: "Open", available: false }));
		expect(out).toContain(`<g opacity=".5">`);
		expect(out).toContain("#12 &lt;draft&gt;");
	});
});

describe("renderNoticeKey", () => {
	it("renders title and detail escaped", () => {
		const out = svg(renderNoticeKey({ glyph: "key", title: "Sign in", detail: "<T3> Code", tone: "attention" }));
		expect(out).toContain(">Sign in<");
		expect(out).toContain("&lt;T3&gt; Code");
	});
});

describe("ultrathink frame", () => {
	it("draws T3 Code's spectrum border on a key only while armed", () => {
		expect(svg(renderControlKey({ glyph: "effort", label: "High" }))).not.toContain("ultrathink");
		const armed = svg(renderControlKey({ glyph: "effort", label: "Ultrathink", ultrathink: true }));
		expect(armed).toContain(`stroke="url(#ultrathink)"`);
		expect(armed).toContain("#D76868");
	});
});
