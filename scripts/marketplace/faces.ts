// Key and dial faces for the marketplace images, drawn by the plugin's own renderer so the art matches the deck.
// Sample data is made up (threads, model names, numbers).
import { COLORS, dotsCue, ladderCue, renderControlKey, renderDecisionKey, renderInfoKey, renderThreadKey, stripCanvas, stripIcon } from "../../src/core/render.ts";
import { stripFeedback, type StripContent } from "../../src/core/strip.ts";
import { glyphArt } from "../../src/core/render.ts";

type Strip = Record<string, string | { value: string; color: string }>;
const T3 = { appearance: { background: "t3", hairline: true } } as const;
const strip = (content: Omit<StripContent, "icon"> & { glyph: Parameters<typeof glyphArt>[0]; color?: string }): Strip =>
	({ layout: "strip", ...stripFeedback({ ...content, icon: glyphArt(content.glyph, content.color) }, T3) });

/** The Threads dial's list face (`layouts/list.json`). */
const list = (heading: string, counter: string, rows: [string, string, string, string], glyph: Parameters<typeof stripIcon>[0], color: string, accent: string): Strip => ({
	layout: "list",
	canvas: stripCanvas(accent),
	heading,
	counter,
	previous: rows[0],
	glyph: stripIcon(glyph, color),
	selected: rows[1],
	next: rows[2],
	after: rows[3],
});

/** Spinner angles for the video, a turn a second at 30fps. */
const spin = (frames: number) => Array.from({ length: frames }, (_, i) => renderThreadKey({ state: "running", title: "Refactor the settings panel", meta: "4m", motion: { spin: (i * 12) % 360 } }));

export function faces() {
	return {
		keys: {
			running: renderThreadKey({ state: "running", title: "Refactor the settings panel", meta: "4m", motion: { spin: 40 }, subagents: 2 }),
			runningSpin: spin(30),
			approval: renderThreadKey({ state: "approval", title: "Migrate the billing tables", meta: "12m" }),
			question: renderThreadKey({ state: "question", title: "Pick a chart library", meta: "2m" }),
			done: renderThreadKey({ state: "done", unseen: true, title: "Add dark mode to the docs", diff: { additions: 40, deletions: 8 } }),
			failed: renderThreadKey({ state: "failed", title: "Fix the flaky upload test", meta: "1.5h" }),
			idle: renderThreadKey({ state: "idle", title: "Plan the v2 onboarding", meta: "1d", selected: false }),
			queued: renderThreadKey({ state: "running", title: "Write release notes", meta: "8m", queued: 2, motion: { spin: 200 }, worktree: true }),

			approve: renderDecisionKey({ kind: "approve", armed: true, caption: "Allow once", detail: "Run migration" }),
			deny: renderDecisionKey({ kind: "deny", armed: true, caption: "Deny" }),

			model: renderControlKey({ glyph: "model", label: "Nova 4", cue: dotsCue(4, 1) }),
			effort: renderControlKey({ glyph: "brain", label: "Ultrathink", glyphColor: "#C084FC", labelColor: "#C084FC", cue: ladderCue(5, 4, true, undefined, 1), ultrathink: true }),
			effortHigh: renderControlKey({ glyph: "brain", label: "High", cue: ladderCue(5, 3) }),
			speed: renderControlKey({ glyph: "speedFilled", glyphColor: COLORS.accent, active: true }),
			permissions: renderControlKey({ glyph: "modeAutoAcceptEdits", label: "Auto-accept edits" }),
			plan: renderControlKey({ glyph: "modePlan", label: "Plan" }),

			newThread: renderControlKey({ glyph: "compose" }),
			send: renderControlKey({ glyph: "send", label: "Continue", primary: true }),
			steer: renderInfoKey({ glyph: "steer", title: "Focus on the API first, then the UI" }),
			stop: renderControlKey({ glyph: "stop", primary: true }),
			skill: renderInfoKey({ glyph: "skill", title: "Review changes" }),

			git: renderInfoKey({ glyph: "gitPush", title: "Commit & push", detail: "6 files · ↑2" }),
			pr: renderInfoKey({ glyph: "pullRequest", color: COLORS.done, title: "#128 Dark mode", detail: "Checks passed" }),
			prFix: renderInfoKey({ glyph: "hammer", color: COLORS.attention, title: "Fix findings", detail: "3 to fix" }),
			branch: renderInfoKey({ glyph: "branch", title: "feat/dark-mode", detail: "6 files ↑2 ↓0" }),

			usage: renderInfoKey({ glyph: "usage", title: "$18.40", detail: "Past 7 days · 42M tok" }),
			limits: renderInfoKey({ glyph: "gauge", title: "Weekly 61% left", detail: "Resets Thu" }),
			health: renderInfoKey({ glyph: "health", color: COLORS.done, title: "Connected", detail: "2 machines" }),
			activity: renderInfoKey({ glyph: "chat", color: COLORS.attention, tint: COLORS.attention, title: "Migrate the billing tables", detail: "Needs approval" }),
		},
		strips: {
			threads: list("Needs you", "2 / 6", ["Add dark mode to the docs", "Migrate the billing tables", "Pick a chart library", "Fix the flaky upload test"], "clock", COLORS.attention, COLORS.attention),
			threadsRunning: list("Working", "1 / 3", ["Plan the v2 onboarding", "Refactor the settings panel", "Write release notes", "Add dark mode to the docs"], "spinner", COLORS.text, COLORS.accent),
			answer: strip({ header: "Run migration?", glyph: "shield", color: COLORS.attention, accent: COLORS.attention, tone: "attention", value: "Allow once", detail: "npm run db:migrate" }),
			power: strip({ header: "Effort", glyph: "brain", color: "#C084FC", accent: "#C084FC", value: "Ultrathink", detail: "Nova 4 · Fast", ultrathink: true }),
			model: strip({ header: "Model", glyph: "model", accent: COLORS.accent, value: "Nova 4", detail: "2 of 4 favorites" }),
			pr: strip({ header: "Pull requests", glyph: "pullRequest", color: COLORS.done, accent: COLORS.done, value: "#128 Dark mode", detail: "Checks passed · 1 review" }),
			usage: strip({ header: "Past 7 days", glyph: "usage", accent: COLORS.accent, value: "$18.40", detail: "42M tokens · 96% cache" }),
			limits: strip({ header: "Weekly limit", glyph: "gauge", accent: COLORS.done, value: "61% left", detail: "Resets Thu 9:00" }),
			prompts: strip({ header: "Prompts", glyph: "spark", accent: COLORS.accent, value: "Run tests and fix", detail: "Press to send" }),
			skills: strip({ header: "Skills", glyph: "skill", accent: COLORS.accent, value: "Review changes", detail: "Write tests" }),
		},
	};
}
