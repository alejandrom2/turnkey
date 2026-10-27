import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

import { describeAuthorizationError, renderCallbackPage } from "./callbackPage.js";

export type StoredAuth = {
	client?: OAuthClientInformationMixed;
	tokens?: OAuthTokens;
	verifier?: string;
};

export interface AuthStore {
	load(environmentUrl: string): StoredAuth;
	save(environmentUrl: string, auth: StoredAuth): Promise<void>;
}

const CALLBACK_PATH = "/t3-deck/callback";
// T3 matches loopback redirects without the port (RFC 8252 §7.3), so one registration serves every listener port.
const REGISTERED_REDIRECT = `http://127.0.0.1${CALLBACK_PATH}`;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/**
 * Persists OAuth state per environment. It only opens a browser while `beginInteractive` is armed,
 * so a background reconnect with an expired token reports signed-out instead of popping a tab.
 */
export class DeckOAuthProvider implements OAuthClientProvider {
	#redirect: string = REGISTERED_REDIRECT;
	#state: string | undefined;
	#openBrowser: ((url: string) => Promise<void>) | undefined;

	constructor(
		private readonly environmentUrl: string,
		private readonly store: AuthStore,
	) {}

	get redirectUrl(): string {
		return this.#redirect;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: "T3 Deck (Stream Deck)",
			redirect_uris: [REGISTERED_REDIRECT],
			grant_types: ["authorization_code"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		};
	}

	beginInteractive(redirect: string, state: string, openBrowser: (url: string) => Promise<void>): void {
		this.#redirect = redirect;
		this.#state = state;
		this.#openBrowser = openBrowser;
	}

	endInteractive(): void {
		this.#redirect = REGISTERED_REDIRECT;
		this.#state = undefined;
		this.#openBrowser = undefined;
	}

	state(): string {
		return this.#state ?? randomBytes(16).toString("base64url");
	}

	clientInformation(): OAuthClientInformationMixed | undefined {
		return this.store.load(this.environmentUrl).client;
	}

	saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
		return this.#update({ client });
	}

	tokens(): OAuthTokens | undefined {
		return this.store.load(this.environmentUrl).tokens;
	}

	saveTokens(tokens: OAuthTokens): Promise<void> {
		return this.#update({ tokens, verifier: undefined });
	}

	async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
		if (this.#openBrowser === undefined) throw new SignInRequired();
		await this.#openBrowser(authorizationUrl.href);
	}

	saveCodeVerifier(verifier: string): Promise<void> {
		return this.#update({ verifier });
	}

	codeVerifier(): string {
		const verifier = this.store.load(this.environmentUrl).verifier;
		if (verifier === undefined) throw new Error("No PKCE verifier saved for this sign-in.");
		return verifier;
	}

	invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
		if (scope === "discovery") return Promise.resolve();
		const current = this.store.load(this.environmentUrl);
		const next: StoredAuth =
			scope === "all"
				? {}
				: scope === "client"
					? { ...current, client: undefined }
					: scope === "tokens"
						? { ...current, tokens: undefined }
						: { ...current, verifier: undefined };
		return this.store.save(this.environmentUrl, next);
	}

	#update(patch: Partial<StoredAuth>): Promise<void> {
		return this.store.save(this.environmentUrl, { ...this.store.load(this.environmentUrl), ...patch });
	}
}

export class SignInRequired extends Error {
	constructor() {
		super("Sign in to this T3 Code environment from the T3 Deck settings.");
	}
}

export type LoopbackCallback = {
	redirect: string;
	state: string;
	code: Promise<string>;
	close: () => void;
};

/** Listens on an ephemeral 127.0.0.1 port for exactly one authorization response. */
export async function listenForCallback(): Promise<LoopbackCallback> {
	const state = randomBytes(16).toString("base64url");
	let settle!: { resolve: (code: string) => void; reject: (error: Error) => void };
	const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));

	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== CALLBACK_PATH) {
			response.writeHead(404).end();
			return;
		}
		const error = url.searchParams.get("error");
		const received = url.searchParams.get("code");
		const ok = error === null && received !== null && url.searchParams.get("state") === state;
		const message = describeAuthorizationError(error);
		response
			.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
			.end(renderCallbackPage(ok ? { ok: true } : { ok: false, message }));
		if (ok) settle.resolve(received);
		else settle.reject(new Error(message));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	const timer = setTimeout(() => settle.reject(new Error("Sign-in timed out.")), SIGN_IN_TIMEOUT_MS);

	return {
		redirect: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
		state,
		code,
		close: () => {
			clearTimeout(timer);
			server.close();
		},
	};
}

/** T3 Code's MCP access levels, as its approval page offers them. */
export const ACCESS_LEVELS = ["read-only", "approval-required", "auto-accept-edits", "auto", "full-access"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export type PairingLink = { environmentUrl: string; code: string };

/**
 * Reads a T3 Code pair link the way T3 Code does (`resolveRemotePairingTarget` in packages/shared/src/remote.ts):
 * `http://host:3773/pair#token=CODE`, the older `?token=`, or a hosted `…/pair?host=…#token=CODE`.
 */
export function parsePairingLink(raw: string): PairingLink | undefined {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
	const code = (new URLSearchParams(url.hash.slice(1)).get("token") ?? url.searchParams.get("token") ?? "").trim();
	if (code === "") return undefined;
	const hostParam = url.searchParams.get("host")?.trim();
	let base: URL;
	try {
		base = hostParam ? new URL(/^https?:\/\//.test(hostParam) ? hostParam : `https://${hostParam}`) : url;
	} catch {
		return undefined;
	}
	return { environmentUrl: `${base.origin}/mcp`, code };
}

const AUTHORIZATION_KEYS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "resource"];

/**
 * Approves an authorization request with a one-time pairing code: the same call T3 Code's approval page
 * makes once its user types a code (`POST /oauth/mcp/decision`). Returns the authorization code.
 */
export async function approveWithPairingCode(
	authorizationUrl: URL,
	input: { code: string; access: AccessLevel; state: string },
	fetchFn: typeof fetch = fetch,
): Promise<string> {
	const params = authorizationUrl.searchParams;
	const authorization = Object.fromEntries(AUTHORIZATION_KEYS.flatMap((key) => (params.has(key) ? [[key, params.get(key)!]] : [])));
	const response = await fetchFn(new URL("/oauth/mcp/decision", authorizationUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ authorization, decision: { _tag: "pairing-code", access: input.access, code: input.code } }),
	});
	const body = (await response.json().catch(() => ({}))) as { message?: string; redirectTo?: string };
	if (!response.ok || body.redirectTo === undefined) throw new Error(body.message ?? `T3 Code refused the pairing code (${response.status}).`);
	const redirect = new URL(body.redirectTo);
	if (redirect.searchParams.get("state") !== input.state) throw new Error("The sign-in response did not match this request.");
	const error = redirect.searchParams.get("error");
	if (error !== null) throw new Error(redirect.searchParams.get("error_description") ?? `Sign-in failed: ${error}.`);
	const code = redirect.searchParams.get("code");
	if (code === null) throw new Error("T3 Code did not return a sign-in code.");
	return code;
}
