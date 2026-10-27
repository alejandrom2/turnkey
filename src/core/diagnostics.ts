/**
 * The 24-hour verbose logging switch and the diagnostics export. The export is built from an allowlist: settings,
 * machines and log lines only pass through named fields, URLs shrink to their host and anything token-like in a log
 * line is blanked, so a token, pairing code or signed link can't reach the file.
 */

/** How long verbose logging stays on once turned on. */
export const VERBOSE_MS = 24 * 60 * 60 * 1000;

/** How many warnings and errors from the log the export keeps. */
export const RECENT_PROBLEMS = 50;

/** Whether verbose logging is on: until its end time passes. */
export const verboseOn = (until: number | undefined, now: number): boolean => until !== undefined && until > now;

/** A URL's host and port, never its path, query or fragment (where pair links carry their code). */
export function hostOf(url: string): string {
	try {
		return new URL(url).host || "?";
	} catch {
		return "?";
	}
}

const REDACTED = "[redacted]";
/** Action UUIDs in log lines are long but safe. */
const PLUGIN_ID = "com.alejandrom2.t3deck.";

/** Blanks what could be a credential in free text: URLs shrink to their origin, auth headers, `token=…` pairs, long opaque strings. */
export function redact(text: string): string {
	return text
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (url) => {
			try {
				const parsed = new URL(url);
				return `${parsed.protocol}//${parsed.host}`;
			} catch {
				return "[url]";
			}
		})
		.replace(/\b(bearer|basic|dpop)\s+[^\s"',]+/gi, `$1 ${REDACTED}`)
		.replace(/("?\b(?:access_token|accessToken|token|ticket|code|password|secret|authorization|auth|cookie)"?\s*[:=]\s*)("[^"]*"|[^\s,;&}]+)/gi, `$1${REDACTED}`)
		.replace(/[A-Za-z0-9_\-+/=.]{32,}/g, (run) => (run.startsWith(PLUGIN_ID) ? run : REDACTED));
}

const ENTRY = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z (\w+)\s/;
const PROBLEM_LEVELS = new Set(["WARN", "ERROR"]);
/** A stack trace keeps this many lines under its entry. */
const CONTINUATION_LINES = 6;

/** The last warnings and errors in a plugin log (its tail is enough), stack lines kept under their entry, each redacted. */
export function recentProblems(log: string, limit = RECENT_PROBLEMS): string[] {
	const problems: string[][] = [];
	let current: string[] | undefined;
	for (const line of log.split(/\r?\n/)) {
		const entry = ENTRY.exec(line);
		if (entry !== null) {
			current = PROBLEM_LEVELS.has(entry[1]!) ? [line] : undefined;
			if (current !== undefined) problems.push(current);
		} else if (current !== undefined && line.trim() !== "" && current.length <= CONTINUATION_LINES) current.push(line);
	}
	return problems.slice(-limit).map((lines) => redact(lines.join("\n")));
}

/** The settings worth reporting: appearance and behavior. Tokens, scope requests and machine URLs are never read. */
const REPORTED_SETTINGS = ["scheme", "stripBackground", "stripStyle", "stripHairline", "textScroll", "motion", "idlePet", "confirmSend", "maxEffort"] as const;

export type DiagnosticsMachine = {
	url: string;
	state: string;
	message?: string;
	scopes: readonly string[];
	environmentId?: string;
};

export type DiagnosticsInput = {
	now: number;
	plugin: string;
	streamDeck: string;
	os: { platform: string; version: string; arch: string };
	node: string;
	verboseUntil: number | undefined;
	settings: Record<string, unknown>;
	machines: readonly DiagnosticsMachine[];
	/** Visible instances per action UUID. */
	actions: Record<string, number>;
	/** The tail of the current log file. */
	log: string;
};

/** The export's contents: every field is picked by name, so nothing else in the inputs can leak into it. */
export function diagnosticsReport(input: DiagnosticsInput) {
	const settings: Record<string, string | boolean> = {};
	for (const name of REPORTED_SETTINGS) {
		const value = input.settings[name];
		if (typeof value === "string" || typeof value === "boolean") settings[name] = name === "scheme" && typeof value === "string" ? redact(value) : value;
	}
	const listed = typeof input.settings.environments === "string" ? input.settings.environments.split(/\s+/).filter(Boolean).length : 0;
	return {
		generatedAt: new Date(input.now).toISOString(),
		plugin: input.plugin,
		streamDeck: input.streamDeck,
		os: { platform: input.os.platform, version: input.os.version, arch: input.os.arch },
		node: input.node,
		verboseLoggingUntil: verboseOn(input.verboseUntil, input.now) ? new Date(input.verboseUntil!).toISOString() : null,
		settings: { ...settings, addedMachines: listed },
		machines: input.machines.map((machine) => ({
			host: hostOf(machine.url),
			state: machine.state,
			...(machine.message ? { message: redact(machine.message) } : {}),
			scopes: machine.scopes.filter((scope) => /^[a-z-]+:[a-z-]+$/.test(scope)),
			...(machine.environmentId ? { environmentId: machine.environmentId } : {}),
		})),
		actions: Object.fromEntries(Object.entries(input.actions).filter(([, count]) => count > 0)),
		recentProblems: recentProblems(input.log),
	};
}
