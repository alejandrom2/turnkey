import { describe, expect, it } from "vitest";

import { type KeyKind, Keys } from "./keys.js";
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
		subject.handle({ type: "press", action: "counter:" });
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

	it("ignores an action of a kind it doesn't know", () => {
		const sent: SidecarMessage[] = [];
		const subject = new Keys({}, (message) => sent.push(message));
		subject.handle({ type: "appear", action: "nope:", size: 80 });
		subject.handle({ type: "press", action: "nope:" });
		subject.repaint();
		expect(sent).toEqual([]);
	});
});
