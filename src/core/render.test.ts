import { describe, expect, it } from "vitest";
import {
	dotsCue,
	fitSize,
	ladderCue,
	effortTone,
	maxEffortStyle,
	providerGradient,
	sampleStops,
	renderControlKey,
	renderDecisionKey,
	renderInfoKey,
	renderNoticeKey,
	renderResultKey,
	renderReviewKey,
	renderThreadKey,
	textWidth,
	wrapText,
} from "./render.js";

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

	it("breaks a long word after a hyphen before anything else", () => {
		expect(wrapText("Auto-accept edits", 112, 20, 3).lines).toEqual(["Auto-", "accept", "edits"]);
	});

	it("cuts a word that can't break, fading it, when asked", () => {
		const wrapped = wrapText("Supercalifragilisticexpialidocious tests", 60, 17, 2, { cut: true });
		expect(wrapped.cut).toEqual([0]);
		expect(wrapped.lines[1]).toBe("tests");
	});

	it("shrinks a size step when a word doesn't fit, before breaking it", () => {
		expect(fitSize("Auto-accept edits", 112, [20, 17])).toBe(17);
		expect(fitSize("Fix tests", 112, [20, 17])).toBe(20);
		const label = svg(renderControlKey({ glyph: "modeAutoAcceptEdits", label: "Auto-accept edits" }));
		expect(label).toContain(`font-size="17"`);
		expect(label).toContain(">Auto-accept<");
		expect(label).toContain(">edits<");
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

	it("shows the unread badge on unseen threads, but lets an unseen done one's green tile say it", () => {
		expect(svg(renderThreadKey({ state: "failed", title: "Failed", unseen: true }))).toContain(`fill="#007BE5"`);
		expect(svg(renderThreadKey({ state: "failed", title: "Failed" }))).not.toContain(`fill="#007BE5"`);
		const done = svg(renderThreadKey({ state: "done", title: "Done", unseen: true }));
		expect(done).not.toContain(`fill="#007BE5"`);
		expect(done).toContain(`fill="#1E4A32"`);
		expect(svg(renderThreadKey({ state: "done", title: "Done" }))).toContain(`fill="#363636"`);
	});

	it("shades the tile and colors the glyph of threads that want attention: amber waiting, red failed", () => {
		for (const state of ["approval", "question"] as const) {
			const out = svg(renderThreadKey({ state, title: "Work" }));
			expect(out).toContain(`fill="#5B3322"`);
			expect(out).toContain(`stroke="#FF8549"`);
		}
		const failed = svg(renderThreadKey({ state: "failed", title: "Work" }));
		expect(failed).toContain(`fill="#5C2328"`);
		expect(failed).toContain(`stroke="#FF6764"`);
		const running = svg(renderThreadKey({ state: "running", title: "Work" }));
		expect(running).toContain(`fill="#363636"`);
		expect(running).not.toContain("fill-opacity=");
	});

	it("marks the selected thread with a white wash and dims the other titles, without an outline", () => {
		const selected = svg(renderThreadKey({ state: "idle", title: "Work", selected: true }));
		expect(selected).toContain(`fill="#FFFFFF" fill-opacity="0.15"`);
		expect(selected).not.toContain("stroke-width=\"4\"");
		expect(selected).not.toContain(`fill-opacity="0.55"`);
		expect(svg(renderThreadKey({ state: "idle", title: "Work", selected: false }))).toContain(`fill-opacity="0.55"`);
		expect(svg(renderThreadKey({ state: "idle", title: "Work" }))).not.toContain(`fill-opacity="0.55"`);
		expect(svg(renderThreadKey({ state: "approval", title: "Work", selected: true }))).toContain(`fill="#FFFFFF" fill-opacity="0.1"`);
	});

	it("turns the spinner and swaps the wash for motion", () => {
		expect(svg(renderThreadKey({ state: "running", title: "Work", motion: { spin: 90 } }))).toContain("rotate(90 12 12)");
		expect(svg(renderThreadKey({ state: "approval", title: "Work", motion: { wash: 0.3 } }))).toContain(`fill="#FF8549" fill-opacity="0.3"`);
		expect(svg(renderThreadKey({ state: "done", title: "Work", motion: { wash: 0.4 } }))).toContain(`fill="#40C977" fill-opacity="0.4"`);
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
	it("dims unavailable controls with opacity rather than color", () => {
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

	it("centers a result's glyph over its caption, smaller and wrapped when long", () => {
		const short = svg(renderResultKey({ ok: true, label: "Sent" }));
		expect(short).toContain(`stroke="#40C977"`);
		expect(short).toContain(`text-anchor="middle"`);
		expect(short).toContain(`font-size="16"`);
		const long = svg(renderResultKey({ ok: false, label: "The target provider instance is unavailable" }));
		expect(long).toContain(`font-size="13"`);
		expect(long).not.toContain("mask=");
		expect(long).toContain("unavailable</text>");
	});

	it("keeps the label to one line above a position cue", () => {
		const out = svg(renderControlKey({ glyph: "effort", label: "High", cue: ladderCue(5, 2) }));
		expect(out).toContain(`y="98"`);
		expect(out).toContain(`<circle cx="72" cy="119" r="10" fill="#FFFFFF"/>`);
		expect(dotsCue(4, 1).match(/<rect/g)).toHaveLength(4);
		expect(dotsCue(4, 1).match(/fill-opacity/g)).toHaveLength(3);
	});

	it("draws a provider mark in place of the glyph", () => {
		const out = svg(renderControlKey({ glyph: "model", label: "Opus 4.5", mark: (x, y, size) => `<rect x="${x}" y="${y}" width="${size}" id="mark"/>` }));
		expect(out).toContain(`<rect x="15" y="12" width="42" id="mark"/>`);
	});
});

describe("decision and review keys", () => {
	it("draws Approve and Deny as a pair, gray when there is nothing to answer", () => {
		const approve = svg(renderDecisionKey({ kind: "approve", armed: true, caption: "Allow once", detail: "npm test" }));
		const deny = svg(renderDecisionKey({ kind: "deny", armed: true, caption: "Deny", detail: "npm test" }));
		expect(approve.replace(/<g transform[^>]*>.*?<\/g>/, "")).toBe(deny.replace(/<g transform[^>]*>.*?<\/g>/, "").replace(">Deny<", ">Allow once<"));
		expect(svg(renderDecisionKey({ kind: "deny", armed: false, caption: "Deny" }))).toContain(`<g opacity=".45">`);
	});

	it("shows what a review would send and where, escaped", () => {
		const out = svg(renderReviewKey({ glyph: "send", verb: "Send?", target: "Fix <login>", body: "Run the tests", footer: "Press again" }));
		expect(out).toContain("Fix &lt;login&gt;");
		expect(out).toContain(">Run the tests<");
		expect(out).toContain(">Press again<");
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

describe("effortTone", () => {
	it("colors every level along the gradient, and only the top one otherwise", () => {
		expect(effortTone("gradient", 0, false, undefined)?.text).toBe("#648FFD");
		expect(effortTone("gradient", 0.55, false, undefined)?.text).toBe("#AD7BF9");
		expect(effortTone("gradient", 0, false, undefined)?.fill).toEqual({ gradient: expect.any(Array) });
		expect(effortTone("solid", 0.5, false, undefined)).toBeUndefined();
		expect(effortTone("solid", 1, true, undefined)).toEqual({ text: "#AD7BF9", fill: "#AD7BF9" });
		expect(effortTone("model", 1, true, "#D97757")).toEqual({ text: "#D97757", fill: "#D97757" });
		expect(effortTone("off", 1, true, "#D97757")).toBeUndefined();
		expect(maxEffortStyle("nonsense")).toBe("gradient");
	});

	it("builds any provider's gradient from its color, gray for white marks", () => {
		expect(providerGradient("#D97757")).toEqual([[0, sampleStops([[0, "#D97757"], [1, "#FFFFFF"]], 0.45)], [1, "#D97757"]]);
		expect(providerGradient(undefined)[1]).toEqual([1, "#8E9199"]);
	});
});
