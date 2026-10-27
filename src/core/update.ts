/**
 * Updating T3 Code from the deck, the way its Update action does (apps/web/src/components/ServerUpdateAction.tsx,
 * packages/client-runtime/src/state/server.ts). T3 Code sends no "update available" signal over its socket: its
 * clients update a server to their own version. The deck has none, so it asks npm for the newest release on the
 * server's channel, once, when the user holds the key.
 */
import { type MessageKey, t } from "./i18n.js";

/** The `ServerConfig.environment` fields an update reads (packages/contracts/src/environment.ts). */
export type UpdateEnvironment = {
	serverVersion?: string;
	capabilities?: {
		serverSelfUpdate?: string;
		serverSelfUpdateProgress?: boolean;
		desktopAppUpdate?: boolean;
		serverUpdateThreadContinuation?: boolean;
	};
};

/**
 * How a machine updates: a service that installs a pinned release and restarts itself, the desktop app's own
 * updater, or by hand on that machine (no service, or a desktop app too old to update from a client).
 */
export type UpdateRoute = { kind: "service"; progress: boolean } | { kind: "desktop"; progress: boolean } | { kind: "manual"; reason: MessageKey };

export function updateRoute(environment: UpdateEnvironment | undefined): UpdateRoute {
	const capabilities = environment?.capabilities ?? {};
	const progress = capabilities.serverSelfUpdateProgress === true;
	switch (capabilities.serverSelfUpdate) {
		case "boot-service":
		case "respawn":
			return { kind: "service", progress };
		case "desktop-managed":
			return capabilities.desktopAppUpdate === true ? { kind: "desktop", progress } : { kind: "manual", reason: "update.desktopTooOld" };
		default:
			return { kind: "manual", reason: "update.manual" };
	}
}

export type ReleaseChannel = "stable" | "nightly" | "preview";

/** `cliReleaseChannelOf` (packages/shared/src/cliRelease.ts). */
export function releaseChannel(version: string): ReleaseChannel {
	const channel = /^[^-+]+-(nightly|preview)\.\d{8}\.\d+$/.exec(version)?.[1];
	return channel === "nightly" || channel === "preview" ? channel : "stable";
}

/** npm's dist-tag for each channel of the `t3` package. */
const DIST_TAG: Record<ReleaseChannel, string> = { stable: "latest", nightly: "nightly", preview: "preview" };

export const DIST_TAGS_URL = "https://registry.npmjs.org/-/package/t3/dist-tags";

type Parsed = { core: [number, number, number]; pre: string[] };

function parse(version: string): Parsed | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version.trim());
	if (match === null) return undefined;
	return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split(".") ?? [] };
}

/** Semver order: negative when `a` is older. Unparseable versions compare equal, so nothing updates to them. */
export function compareVersions(a: string, b: string): number {
	const left = parse(a);
	const right = parse(b);
	if (left === undefined || right === undefined) return 0;
	for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i]! - right.core[i]!;
	if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length;
	for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
		const x = left.pre[i];
		const y = right.pre[i];
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		if (x === y) continue;
		const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
		return numeric ? Number(x) - Number(y) : x < y ? -1 : 1;
	}
	return 0;
}

/** The release a server on `current` updates to, from npm's dist-tags; undefined when it already runs the newest. */
export function updateTarget(distTags: unknown, current: string): string | undefined {
	const tag = (distTags as Record<string, unknown> | null)?.[DIST_TAG[releaseChannel(current)]];
	if (typeof tag !== "string" || parse(tag) === undefined) return undefined;
	return compareVersions(tag, current) > 0 ? tag : undefined;
}

/** What the key shows while an update runs. */
export type UpdateStage = "checking" | "downloading" | "installing" | "restarting";

/** A server stage (`ServerSelfUpdateProgressStage`) as the deck shows it; unknown ones keep the current stage. */
export const progressStage = (stage: unknown): UpdateStage | undefined => (stage === "downloading" || stage === "installing" ? stage : undefined);

/** T3 Code's `ServerSelfUpdateError` reasons are sentences; a key has room for a few words. */
export function updateFailure(reason: string | undefined): string {
	if (reason === undefined) return t("update.failed");
	if (/up to date/i.test(reason)) return t("update.upToDate");
	if (/already in progress/i.test(reason)) return t("update.inProgress");
	if (/service install|update the desktop app to update it/i.test(reason)) return t("update.manual");
	return t("update.failed");
}

/** How long a restarting server has to come back on the new version (T3 Code waits four minutes). */
export const RESTART_TIMEOUT_MS = 4 * 60_000;

/** The release to update a server on `current` to, asked of npm once per hold; undefined when it is the newest. */
export async function fetchUpdateTarget(fetchFn: typeof fetch, current: string): Promise<string | undefined> {
	const response = await fetchFn(DIST_TAGS_URL, { signal: AbortSignal.timeout(10_000) });
	if (!response.ok) throw new Error(`npm answered ${response.status}.`);
	return updateTarget(await response.json(), current);
}
