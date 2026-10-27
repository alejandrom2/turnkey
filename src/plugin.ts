import streamDeck from "@elgato/streamdeck";

import { AnswerDial, ModelDial, PromptDial, ThreadDial } from "./actions/dials.js";
import {
	Activity,
	Approve,
	Branch,
	Deny,
	EffortKey,
	Health,
	ModelKey,
	NewThread,
	Organize,
	Permissions,
	PlanKey,
	PullRequest,
	QuickPrompt,
	SendPrompt,
	SpeedKey,
	Steer,
	Stop,
	ThreadSlot,
} from "./actions/keys.js";
import { deck } from "./deck.js";

// Never "trace": it would log the access tokens kept in global settings.
streamDeck.logger.setLevel("info");

for (const instance of [
	new Activity(),
	new NewThread(),
	new SendPrompt(),
	new Steer(),
	new QuickPrompt(),
	new Stop(),
	new ModelKey(),
	new EffortKey(),
	new SpeedKey(),
	new Permissions(),
	new PlanKey(),
	new Approve(),
	new Deny(),
	new ThreadSlot(),
	new Organize(),
	new PullRequest(),
	new Branch(),
	new Health(),
	new ThreadDial(),
	new ModelDial(),
	new PromptDial(),
	new AnswerDial(),
]) {
	streamDeck.actions.registerAction(instance);
}

await streamDeck.connect();
await deck.init();
