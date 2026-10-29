import streamDeck from "@elgato/streamdeck";

import { openExternal } from "../core/commands.js";
import { GitStatuses } from "../core/git.js";
import type { KeyRuntime } from "../core/keys/key.js";
import { UsageStore } from "../core/usage/store.js";
import { deck } from "../deck.js";
import { openThread, queuedCount, selectThread } from "./base.js";

const logger = streamDeck.logger.createScope("keys");
const usageLogger = streamDeck.logger.createScope("usage");

export const deckRuntime: KeyRuntime = {
	machines: () => deck.machines,
	board: deck.board,
	openThread,
	openExternal,
	repaint: () => deck.repaint(),
	appearance: () => deck.appearance,
	acpIcons: deck.acpIcons,
	motion: () => deck.animator.mode,
	transitions: deck.transitions,
	queued: queuedCount,
	selectThread,
	scheme: () => deck.scheme,
	ultrathink: deck.ultrathink,
	git: new GitStatuses(() => deck.repaint()),
	openUrl: (url) => streamDeck.system.openUrl(url),
	warn: (message) => void logger.warn(message),
	retry: (url) => deck.retry(url),
	refreshConfigs: (url) => deck.refreshConfigs(url),
	optIn: { requested: (url, scope) => deck.scopeRequested(url, scope), request: (url, ...scopes) => deck.optInScope(url, ...scopes) },
	usage: new UsageStore(
		() => deck.repaint(),
		Date.now,
		(machine, summary) => {
			if ((summary.scanDurationMs ?? 0) > 2_000) usageLogger.info(`Usage scan on ${new URL(machine.url).host} took ${summary.scanDurationMs} ms`);
		},
	),
};
