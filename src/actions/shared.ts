import type { Action, KeyUpEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { SlotIndex } from "../core/slots.js";
import type { KeyContext, KeyDefinition } from "../core/keys/key.js";
import type { MachineWatch } from "../core/watch.js";
import { DeckAction, pressWhileDisconnected } from "./base.js";
import { deckRuntime } from "./runtime.js";
import { DeckWatch } from "./watch.js";

/** A Stream Deck key drawn and pressed through a platform-free `KeyDefinition`. */
export abstract class SharedKey<S extends JsonObject, St> extends DeckAction<S> {
	protected abstract readonly definition: KeyDefinition<S, St>;
	#watch: MachineWatch | undefined;

	/** A key that fills a board slot says which: its place among its siblings. */
	protected slotFor(_action: Action<S>): SlotIndex | undefined {
		return undefined;
	}

	#context(action: Action<S>): KeyContext<S> {
		return { settings: this.settingsOf(action), machine: this.machineOf(action), runtime: deckRuntime, target: () => this.target(action), slot: this.slotFor(action) };
	}

	protected override watching(): MachineWatch | undefined {
		const options = this.definition.watch;
		return options === undefined ? undefined : (this.#watch ??= new DeckWatch(options));
	}

	protected override async draw(action: Action<S>): Promise<void> {
		if (!action.isKey()) return;
		const ctx = this.#context(action);
		const state = this.definition.state(ctx);
		if (this.definition.moving) this.animate(action, this.definition.moving(state));
		await this.setImage(action, this.definition.tile(state, ctx));
	}

	override async onKeyUp(ev: KeyUpEvent<S>): Promise<void> {
		const heldMs = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const ctx = this.#context(ev.action);
		const plan = this.definition.press(this.definition.state(ctx), ctx, { heldMs, confirmBy: "settings" });
		if (plan.kind === "run") await this.run(ev.action, plan.work);
		else if (plan.kind !== "nothing") await this.flash(ev.action, false, plan.label);
	}
}
