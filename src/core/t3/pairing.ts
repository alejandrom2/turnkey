import { networkInterfaces } from "node:os";

import { t } from "../i18n.js";

/**
 * Pair links, environment preflight, token exchange and WebSocket tickets: the HTTP half of T3 Code's
 * client API (packages/client-runtime/src/authorization/remote.ts in the T3 Code repo).
 */

export const PROTOCOL_VERSION = 2;
export const READ_SCOPE = "orchestration:read";
export const OPERATE_SCOPE = "orchestration:operate";
export const DIAGNOSTICS_SCOPE = "diagnostics:read";
export const SOURCE_CONTROL_SCOPE = "source-control:write";
/** Spending a banked limits reset; asked for only on a machine where the user turned that on. */
export const PROVIDERS_SCOPE = "providers:manage";
/**
 * What every pairing asks for. The server grants the overlap with what the pair link allows and drops names it
 * doesn't know, so asking for more never fails a pairing; T3 Code's standard links grant all four.
 */
export const REQUESTED_SCOPES = [READ_SCOPE, OPERATE_SCOPE, DIAGNOSTICS_SCOPE, SOURCE_CONTROL_SCOPE] as const;
/** Broader scopes a machine asks for only after the user turns on an action that needs one there. */
export const OPT_IN_SCOPES = ["providers:manage", "terminal:operate", "access:write", "environment:maintain"] as const;
export type OptInScope = (typeof OPT_IN_SCOPES)[number];

export const isOptInScope = (scope: string): scope is OptInScope => (OPT_IN_SCOPES as readonly string[]).includes(scope);

/** The scopes a token exchange asks for: the standard ones plus the opted-in extras. */
export const requestedScopes = (extra: readonly string[] = []): string[] => [...new Set([...REQUESTED_SCOPES, ...extra.filter(isOptInScope)])];

/** What the plugin keeps per machine in global settings. `expiresAt` is epoch ms. */
export type Credential = {
	token: string;
	expiresAt: number;
	scopes: string[];
	label: string;
	environmentId: string;
};

export type EnvironmentDescriptor = {
	environmentId: string;
	label: string;
	orchestrationProtocolVersion?: number;
};

export type PairLink = { url: string; code: string };

/**
 * A user-facing failure. `repair`: the credential is no good and only a new pair link helps.
 * `incompatible`: retrying will not help until one side updates. Both stop reconnecting.
 */
export class PairingError extends Error {
	constructor(
		message: string,
		readonly kind: "repair" | "incompatible" | "other" = "other",
	) {
		super(message);
	}

	get fatal(): boolean {
		return this.kind !== "other";
	}
}

const isLoopback = (hostname: string) => hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";

/** True when `hostname` names this computer: loopback or one of its interface addresses. */
export function isThisComputer(hostname: string, interfaces = networkInterfaces()): boolean {
	if (isLoopback(hostname)) return true;
	const bare = hostname.replace(/^\[|\]$/g, "");
	return Object.values(interfaces)
		.flat()
		.some((address) => address?.address === bare);
}

/**
 * A machine's identity: its origin. Accepts ws(s) and strips the `/mcp` path older versions stored,
 * so saved settings and per-action machine choices keep pointing at the same machine.
 */
export function normalizeEnvironmentUrl(raw: string): string | undefined {
	try {
		const url = new URL(raw.trim());
		const protocol = url.protocol === "ws:" ? "http:" : url.protocol === "wss:" ? "https:" : url.protocol;
		if (protocol !== "http:" && protocol !== "https:") return undefined;
		return `${protocol}//${url.host}`;
	} catch {
		return undefined;
	}
}

/** A pair link made on this computer names its LAN address; talk to it over loopback instead. */
export function preferLoopback(url: string, interfaces = networkInterfaces()): string {
	const parsed = new URL(url);
	if (!isThisComputer(parsed.hostname, interfaces)) return url;
	return `${parsed.protocol}//127.0.0.1${parsed.port ? `:${parsed.port}` : ""}`;
}

/**
 * Reads a T3 Code pair link the way T3 Code does (`resolveRemotePairingTarget`, packages/shared/src/remote.ts):
 * `http://host:3773/pair#token=CODE`, the older `?token=`, or a hosted `…/pair?host=…#token=CODE`.
 */
export function parsePairingLink(raw: string): PairLink | undefined {
	let link: URL;
	try {
		link = new URL(raw.trim());
	} catch {
		return undefined;
	}
	if (normalizeEnvironmentUrl(link.href) === undefined) return undefined;
	const code = (new URLSearchParams(link.hash.slice(1)).get("token") ?? link.searchParams.get("token") ?? "").trim();
	if (code === "") return undefined;
	const host = link.searchParams.get("host")?.trim();
	const url = normalizeEnvironmentUrl(host ? (/^[a-z]+:\/\//i.test(host) ? host : `https://${host}`) : link.href);
	return url === undefined ? undefined : { url, code };
}

const wsBase = (url: string) => url.replace(/^http/, "ws");
const hostOf = (url: string) => new URL(url).host;
const unreachable = (url: string) => new PairingError(t("pairing.unreachable", { host: hostOf(url) }));

async function errorBody(response: Response): Promise<{ _tag?: string; reason?: string }> {
	return (await response.json().catch(() => ({}))) as { _tag?: string; reason?: string };
}

/** `GET /.well-known/t3/environment`: unauthenticated, and the only protocol gate a WebSocket client can see. */
export async function readEnvironment(url: string, fetchFn: typeof fetch, timeoutMs = 10_000): Promise<EnvironmentDescriptor> {
	let response: Response;
	try {
		response = await fetchFn(`${url}/.well-known/t3/environment`, { signal: AbortSignal.timeout(timeoutMs) });
	} catch {
		throw unreachable(url);
	}
	const body = (await response.json().catch(() => undefined)) as Partial<EnvironmentDescriptor> | undefined;
	if (!response.ok || typeof body?.environmentId !== "string") throw new PairingError(t("pairing.notT3", { host: hostOf(url) }));
	const version = body.orchestrationProtocolVersion ?? 1;
	if (version < PROTOCOL_VERSION) throw new PairingError(t("pairing.tooOld"), "incompatible");
	if (version > PROTOCOL_VERSION) throw new PairingError(t("pairing.tooNew"), "incompatible");
	return { environmentId: body.environmentId, label: body.label ?? hostOf(url), orchestrationProtocolVersion: version };
}

const CLIENT_OS: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

/** The token exchange body. No DPoP header, so T3 Code issues a 30-day Bearer session. */
export function tokenExchangeBody(code: string, platform: NodeJS.Platform = process.platform, scopes: readonly string[] = REQUESTED_SCOPES): URLSearchParams {
	return new URLSearchParams({
		grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
		subject_token: code,
		subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
		requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
		scope: scopes.join(" "),
		client_label: "T3 Deck",
		client_device_type: "desktop",
		client_os: CLIENT_OS[platform] ?? platform,
	});
}

/**
 * Checks the environment, then spends the one-time code. The preflight comes first so a link to an
 * incompatible server is not used up.
 */
export async function redeemPairingCode(url: string, code: string, fetchFn: typeof fetch, now = Date.now(), extraScopes: readonly string[] = []): Promise<Credential> {
	const environment = await readEnvironment(url, fetchFn);
	let response: Response;
	try {
		response = await fetchFn(`${url}/oauth/token`, { method: "POST", body: tokenExchangeBody(code, process.platform, requestedScopes(extraScopes)), signal: AbortSignal.timeout(15_000) });
	} catch {
		throw unreachable(url);
	}
	if (!response.ok) {
		const { reason } = await errorBody(response);
		if (response.status === 401) throw new PairingError(t("pairing.linkUsed"));
		if (reason === "scope_not_granted" || reason === "invalid_scope") throw new PairingError(t("pairing.noAccess"));
		throw new PairingError(t("pairing.refused", { status: response.status }));
	}
	const body = (await response.json()) as { access_token: string; expires_in: number; scope?: string };
	const scopes = (body.scope ?? "").split(" ").filter(Boolean);
	if (!scopes.includes(READ_SCOPE)) throw new PairingError(t("pairing.noRead"));
	return { token: body.access_token, expiresAt: now + body.expires_in * 1000, scopes, label: environment.label, environmentId: environment.environmentId };
}

/**
 * Re-checks the environment and mints a fresh ticket for one socket attempt, as T3 Code's own clients do.
 * The returned URL carries the ticket: never log it.
 */
export async function socketUrl(url: string, credential: Credential, fetchFn: typeof fetch): Promise<string> {
	const environment = await readEnvironment(url, fetchFn);
	if (environment.environmentId !== credential.environmentId) throw new Error(t("pairing.different", { host: hostOf(url) }));
	const mint = async (path: string) => {
		try {
			return await fetchFn(`${url}${path}`, {
				method: "POST",
				headers: { authorization: `Bearer ${credential.token}` },
				signal: AbortSignal.timeout(10_000),
			});
		} catch {
			throw unreachable(url);
		}
	};
	let response = await mint("/api/auth/websocket-ticket/rpc");
	// Servers before ticket uses only serve the unbound path.
	if (response.status === 404) response = await mint("/api/auth/websocket-ticket");
	if (response.status === 401) throw new PairingError(t("pairing.ended"), "repair");
	if (!response.ok) throw new Error(t("pairing.cannotOpen", { status: response.status }));
	const { ticket } = (await response.json()) as { ticket: string };
	return `${wsBase(url)}/ws?orchestrationProtocol=${PROTOCOL_VERSION}&wsTicket=${encodeURIComponent(ticket)}`;
}

const LOCAL_PORTS = Array.from({ length: 10 }, (_, i) => 3773 + i);

/**
 * Finds T3 Code on this computer. The desktop app serves on 3773, or the next free port when taken;
 * 127.0.0.1 because it may listen on IPv4 only.
 */
export async function findLocalEnvironment(fetchFn: typeof fetch): Promise<{ url: string; environmentId: string } | undefined> {
	for (const port of LOCAL_PORTS) {
		const url = `http://127.0.0.1:${port}`;
		try {
			const response = await fetchFn(`${url}/.well-known/t3/environment`, { signal: AbortSignal.timeout(500) });
			const body = (await response.json()) as { environmentId?: unknown };
			// Any version counts: an incompatible one should show up with its error, not vanish.
			if (response.ok && typeof body.environmentId === "string") return { url, environmentId: body.environmentId };
		} catch {
			// Nothing on this port, keep looking.
		}
	}
	return undefined;
}
