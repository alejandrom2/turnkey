import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { randomBytes } from "node:crypto";

import { type AccessLevel, approveWithPairingCode, type AuthStore, DeckOAuthProvider, listenForCallback, SignInRequired } from "./oauth.js";
import { type ToolCaller, ToolError } from "./t3.js";

export type ConnectionState =
	| { kind: "signed-out" }
	| { kind: "connecting" }
	| { kind: "approving" }
	| { kind: "ready"; environmentId: string; label: string; canOperate: boolean }
	| { kind: "error"; message: string };

const OPERATE_SCOPE = "orchestration:operate";

/** `…/mcp` is what Settings → Environments → Copy MCP URL gives; accept the bare origin too. */
export function normalizeEnvironmentUrl(raw: string): string | undefined {
	try {
		const url = new URL(raw.trim());
		if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
		url.hash = "";
		url.search = "";
		const path = url.pathname.replace(/\/+$/, "");
		url.pathname = path.endsWith("/mcp") ? path : `${path}/mcp`;
		return url.href;
	} catch {
		return undefined;
	}
}

const LOCAL_PORTS = Array.from({ length: 10 }, (_, i) => 3773 + i);

/**
 * Finds T3 Code on this computer. The desktop app serves on 3773, or the next free port when taken;
 * 127.0.0.1 because it may listen on IPv4 only.
 */
export async function findLocalEnvironment(fetchFn: typeof fetch = fetch): Promise<string | undefined> {
	for (const port of LOCAL_PORTS) {
		const url = `http://127.0.0.1:${port}/mcp`;
		try {
			const response = await fetchFn(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`, { signal: AbortSignal.timeout(500) });
			if (response.ok && ((await response.json()) as { resource_name?: string }).resource_name === "T3 Code") return url;
		} catch {
			// Nothing on this port, keep looking.
		}
	}
	return undefined;
}

/** One T3 Code environment reached through its `/mcp` endpoint. */
export class T3Connection implements ToolCaller {
	state: ConnectionState = { kind: "signed-out" };
	readonly #provider: DeckOAuthProvider;
	#client: Client | undefined;
	#connecting: Promise<void> | undefined;
	#signingIn: Promise<void> | undefined;

	constructor(
		readonly url: string,
		store: AuthStore,
		private readonly onChange: () => void,
	) {
		this.#provider = new DeckOAuthProvider(url, store);
	}

	/** Connects with saved credentials; without any it stays signed out. */
	connect(): Promise<void> {
		if (this.#provider.tokens() === undefined) {
			this.#set({ kind: "signed-out" });
			return Promise.resolve();
		}
		this.#connecting ??= this.#open().finally(() => (this.#connecting = undefined));
		return this.#connecting;
	}

	/** One flow at a time: a second press while the browser page is open joins the first. */
	signIn(openBrowser: (url: string) => Promise<void>): Promise<void> {
		this.#signingIn ??= this.#signIn(openBrowser).finally(() => (this.#signingIn = undefined));
		return this.#signingIn;
	}

	async #signIn(openBrowser: (url: string) => Promise<void>): Promise<void> {
		const callback = await listenForCallback();
		this.#provider.beginInteractive(callback.redirect, callback.state, openBrowser);
		try {
			this.#set({ kind: "approving" });
			if ((await auth(this.#provider, { serverUrl: this.url })) === "REDIRECT") {
				await auth(this.#provider, { serverUrl: this.url, authorizationCode: await callback.code });
			}
		} catch (error) {
			this.#set({ kind: "error", message: messageOf(error) });
			throw error;
		} finally {
			callback.close();
			this.#provider.endInteractive();
		}
		await this.close();
		await this.connect();
	}

	/** Signs in with a pairing code from a pasted pair link; no browser involved. */
	async pair(code: string, access: AccessLevel, fetchFn: typeof fetch = fetch): Promise<void> {
		const state = randomBytes(16).toString("base64url");
		let authorizationUrl: URL | undefined;
		this.#provider.beginInteractive(this.#provider.redirectUrl, state, async (url) => {
			authorizationUrl = new URL(url);
		});
		try {
			this.#set({ kind: "connecting" });
			await this.#provider.invalidateCredentials("tokens");
			if ((await auth(this.#provider, { serverUrl: this.url, fetchFn })) === "REDIRECT") {
				if (authorizationUrl === undefined) throw new Error("T3 Code did not start a sign-in.");
				const authorizationCode = await approveWithPairingCode(authorizationUrl, { code, access, state }, fetchFn);
				await auth(this.#provider, { serverUrl: this.url, authorizationCode, fetchFn });
			}
		} catch (error) {
			this.#set({ kind: "error", message: messageOf(error) });
			throw error;
		} finally {
			this.#provider.endInteractive();
		}
		await this.close();
		await this.connect();
	}

	async signOut(): Promise<void> {
		await this.close();
		await this.#provider.invalidateCredentials("all");
		this.#set({ kind: "signed-out" });
	}

	async close(): Promise<void> {
		const client = this.#client;
		this.#client = undefined;
		await client?.close().catch(() => undefined);
	}

	async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
		const client = this.#client;
		if (client === undefined) throw new ToolError(name, "not_connected", "Not connected.");
		let result;
		try {
			result = await client.callTool({ name, arguments: args });
		} catch (error) {
			if (isAuthFailure(error)) {
				await this.close();
				this.#set({ kind: "signed-out" });
			}
			throw error;
		}
		const payload = parsePayload(result);
		if (result.isError === true) {
			const failure = (payload ?? {}) as { code?: string; message?: string };
			throw new ToolError(name, failure.code ?? "tool_error", failure.message ?? textOf(result) ?? "Tool failed.");
		}
		return payload as T;
	}

	async #open(): Promise<void> {
		this.#set({ kind: "connecting" });
		const client = new Client({ name: "t3-deck", version: "0.1.0" });
		try {
			await client.connect(new StreamableHTTPClientTransport(new URL(this.url), { authProvider: this.#provider }));
			this.#client = client;
			const environment = await this.call<{ environmentId: string; label: string }>("t3_environment_read", {});
			const scope = this.#provider.tokens()?.scope?.split(" ") ?? [];
			this.#set({ kind: "ready", environmentId: environment.environmentId, label: environment.label, canOperate: scope.includes(OPERATE_SCOPE) });
		} catch (error) {
			await this.close();
			this.#set(isAuthFailure(error) ? { kind: "signed-out" } : { kind: "error", message: messageOf(error) });
		}
	}

	#set(state: ConnectionState): void {
		this.state = state;
		this.onChange();
	}
}

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

function textOf(result: CallResult): string | undefined {
	const content = Array.isArray(result.content) ? result.content : [];
	const first = content.find((item): item is { type: "text"; text: string } => item?.type === "text");
	return first?.text;
}

function parsePayload(result: CallResult): unknown {
	if (result.structuredContent !== undefined) return result.structuredContent;
	const text = textOf(result);
	if (text === undefined) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

const isAuthFailure = (error: unknown): boolean => error instanceof UnauthorizedError || error instanceof SignInRequired;
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
