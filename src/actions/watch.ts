import { MachineWatch } from "../core/watch.js";
import { deck } from "../deck.js";

/** `MachineWatch` that resyncs on Stream Deck repaints. */
export class DeckWatch extends MachineWatch {
	constructor(options: ConstructorParameters<typeof MachineWatch>[0]) {
		super(options, (listener) => deck.onRepaint(listener));
	}
}
