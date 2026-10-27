import { networkInterfaces } from "node:os";

import streamDeck from "@elgato/streamdeck";

import { ThreadBoard } from "./core/board.js";
import { findLocalEnvironment, normalizeEnvironmentUrl, T3Connection } from "./core/connection.js";
import { type AccessLevel, type AuthStore, parsePairingLink, type StoredAuth } from "./core/oauth.js";
import { isActive } from "./core/t3.js";

/**
 * `environments` lists machines added from pair links; this machine is found on its own.
 * `scheme` is edited in the property inspector; `environments` and `auth` are written only by the plugin.
 * Global settings are the SDK's recommended home for user OAuth tokens; action settings ship in profile exports.
 */
type GlobalSettings = {
	environments?: string;
	scheme?: string;
	auth?: Record<string, StoredAuth>;
};

const logger = streamDeck.logger.createScope("deck");

const isLoopback = (hostname: string) => hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";

/** A pair link made on this computer names its LAN address; talk to it over loopback instead. */
function isThisComputer(hostname: string): boolean {
	if (isLoopback(hostname)) return true;
	return Object.values(networkInterfaces())
		.flat()
		.some((address) => address?.address === hostname.replace(/^\[|\]$/g, ""));
}

const parseList = (raw: string | undefined): string[] =>
	(raw ?? "")
		.split(/\s+/)
		.map(normalizeEnvironmentUrl)
		.filter((url): url is string => url !== undefined);

type PairingStatus = { state: "idle" } | { state: "working" } | { state: "error"; message: string };

/** What the property inspector shows per environment, mirroring T3 Code's environment rows. */
type EnvironmentStatus = {
	url: string;
	name: string;
	where: string;
	local: boolean;
	state: "ready" | "connecting" | "approving" | "signed-out" | "error";
	access?: "Read only" | "Can act";
	message?: string;
};

function environmentStatus({ url, state }: T3Connection): EnvironmentStatus {
	const parsed = new URL(url);
	const local = isLoopback(parsed.hostname);
	const where = local ? "This machine" : parsed.host;
	const base = { url, local, where, name: state.kind === "ready" && state.label ? state.label : local ? "T3 Code" : parsed.hostname };
	switch (state.kind) {
		case "ready":
			return { ...base, state: "ready", access: state.canOperate ? "Can act" : "Read only" };
		case "error":
			return { ...base, state: "error", message: state.message };
		default:
			return { ...base, state: state.kind };
	}
}

class Deck implements AuthStore {
	readonly board = new ThreadBoard(() => [...this.#connections.values()]);
	readonly #connections = new Map<string, T3Connection>();
	readonly #visible = new Set<string>();
	readonly #painters = new Set<() => void>();
	#settings: GlobalSettings = {};
	#auth: Record<string, StoredAuth> = {};
	#clock: ReturnType<typeof setInterval> | undefined;
	#statusSent: string | undefined;
	#pairing: PairingStatus = { state: "idle" };

	async init(): Promise<void> {
		streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => void this.#apply(ev.settings));
		streamDeck.ui.onDidAppear(() => void this.pushStatus(true));
		streamDeck.system.onSystemDidWakeUp(() => void this.reconnect());
		this.board.subscribe(() => this.repaint());
		await this.#apply(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
	}

	get connections(): T3Connection[] {
		return [...this.#connections.values()];
	}

	get scheme(): string {
		return this.#settings.scheme?.trim() || "t3code";
	}

	/** True when any connected environment granted more than read-only. */
	get canOperate(): boolean {
		return this.connections.some((connection) => connection.state.kind === "ready" && connection.state.canOperate);
	}

	get needsSignIn(): boolean {
		return this.#connections.size > 0 && this.connections.every((connection) => connection.state.kind !== "ready");
	}

	load(environmentUrl: string): StoredAuth {
		return this.#auth[environmentUrl] ?? {};
	}

	async save(environmentUrl: string, auth: StoredAuth): Promise<void> {
		this.#auth = { ...this.#auth, [environmentUrl]: auth };
		await this.#persist();
	}

	/** Signs in to `url`, or to every environment that is not connected yet. */
	async signIn(url?: string): Promise<void> {
		if (this.#connections.size === 0) await this.#apply(this.#settings);
		for (const connection of this.connections) {
			if (connection.state.kind === "ready" || (url !== undefined && connection.url !== url)) continue;
			try {
				await connection.signIn((url) => streamDeck.system.openUrl(url));
			} catch (error) {
				logger.warn(`Sign-in to ${connection.url} failed`, error);
			}
		}
		void this.board.refresh(true);
	}

	/** Adds the machine a T3 Code pair link points at and signs in with its one-time code. */
	async pair(link: string, access: AccessLevel): Promise<void> {
		const parsed = parsePairingLink(link);
		if (parsed === undefined) return this.#setPairing({ state: "error", message: "That doesn't look like a T3 Code pair link. Copy it from Settings → Sharing & access." });
		const target = new URL(parsed.environmentUrl);
		const url = isThisComputer(target.hostname) ? `http://127.0.0.1:${target.port || "80"}/mcp` : parsed.environmentUrl;
		this.#setPairing({ state: "working" });
		if (!isLoopback(new URL(url).hostname) && !parseList(this.#settings.environments).includes(url)) {
			this.#settings = { ...this.#settings, environments: [...parseList(this.#settings.environments), url].join("\n") };
			await this.#persist();
		}
		await this.#apply(this.#settings, url);
		const connection = this.#connections.get(url);
		try {
			if (connection === undefined) throw new Error("Could not add that machine.");
			await connection.pair(parsed.code, access);
			this.#setPairing({ state: "idle" });
		} catch (error) {
			this.#setPairing({ state: "error", message: error instanceof Error ? error.message : String(error) });
		}
		void this.board.refresh(true);
	}

	/** Forgets a machine added from a pair link, and its sign-in. */
	async remove(url: string): Promise<void> {
		await this.#connections.get(url)?.signOut();
		const { [url]: _removed, ...auth } = this.#auth;
		this.#auth = auth;
		this.#settings = { ...this.#settings, environments: parseList(this.#settings.environments).filter((listed) => listed !== url).join("\n") };
		await this.#persist();
		await this.#apply(this.#settings);
		void this.board.refresh(true);
	}

	#setPairing(pairing: PairingStatus): void {
		this.#pairing = pairing;
		void this.pushStatus();
	}

	async signOut(url: string): Promise<void> {
		await this.#connections.get(url)?.signOut();
		void this.board.refresh(true);
	}

	async reconnect(): Promise<void> {
		if (this.#connections.size === 0) await this.#apply(this.#settings);
		await Promise.all(this.connections.map((connection) => connection.connect()));
		void this.board.refresh(true);
	}

	/** Actions call this from onWillAppear/onWillDisappear so polling runs only while the deck shows us. */
	setVisible(id: string, visible: boolean): void {
		if (visible) this.#visible.add(id);
		else this.#visible.delete(id);
		if (this.#visible.size > 0) this.board.start();
		else this.board.stop();
		this.#syncClock();
	}

	onRepaint(paint: () => void): void {
		this.#painters.add(paint);
	}

	repaint(): void {
		for (const paint of this.#painters) paint();
		this.#syncClock();
		void this.pushStatus();
	}

	/** Connection status for the open property inspector; sent only when it changes unless `force`d. */
	async pushStatus(force = false): Promise<void> {
		if (streamDeck.ui.action === undefined) return;
		const settings = (await streamDeck.ui.action.getSettings()) as { machine?: string };
		const status = {
			event: "status",
			environments: this.connections.map(environmentStatus),
			selected: settings.machine ?? "",
			pairing: this.#pairing,
		};
		const signature = JSON.stringify(status);
		if (!force && signature === this.#statusSent) return;
		this.#statusSent = signature;
		await streamDeck.ui.sendToPropertyInspector(status);
	}

	/** Elapsed timers need a once-a-second repaint, but only while a visible turn is running. */
	#syncClock(): void {
		const needed = this.#visible.size > 0 && this.board.threads.some((thread) => isActive(thread.status));
		if (needed && this.#clock === undefined) this.#clock = setInterval(() => this.repaint(), 1000);
		if (!needed && this.#clock !== undefined) {
			clearInterval(this.#clock);
			this.#clock = undefined;
		}
	}

	/** `keep` holds on to a machine being paired even if the local probe does not see it yet. */
	async #apply(settings: GlobalSettings, keep?: string): Promise<void> {
		this.#settings = settings;
		// The inspector writes from its own copy of global settings; keep our tokens authoritative.
		if (Object.keys(this.#auth).length === 0) this.#auth = settings.auth ?? {};
		else if (JSON.stringify(settings.auth ?? {}) !== JSON.stringify(this.#auth)) await this.#persist();

		const wanted = new Set(parseList(settings.environments));
		if (keep !== undefined) wanted.add(keep);
		// This machine joins the list whenever T3 Code runs here; Sign in and wake look again.
		if (![...wanted].some((url) => isLoopback(new URL(url).hostname))) {
			const local = await findLocalEnvironment();
			if (local !== undefined) wanted.add(local);
		}
		for (const [url, connection] of this.#connections) {
			if (wanted.has(url)) continue;
			this.#connections.delete(url);
			await connection.close();
		}
		for (const url of wanted) {
			if (this.#connections.has(url)) continue;
			const connection = new T3Connection(url, this, () => this.repaint());
			this.#connections.set(url, connection);
			void connection.connect().then(() => this.board.refresh(true));
		}
		this.repaint();
	}

	#persist(): Promise<void> {
		return streamDeck.settings.setGlobalSettings<GlobalSettings>({ ...this.#settings, auth: this.#auth });
	}
}

export const deck = new Deck();
