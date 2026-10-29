import type { FakeAction } from "./action.js";
import { world } from "./deck.js";

// Stands in for @elgato/streamdeck in golden tests: the decorator does nothing, the base class lists the instances
// a test adds, and the logger and inspector calls go nowhere.
// Records the manifest id, which merged actions (Git, Stop, Open...) read to pick the mode their legacy UUID preset.
export const action =
	(info: { UUID: string }) =>
	(target: { prototype: { manifestId?: string } }) => {
		target.prototype.manifestId = info.UUID;
	};

export class SingletonAction {
	readonly actions = new Set<FakeAction>();
}

const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

export default {
	logger: { createScope: () => logger, ...logger },
	actions: { onKeyDown: () => undefined, onDialDown: () => undefined, onDialRotate: () => undefined, onTouchTap: () => undefined },
	ui: { sendToPropertyInspector: async () => undefined },
	i18n: { language: "en" },
	// Opening a link is an effect of a press: recorded like a spawned command.
	system: { openUrl: async (url: string) => void world.spawned.push(`openUrl ${url}`) },
};
