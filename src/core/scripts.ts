/**
 * Project scripts, run the way T3 Code's script runner runs them (packages/shared/src/projectScripts.ts,
 * apps/web/src/components/chat/useChatTerminalActions.ts): a terminal on the thread opens in its worktree, else the
 * project's root, and the command is typed into its shell. The terminal is the shell, so T3 Code reports whether
 * something runs in it, not the exit code of what ran; only the shell's own exit has one.
 */
import type { GlyphName } from "./render.js";

export type ScriptIcon = "play" | "test" | "lint" | "configure" | "build" | "debug";

/** `ProjectScript` (packages/contracts/src/project.ts), the fields the deck reads. */
export type ProjectScript = { id: string; name: string; command: string; icon?: ScriptIcon | string };

/** The `ServerSettings` fields that decide a project's scripts. Absent ones mean T3 Code's defaults. */
export type ScriptSettings = {
	defaultProjectScripts?: ProjectScript[];
	projectScriptOverrides?: Record<string, ProjectScript[] | null>;
	projectSettingsOverrides?: Record<string, { defaultProjectScripts?: ProjectScript[] }>;
	projectSettingsFolded?: boolean;
};

/** `resolveProjectScripts`: the project's override, else the defaults (folded settings), else its own scripts. */
export function projectScripts(settings: ScriptSettings | undefined, project: { id: string; scripts?: ProjectScript[] }): readonly ProjectScript[] {
	const defaults = settings?.defaultProjectScripts ?? [];
	const override = settings?.projectSettingsOverrides?.[project.id]?.defaultProjectScripts;
	if (override !== undefined) return override;
	if (settings?.projectSettingsFolded === true) return defaults;
	const legacy = settings?.projectScriptOverrides?.[project.id];
	if (legacy === null) return defaults;
	const own = project.scripts ?? [];
	return legacy ?? (own.length > 0 ? own : defaults);
}

const SCRIPT_GLYPH: Record<ScriptIcon, GlyphName> = {
	play: "play",
	test: "scriptTest",
	lint: "scriptLint",
	configure: "scriptConfigure",
	build: "hammer",
	debug: "scriptDebug",
};

/** The script's icon as T3 Code draws it (`ScriptIcon`, apps/web/src/components/projectScriptEditor.tsx). */
export const scriptGlyph = (icon: string | undefined): GlyphName => SCRIPT_GLYPH[icon as ScriptIcon] ?? "play";

/**
 * Where and how a script runs (`projectScriptCwd`, `projectScriptRuntimeEnv`). The same thread always gets the same
 * values: T3 Code restarts a terminal opened again with a different folder or environment.
 */
export function scriptLaunch(workspaceRoot: string, worktreePath: string | undefined): { cwd: string; worktreePath: string | null; env: Record<string, string> } {
	return {
		cwd: worktreePath ?? workspaceRoot,
		worktreePath: worktreePath ?? null,
		env: { T3CODE_PROJECT_ROOT: workspaceRoot, ...(worktreePath ? { T3CODE_WORKTREE_PATH: worktreePath } : {}) },
	};
}

/** T3 Code's `projectScriptTerminalInput`: the leading space keeps it out of shell history. */
export const scriptInput = (command: string): string => ` ${command}\r`;

/** What Stop types: Ctrl-C, as a person at that terminal would, which leaves the shell open. */
export const INTERRUPT_INPUT = "\u0003";

/** The deck's own terminal per script, so it never types into one the user is busy in. T3 Code allows 128 characters. */
export const scriptTerminalId = (scriptId: string): string => `deck-${scriptId}`.slice(0, 128);

/** `TerminalSummary` (packages/contracts/src/terminal.ts), the fields the deck reads. */
export type TerminalSummary = {
	threadId: string;
	terminalId: string;
	status: "starting" | "running" | "exited" | "error";
	exitCode: number | null;
	exitSignal?: number | null;
	hasRunningSubprocess: boolean;
	label?: string;
};

export const terminalKey = (threadId: string, terminalId: string): string => `${threadId}\n${terminalId}`;

const sameState = (a: TerminalSummary | undefined, b: TerminalSummary): boolean =>
	a !== undefined && a.status === b.status && a.exitCode === b.exitCode && (a.exitSignal ?? null) === (b.exitSignal ?? null) && a.hasRunningSubprocess === b.hasRunningSubprocess;

/** Applies one `subscribeTerminalMetadata` event; the same map when it changes nothing the deck knows. */
export function applyTerminalEvent(terminals: ReadonlyMap<string, TerminalSummary>, event: unknown): ReadonlyMap<string, TerminalSummary> {
	const value = event as { type?: string; terminals?: TerminalSummary[]; terminal?: TerminalSummary; threadId?: string; terminalId?: string } | null;
	switch (value?.type) {
		case "snapshot":
			return new Map((value.terminals ?? []).map((terminal) => [terminalKey(terminal.threadId, terminal.terminalId), terminal]));
		case "upsert": {
			if (value.terminal === undefined) return terminals;
			const key = terminalKey(value.terminal.threadId, value.terminal.terminalId);
			// Output moves labels and timestamps constantly; only a change the key shows repaints the deck.
			if (sameState(terminals.get(key), value.terminal)) return terminals;
			return new Map(terminals).set(key, value.terminal);
		}
		case "remove": {
			if (value.threadId === undefined || value.terminalId === undefined) return terminals;
			const next = new Map(terminals);
			next.delete(terminalKey(value.threadId, value.terminalId));
			return next;
		}
		default:
			return terminals;
	}
}

/** How long a script just started shows "Starting" before T3 Code's once-a-second process check has to have seen it. */
export const START_GRACE_MS = 3_000;

/**
 * What a Run Script key shows. `finished`: its shell is idle after running it (T3 Code doesn't say how it ended);
 * `stopped`: the deck interrupted it; `exited`: the shell itself ended, with its code.
 */
export type ScriptState =
	| { kind: "idle" }
	| { kind: "starting" }
	| { kind: "running" }
	| { kind: "finished" }
	| { kind: "stopped" }
	| { kind: "exited"; code: number | null }
	| { kind: "error" };

/** `local`: when the deck last started or stopped this script's terminal, since T3 Code only sees processes once a second. */
export function scriptState(terminal: TerminalSummary | undefined, local: { startedAt?: number; stoppedAt?: number }, now: number): ScriptState {
	if (terminal?.hasRunningSubprocess === true && (terminal.status === "running" || terminal.status === "starting")) return { kind: "running" };
	const starting = local.startedAt !== undefined && now - local.startedAt < START_GRACE_MS && (local.stoppedAt === undefined || local.stoppedAt < local.startedAt);
	if (starting) return { kind: "starting" };
	if (terminal === undefined) return { kind: "idle" };
	if (terminal.status === "error") return { kind: "error" };
	if (terminal.status === "exited") return { kind: "exited", code: terminal.exitCode };
	if (local.stoppedAt !== undefined && (local.startedAt === undefined || local.stoppedAt >= local.startedAt)) return { kind: "stopped" };
	return { kind: "finished" };
}

/** Whether the face moves on its own: the spinner, and the start's grace period ending. */
export const scriptBusy = (state: ScriptState): boolean => state.kind === "running" || state.kind === "starting";
