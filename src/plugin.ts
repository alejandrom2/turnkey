import streamDeck from "@elgato/streamdeck";

import { RunScriptKey, ShareKey, UpdateKey } from "./actions/admin.js";
import { AnswerDial, ModelDial, PromptDial, ThreadDial } from "./actions/dials.js";
import { DevicesDial } from "./actions/devices.js";
import { CommitKey, CreatePrKey, GitKey, PullKey, PushKey } from "./actions/git.js";
import { LimitsDial, LimitsKey } from "./actions/limits.js";
import { ForkKey, MergeBackKey, Stop, StopWorkflowKey } from "./actions/lineage.js";
import { OpenInEditor, OpenKey, OpenPreview } from "./actions/open.js";
import { QueueDial } from "./actions/queue.js";
import { RunSkillKey, SkillsDial } from "./actions/skills.js";
import { RunTaskKey, TasksDial } from "./actions/tasks.js";
import { UsageDial, UsageKey } from "./actions/usage.js";
import "./actions/needs.js";
import { AskPrKey, ExplainPrKey, FixFindingsKey, PrDial, PullRequest, ReviewGuideKey } from "./actions/pr.js";
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
	QuickPrompt,
	SendPrompt,
	SpeedKey,
	Steer,
	ThreadSlot,
} from "./actions/keys.js";
import { setTranslator } from "./core/i18n.js";
import { deck } from "./deck.js";

// Never "trace": it would log the access tokens kept in global settings. Verbose logging raises this to "debug" (deck.ts).
streamDeck.logger.setLevel("info");
setTranslator((key) => streamDeck.i18n.translate(key));

// A stray rejection (a request the app never answered) would otherwise take every key and dial down with it.
process.on("unhandledRejection", (reason) => streamDeck.logger.warn(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`));

for (const instance of [
	new ThreadSlot(),
	new Activity(),
	new NewThread(),
	new SendPrompt(),
	new Steer(),
	new RunSkillKey(),
	new Stop(),
	new ModelKey(),
	new EffortKey(),
	new SpeedKey(),
	new Permissions(),
	new PlanKey(),
	new Approve(),
	new Deny(),
	new Organize(),
	new ForkKey(),
	new Branch(),
	new GitKey(),
	new PullRequest(),
	new RunTaskKey(),
	new UsageKey(),
	new LimitsKey(),
	new OpenKey(),
	new Health(),
	new UpdateKey(),
	new RunScriptKey(),
	new ShareKey(),
	new ThreadDial(),
	new ModelDial(),
	new PromptDial(),
	new AnswerDial(),
	new QueueDial(),
	new TasksDial(),
	new SkillsDial(),
	new PrDial(),
	new LimitsDial(),
	new UsageDial(),
	new DevicesDial(),
	// Older single-purpose keys, now modes of the actions above.
	new CommitKey(),
	new PushKey(),
	new CreatePrKey(),
	new PullKey(),
	new FixFindingsKey(),
	new ExplainPrKey(),
	new AskPrKey(),
	new ReviewGuideKey(),
	new QuickPrompt(),
	new StopWorkflowKey(),
	new MergeBackKey(),
	new OpenInEditor(),
	new OpenPreview(),
]) {
	streamDeck.actions.registerAction(instance);
}

await streamDeck.connect();
await deck.init();
