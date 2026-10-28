import { describe, expect, it } from "vitest";

import { t } from "../core/i18n.js";
import { renderThreadKey } from "../core/render.js";
import type { DeckState } from "../core/t3/shell.js";
import { type KeyThread, Keys, threadKind } from "./keys.js";
import type { SidecarMessage } from "./protocol.js";

const thread = (title: string, deck: DeckState = "idle"): KeyThread => ({ title, deck, unseen: false });
const raster = (dataUrl: string, size: number) => `${size}:${dataUrl}`;
const face = (title: string, deck: DeckState = "idle") => raster(renderThreadKey({ state: deck, title, unseen: false }), 80);

function keys(threads: KeyThread[]) {
	const sent: SidecarMessage[] = [];
	const list = { threads };
	const subject = new Keys({ thread: threadKind(() => list.threads) }, (message) => sent.push(message), raster);
	return { subject, sent, list };
}

describe("Keys", () => {
	it("paints a key when it appears", () => {
		const { subject, sent } = keys([thread("a", "running")]);
		subject.handle({ type: "appear", action: "thread:k", size: 80 });
		expect(sent).toEqual([{ type: "image", action: "thread:k", png: face("a", "running") }]);
	});

	it("shows No threads when there are none", () => {
		const { subject, sent } = keys([]);
		subject.handle({ type: "appear", action: "thread:k", size: 80 });
		expect(sent).toEqual([{ type: "image", action: "thread:k", png: raster(renderThreadKey({ state: "idle", title: t("strip.noThreads") }), 80) }]);
	});

	it("a press steps to the next thread and wraps", () => {
		const { subject, sent } = keys([thread("a"), thread("b")]);
		subject.handle({ type: "appear", action: "thread:k", size: 80 });
		subject.handle({ type: "press", action: "thread:k" });
		subject.handle({ type: "press", action: "thread:k" });
		expect(sent.map((message) => message.type === "image" && message.png)).toEqual([face("a"), face("b"), face("a")]);
	});

	it("sends nothing when the face didn't change", () => {
		const { subject, sent } = keys([thread("a")]);
		subject.handle({ type: "appear", action: "thread:k", size: 80 });
		subject.repaint();
		subject.repaint();
		expect(sent).toHaveLength(1);
	});

	it("skips the rasterizer when the face is unchanged", () => {
		let rasterized = 0;
		const subject = new Keys({ thread: threadKind(() => [thread("a")]) }, () => undefined, (dataUrl, size) => `${++rasterized}:${size}:${dataUrl}`);
		subject.handle({ type: "appear", action: "thread:k", size: 80 });
		subject.repaint();
		subject.repaint();
		expect(rasterized).toBe(1);
	});

	it("repaints when the thread changes", () => {
		const { subject, sent, list } = keys([thread("a", "running")]);
		subject.handle({ type: "appear", action: "thread:k", size: 80 });
		list.threads = [thread("a", "approval")];
		subject.repaint();
		expect(sent.at(-1)).toEqual({ type: "image", action: "thread:k", png: face("a", "approval") });
	});

	it("forgets a key that disappeared", () => {
		const { subject, sent, list } = keys([thread("a")]);
		subject.handle({ type: "appear", action: "thread:k", size: 80 });
		subject.handle({ type: "disappear", action: "thread:k" });
		list.threads = [thread("b")];
		subject.repaint();
		subject.handle({ type: "press", action: "thread:k" });
		expect(sent).toHaveLength(1);
	});

	it("routes a press to its kind, which keeps the key's place when it returns nothing", () => {
		const pressed: number[] = [];
		const sent: SidecarMessage[] = [];
		const subject = new Keys({ urgent: { face: () => "face", press: (index) => void pressed.push(index) } }, (message) => sent.push(message), raster);
		subject.handle({ type: "appear", action: "urgent:", size: 80 });
		subject.handle({ type: "press", action: "urgent:" });
		subject.handle({ type: "press", action: "urgent:" });
		expect(pressed).toEqual([0, 0]);
		expect(sent).toEqual([{ type: "image", action: "urgent:", png: raster("face", 80) }]);
	});

	it("ignores an action of a kind it doesn't know", () => {
		const sent: SidecarMessage[] = [];
		const subject = new Keys({}, (message) => sent.push(message), raster);
		subject.handle({ type: "appear", action: "nope:", size: 80 });
		subject.handle({ type: "press", action: "nope:" });
		subject.repaint();
		expect(sent).toEqual([]);
	});
});
