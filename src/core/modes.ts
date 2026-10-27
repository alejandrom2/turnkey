/**
 * Actions that do one of a few related things, picked by a mode setting. The single-purpose actions they replaced stay
 * registered under their own UUIDs, hidden from the actions list, as the same action with their mode preset: a key
 * saved before the merge has no mode setting, so it falls back to its UUID's mode and its settings are never rewritten.
 */

/** Each merged action's setting, its modes (the first is the merged action's default) and the mode each UUID starts in. */
export const MERGED = {
	git: {
		setting: "gitAction",
		modes: ["commit", "commit_push", "commit_push_pr", "push", "create_pr", "pull"],
		uuids: {
			"com.alejandrom2.t3deck.git": "commit",
			"com.alejandrom2.t3deck.git.commit": "commit",
			"com.alejandrom2.t3deck.git.push": "push",
			"com.alejandrom2.t3deck.git.pr": "create_pr",
			"com.alejandrom2.t3deck.git.pull": "pull",
		},
	},
	pr: {
		setting: "mode",
		modes: ["show", "fix", "explain", "ask", "guide"],
		uuids: {
			"com.alejandrom2.t3deck.pr": "show",
			"com.alejandrom2.t3deck.pr.fix": "fix",
			"com.alejandrom2.t3deck.pr.explain": "explain",
			"com.alejandrom2.t3deck.pr.ask": "ask",
			"com.alejandrom2.t3deck.pr.guide": "guide",
		},
	},
	/** `custom` is the key's own text; the rest are Quick Prompt's templates (prompts.ts). */
	send: {
		setting: "template",
		modes: ["custom", "continue", "test", "fix", "explain", "commit"],
		uuids: { "com.alejandrom2.t3deck.send": "custom", "com.alejandrom2.t3deck.quick": "continue" },
	},
	stop: { setting: "mode", modes: ["turn", "workflow"], uuids: { "com.alejandrom2.t3deck.stop": "turn", "com.alejandrom2.t3deck.workflow.stop": "workflow" } },
	fork: { setting: "mode", modes: ["fork", "merge"], uuids: { "com.alejandrom2.t3deck.fork": "fork", "com.alejandrom2.t3deck.merge": "merge" } },
	open: {
		setting: "mode",
		modes: ["editor", "preview"],
		uuids: { "com.alejandrom2.t3deck.open": "editor", "com.alejandrom2.t3deck.editor": "editor", "com.alejandrom2.t3deck.preview": "preview" },
	},
} as const;

export type MergedAction = keyof typeof MERGED;
export type ModeOf<A extends MergedAction> = (typeof MERGED)[A]["modes"][number];

/** The mode a UUID starts in: an alias's own, else the merged action's default. */
export function defaultMode<A extends MergedAction>(action: A, manifestId: string | undefined): ModeOf<A> {
	const { modes, uuids } = MERGED[action];
	return (manifestId !== undefined && Object.hasOwn(uuids, manifestId) ? uuids[manifestId as keyof typeof uuids] : modes[0]) as ModeOf<A>;
}

/** The mode a key acts in: its saved setting when that is one of the action's modes, else its UUID's default. */
export function modeOf<A extends MergedAction>(action: A, manifestId: string | undefined, settings: Record<string, unknown>): ModeOf<A> {
	const { setting, modes } = MERGED[action];
	const saved = settings[setting];
	return (modes as readonly unknown[]).includes(saved) ? (saved as ModeOf<A>) : defaultMode(action, manifestId);
}
