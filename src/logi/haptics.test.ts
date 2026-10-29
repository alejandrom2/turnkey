import { describe, expect, it } from "vitest";

import type { DeckState } from "../core/t3/shell.js";
import { HapticCues } from "./haptics.js";
import type { SidecarMessage } from "./protocol.js";

const at = (...states: [string, DeckState][]) => states.map(([key, deck]) => ({ key, deck }));

function cues() {
	const sent: SidecarMessage[] = [];
	return { subject: new HapticCues((message) => sent.push(message)), sent };
}

describe("HapticCues", () => {
	it("stays quiet on the first look, so connecting doesn't buzz for every waiting thread", () => {
		const { subject, sent } = cues();
		subject.update(at(["a", "approval"], ["b", "failed"]));
		expect(sent).toEqual([]);
	});

	it("buzzes when a thread starts needing you or settles", () => {
		const { subject, sent } = cues();
		subject.update(at(["a", "running"], ["b", "running"], ["c", "running"], ["d", "running"]));
		subject.update(at(["a", "approval"], ["b", "question"], ["c", "done"], ["d", "failed"]));
		expect(sent).toEqual([
			{ type: "haptic", event: "approvalNeeded" },
			{ type: "haptic", event: "questionAsked" },
			{ type: "haptic", event: "runFinished" },
			{ type: "haptic", event: "runFailed" },
		]);
	});

	it("stays quiet while nothing changes, and for changes that don't need you", () => {
		const { subject, sent } = cues();
		subject.update(at(["a", "approval"]));
		subject.update(at(["a", "approval"]));
		subject.update(at(["a", "running"]));
		expect(sent).toEqual([]);
	});

	it("buzzes once when several threads finish together", () => {
		const { subject, sent } = cues();
		subject.update(at(["a", "running"], ["b", "running"]));
		subject.update(at(["a", "done"], ["b", "done"]));
		expect(sent).toEqual([{ type: "haptic", event: "runFinished" }]);
	});

	it("treats a thread that left and came back as new", () => {
		const { subject, sent } = cues();
		subject.update(at(["a", "running"]));
		subject.update([]);
		subject.update(at(["a", "done"]));
		expect(sent).toEqual([]);
	});
});
