import streamDeck from "@elgato/streamdeck";

import { AnswerDial, ModelDial, PromptDial, ThreadDial } from "./actions/dials.js";
import { OpenInEditor } from "./actions/editor.js";
import { CommitKey, CreatePrKey, PullKey, PushKey } from "./actions/git.js";
import { LimitsDial, LimitsKey } from "./actions/limits.js";
import { UsageDial, UsageKey } from "./actions/usage.js";
import "./actions/needs.js";
import { AskPrKey, ExplainPrKey, FixFindingsKey, PrDial, ReviewGuideKey } from "./actions/pr.js";
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
import { setTranslator } from "./core/i18n.js";
import { deck } from "./deck.js";

// Never "trace": it would log the access tokens kept in global settings.
streamDeck.logger.setLevel("info");
setTranslator((key) => streamDeck.i18n.translate(key));

// A stray rejection (a request the app never answered) would otherwise take every key and dial down with it.
process.on("unhandledRejection", (reason) => streamDeck.logger.warn(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`));

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
	new CommitKey(),
	new PushKey(),
	new CreatePrKey(),
	new PullKey(),
	new FixFindingsKey(),
	new ExplainPrKey(),
	new AskPrKey(),
	new ReviewGuideKey(),
	new OpenInEditor(),
	new LimitsKey(),
	new UsageKey(),
	new ThreadDial(),
	new ModelDial(),
	new PromptDial(),
	new AnswerDial(),
	new PrDial(),
	new LimitsDial(),
	new UsageDial(),
]) {
	streamDeck.actions.registerAction(instance);
}

await streamDeck.connect();
await deck.init();
