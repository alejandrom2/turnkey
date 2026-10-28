import { Transitions } from "../core/motion.js";
import type { DeckState } from "../core/t3/shell.js";
import type { HapticEvent, SidecarMessage } from "./protocol.js";

/** The state a thread moves into that buzzes the mouse; names match events/DefaultEventSource.yaml. */
const CUES: Partial<Record<DeckState, HapticEvent>> = {
	approval: "approvalNeeded",
	question: "questionAsked",
	done: "runFinished",
	failed: "runFailed",
};
const ORDER: readonly HapticEvent[] = ["approvalNeeded", "questionAsked", "runFinished", "runFailed"];

/** Turns threads changing state into haptic events: one per kind per update, and none for a thread seen for the first time. */
export class HapticCues {
	readonly #transitions = new Transitions();

	constructor(private readonly send: (message: SidecarMessage) => void) {}

	update(threads: readonly { key: string; deck: DeckState }[]): void {
		const due = new Set<HapticEvent>();
		for (const { to } of this.#transitions.update(threads)) {
			const cue = CUES[to];
			if (cue !== undefined) due.add(cue);
		}
		for (const event of ORDER) if (due.has(event)) this.send({ type: "haptic", event });
	}
}
