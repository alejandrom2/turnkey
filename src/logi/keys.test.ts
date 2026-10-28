import { describe, expect, it } from "vitest";

import { type KeyKind, Keys, STALE_MS } from "./keys.js";
import type { SidecarMessage } from "./protocol.js";

/** A kind whose face is `<shown>@<place>` and whose press steps to the next place. */
function keys() {
	const sent: SidecarMessage[] = [];
	const state = { shown: "a" };
	const counter: KeyKind = { face: (index) => `${state.shown}@${index}`, press: (index) => index + 1 };
	const subject = new Keys({ counter }, (message) => sent.push(message));
	return { subject, sent, state };
}

describe("Keys", () => {
	it("paints a key when it appears", () => {
		const { subject, sent } = keys();
		subject.handle({ type: "appear", action: "counter:", size: 80 });
		expect(sent).toEqual([{ type: "image", action: "counter:", svg: "a@0" }]);
	});

	it("paints a key again each time it appears", () => {
		const { subject, sent } = keys();
		subject.handle({ type: "appear", action: "counter:", size: 80 });
		subject.handle({ type: "appear", action: "counter:", size: 80 });
		expect(sent).toHaveLength(2);
	});

	it("moves a key to the place its kind's press returns", () => {
		const { subject, sent } = keys();
		subject.handle({ type: "appear", action: "counter:", size: 80 });
		subject.handle({ type: "press", action: "counter:" });
		expect(sent.at(-1)).toEqual({ type: "image", action: "counter:", svg: "a@1" });
	});

	it("sends nothing when the face didn't change", () => {
		const { subject, sent } = keys();
		subject.handle({ type: "appear", action: "counter:", size: 80 });
		subject.repaint();
		subject.repaint();
		expect(sent).toHaveLength(1);
	});

	it("repaints when what it shows changes", () => {
		const { subject, sent, state } = keys();
		subject.handle({ type: "appear", action: "counter:", size: 80 });
		state.shown = "b";
		subject.repaint();
		expect(sent.at(-1)).toEqual({ type: "image", action: "counter:", svg: "b@0" });
	});

	it("forgets a key that disappeared", () => {
		const { subject, sent, state } = keys();
		subject.handle({ type: "appear", action: "counter:", size: 80 });
		subject.handle({ type: "disappear", action: "counter:" });
		state.shown = "b";
		subject.repaint();
		expect(sent).toHaveLength(1);
	});

	it("keeps a key's place when its kind's press returns nothing", () => {
		const pressed: number[] = [];
		const sent: SidecarMessage[] = [];
		const subject = new Keys({ urgent: { face: () => "face", press: (index) => void pressed.push(index) } }, (message) => sent.push(message));
		subject.handle({ type: "appear", action: "urgent:", size: 80 });
		subject.handle({ type: "press", action: "urgent:" });
		subject.handle({ type: "press", action: "urgent:" });
		expect(pressed).toEqual([0, 0]);
		expect(sent).toEqual([{ type: "image", action: "urgent:", svg: "face" }]);
	});

	it("routes a scroll to its kind and repaints", () => {
		const turned: number[] = [];
		const sent: SidecarMessage[] = [];
		const level = { value: 0 };
		const subject = new Keys({ effort: { face: () => `level ${level.value}`, turn: (ticks) => void turned.push((level.value += ticks)) } }, (message) => sent.push(message));
		subject.handle({ type: "appear", action: "effort:", size: 80 });
		subject.handle({ type: "turn", action: "effort:", ticks: 2 });
		subject.handle({ type: "turn", action: "nope:", ticks: 1 });
		expect(turned).toEqual([2]);
		expect(sent.at(-1)).toEqual({ type: "image", action: "effort:", svg: "level 2" });
	});

	it("hands a kind its action's parameter", () => {
		const pressed: string[] = [];
		const sent: SidecarMessage[] = [];
		const subject = new Keys({ prompt: { face: (_index, parameter) => `face ${parameter}`, press: (_index, parameter) => void pressed.push(parameter) } }, (message) => sent.push(message));
		subject.handle({ type: "appear", action: "prompt:test", size: 80 });
		subject.handle({ type: "press", action: "prompt:test" });
		expect(sent).toEqual([{ type: "image", action: "prompt:test", svg: "face test" }]);
		expect(pressed).toEqual(["test"]);
	});

	it("tells a kind each time its key shows, so it can refresh then instead of polling", () => {
		let shown = 0;
		const subject = new Keys({ limits: { face: () => "face", appear: () => void shown++ } }, () => undefined);
		subject.handle({ type: "appear", action: "limits:", size: 80 });
		subject.handle({ type: "appear", action: "limits:", size: 80 });
		expect(shown).toBe(2);
	});

	it("ignores an action of a kind it doesn't know", () => {
		const sent: SidecarMessage[] = [];
		const subject = new Keys({}, (message) => sent.push(message));
		subject.handle({ type: "appear", action: "nope:", size: 80 });
		subject.handle({ type: "press", action: "nope:" });
		subject.repaint();
		expect(sent).toEqual([]);
	});

	it("forgets a key that hasn't shown in a day", () => {
		let time = 0;
		const sent: SidecarMessage[] = [];
		const state = { shown: "a" };
		const kind: KeyKind = { face: () => state.shown };
		const subject = new Keys({ counter: kind }, (message) => sent.push(message), () => time);
		subject.handle({ type: "appear", action: "counter:old", size: 80 });
		time = STALE_MS;
		subject.handle({ type: "appear", action: "counter:fresh", size: 80 });
		sent.length = 0;
		state.shown = "b";
		time = STALE_MS + 1;
		subject.repaint();
		expect(sent).toEqual([{ type: "image", action: "counter:fresh", svg: "b" }]);
	});

	it("a press revives a key forgotten as stale", () => {
		let time = 0;
		const sent: SidecarMessage[] = [];
		const pressed: number[] = [];
		const kind: KeyKind = { face: (index) => `@${index}`, press: (index) => (pressed.push(index), index + 1) };
		const subject = new Keys({ counter: kind }, (message) => sent.push(message), () => time);
		subject.handle({ type: "appear", action: "counter:", size: 80 });
		time = STALE_MS + 1;
		subject.repaint();
		subject.handle({ type: "press", action: "counter:" });
		expect(pressed).toEqual([0]);
		expect(sent.at(-1)).toEqual({ type: "image", action: "counter:", svg: "@1" });
		// A turn counts as seen too, so the key keeps its place past a day from its revival.
		time = STALE_MS * 2;
		subject.handle({ type: "turn", action: "counter:", ticks: 1 });
		time = STALE_MS * 2.5;
		subject.repaint();
		subject.handle({ type: "press", action: "counter:" });
		expect(pressed).toEqual([0, 1]);
	});
});
