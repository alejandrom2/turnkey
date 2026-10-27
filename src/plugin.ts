import streamDeck from "@elgato/streamdeck";

import { AnswerDial, ModelDial, PromptDial, ThreadDial } from "./actions/dials.js";
import { Activity, NewThread, Organize, SendPrompt, Stop, ThreadSlot } from "./actions/keys.js";
import { deck } from "./deck.js";

// Never "trace": it would log the access tokens kept in global settings.
streamDeck.logger.setLevel("info");

for (const instance of [
	new ThreadSlot(),
	new Activity(),
	new Stop(),
	new SendPrompt(),
	new NewThread(),
	new Organize(),
	new ThreadDial(),
	new ModelDial(),
	new PromptDial(),
	new AnswerDial(),
]) {
	streamDeck.actions.registerAction(instance);
}

await streamDeck.connect();
await deck.init();
