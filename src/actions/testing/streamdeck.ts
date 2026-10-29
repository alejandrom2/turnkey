import type { FakeAction } from "./action.js";

// Stands in for @elgato/streamdeck in golden tests: the decorator does nothing, the base class lists the instances
// a test adds, and the logger and inspector calls go nowhere.
export const action = () => () => undefined;

export class SingletonAction {
	readonly actions = new Set<FakeAction>();
}

const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

export default {
	logger: { createScope: () => logger, ...logger },
	actions: { onKeyDown: () => undefined, onDialDown: () => undefined, onDialRotate: () => undefined, onTouchTap: () => undefined },
	ui: { sendToPropertyInspector: async () => undefined },
	i18n: { language: "en" },
};
