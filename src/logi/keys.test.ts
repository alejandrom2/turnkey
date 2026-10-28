import { describe, expect, it } from "vitest";

import { t } from "../core/i18n.js";
import { renderThreadKey } from "../core/render.js";
import type { DeckState } from "../core/t3/shell.js";
import { type KeyThread, ThreadKeys } from "./keys.js";
import type { SidecarMessage } from "./protocol.js";

const thread = (title: string, deck: DeckState = "idle"): KeyThread => ({ title, deck, unseen: false });
const raster = (dataUrl: string, size: number) => `${size}:${dataUrl}`;
const face = (title: string, deck: DeckState = "idle") => raster(renderThreadKey({ state: deck, title, unseen: false }), 80);

function keys(threads: KeyThread[]) {
	const sent: SidecarMessage[] = [];
	const list = { threads };
	const subject = new ThreadKeys(() => list.threads, (message) => sent.push(message), raster);
	return { subject, sent, list };
}

describe("ThreadKeys", () => {
	it("paints a key when it appears", () => {
		const { subject, sent } = keys([thread("a", "running")]);
		subject.handle({ type: "appear", action: "k", size: 80 });
		expect(sent).toEqual([{ type: "image", action: "k", png: face("a", "running") }]);
	});

	it("shows No threads when there are none", () => {
		const { subject, sent } = keys([]);
		subject.handle({ type: "appear", action: "k", size: 80 });
		expect(sent).toEqual([{ type: "image", action: "k", png: raster(renderThreadKey({ state: "idle", title: t("strip.noThreads") }), 80) }]);
	});

	it("a press steps to the next thread and wraps", () => {
		const { subject, sent } = keys([thread("a"), thread("b")]);
		subject.handle({ type: "appear", action: "k", size: 80 });
		subject.handle({ type: "press", action: "k" });
		subject.handle({ type: "press", action: "k" });
		expect(sent.map((message) => message.type === "image" && message.png)).toEqual([face("a"), face("b"), face("a")]);
	});

	it("sends nothing when the face didn't change", () => {
		const { subject, sent } = keys([thread("a")]);
		subject.handle({ type: "appear", action: "k", size: 80 });
		subject.repaint();
		subject.repaint();
		expect(sent).toHaveLength(1);
	});

	it("repaints when the thread changes", () => {
		const { subject, sent, list } = keys([thread("a", "running")]);
		subject.handle({ type: "appear", action: "k", size: 80 });
		list.threads = [thread("a", "approval")];
		subject.repaint();
		expect(sent.at(-1)).toEqual({ type: "image", action: "k", png: face("a", "approval") });
	});

	it("forgets a key that disappeared", () => {
		const { subject, sent, list } = keys([thread("a")]);
		subject.handle({ type: "appear", action: "k", size: 80 });
		subject.handle({ type: "disappear", action: "k" });
		list.threads = [thread("b")];
		subject.repaint();
		subject.handle({ type: "press", action: "k" });
		expect(sent).toHaveLength(1);
	});
});
