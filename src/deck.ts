import streamDeck from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { ThreadBoard } from "./core/board.js";
import { type CredentialStore, Machine } from "./core/t3/machine.js";
import { type Credential, findLocalEnvironment, normalizeEnvironmentUrl, PairingError, parsePairingLink, preferLoopback } from "./core/t3/pairing.js";
import type { SocketLike } from "./core/t3/rpc.js";

/**
 * `environments` lists machines added from pair links; this machine is found on its own.
 * `scheme` is edited in the property inspector; `environments` and `auth` are written only by the plugin.
 * Global settings are the SDK's recommended home for user tokens; action settings ship in profile exports.
 */
type GlobalSettings = {
	environments?: string;
	scheme?: string;
	auth?: Record<string, JsonValue>;
};

const logger = streamDeck.logger.createScope("deck");

const isLoopbackUrl = (url: string) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);

const parseList = (raw: string | undefined): string[] => [
	...new Set(
		(raw ?? "")
			.split(/\s+/)
			.filter(Boolean)
			.map(normalizeEnvironmentUrl)
			.filter((url): url is string => url !== undefined),
	),
];

/** Keeps client-API credentials only: sign-ins from the MCP era have no `token` and cannot be reused. */
function readCredentials(raw: Record<string, unknown> | undefined): Record<string, Credential> {
	const credentials: Record<string, Credential> = {};
	for (const [key, value] of Object.entries(raw ?? {})) {
		const url = normalizeEnvironmentUrl(key);
		const candidate = value as Partial<Credential> | null;
		if (url === undefined || typeof candidate?.token !== "string" || typeof candidate.environmentId !== "string") continue;
		credentials[url] = {
			token: candidate.token,
			expiresAt: Number(candidate.expiresAt) || 0,
			scopes: Array.isArray(candidate.scopes) ? candidate.scopes : [],
			label: candidate.label ?? "",
			environmentId: candidate.environmentId,
		};
	}
	return credentials;
}

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

function environmentStatus(machine: Machine): EnvironmentStatus {
	const { url, state } = machine;
	const parsed = new URL(url);
	const local = isLoopbackUrl(url);
	const where = local ? "This machine" : parsed.host;
	const label = state.kind === "ready" ? state.label : machine.credential?.label;
	const base = { url, local, where, name: label || (local ? "T3 Code" : parsed.hostname) };
	switch (state.kind) {
		case "ready":
			return { ...base, state: "ready", access: state.canOperate ? "Can act" : "Read only" };
		case "error":
			return { ...base, state: "error", message: state.message };
		case "signed-out":
			return { ...base, state: "signed-out", message: state.message };
		default:
			return { ...base, state: "connecting" };
	}
}

class Deck implements CredentialStore {
	readonly board = new ThreadBoard(() => this.machines);
	readonly #machines = new Map<string, Machine>();
	readonly #visible = new Set<string>();
	readonly #painters = new Set<() => void>();
	#settings: GlobalSettings = {};
	#auth: Record<string, Credential> = {};
	#authLoaded = false;
	#clock: ReturnType<typeof setInterval> | undefined;
	#statusSent: string | undefined;
	#machineStates = "";
	#pairing: PairingStatus = { state: "idle" };

	async init(): Promise<void> {
		streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => void this.#apply(ev.settings));
		streamDeck.ui.onDidAppear(() => void this.pushStatus(true));
		streamDeck.system.onSystemDidWakeUp(() => void this.retry());
		this.board.subscribe(() => this.repaint());
		await this.#apply(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
	}

	get machines(): Machine[] {
		return [...this.#machines.values()];
	}

	get scheme(): string {
		return this.#settings.scheme?.trim() || "t3code";
	}

	load(url: string): Credential | undefined {
		return this.#auth[url];
	}

	async save(url: string, credential: Credential | undefined): Promise<void> {
		const { [url]: _previous, ...rest } = this.#auth;
		this.#auth = credential === undefined ? rest : { ...rest, [url]: credential };
		await this.#persist();
	}

	/** Adds the machine a T3 Code pair link points at and redeems its one-time code. */
	async pair(link: string): Promise<void> {
		const parsed = parsePairingLink(link);
		if (parsed === undefined) return this.#setPairing({ state: "error", message: "That doesn't look like a T3 Code pair link. Copy it from Settings → Sharing & access." });
		const url = preferLoopback(parsed.url);
		this.#setPairing({ state: "working" });
		const existing = this.#machines.get(url);
		const machine = existing ?? this.#create(url);
		try {
			await machine.pair(parsed.code);
			if (!isLoopbackUrl(url) && !parseList(this.#settings.environments).includes(url)) {
				this.#settings = { ...this.#settings, environments: [...parseList(this.#settings.environments), url].join("\n") };
				await this.#persist();
			}
			this.#setPairing({ state: "idle" });
		} catch (error) {
			if (existing === undefined) {
				machine.stop();
				this.#machines.delete(url);
			}
			if (!(error instanceof PairingError)) logger.warn(`Pairing with ${new URL(url).host} failed`, error instanceof Error ? error.message : error);
			this.#setPairing({ state: "error", message: error instanceof Error ? error.message : String(error) });
		}
		this.#changed();
	}

	/** Forgets a machine added from a pair link, and its token. */
	async remove(url: string): Promise<void> {
		await this.#machines.get(url)?.signOut();
		this.#settings = { ...this.#settings, environments: parseList(this.#settings.environments).filter((listed) => listed !== url).join("\n") };
		await this.#persist();
		await this.#apply(this.#settings);
	}

	async signOut(url: string): Promise<void> {
		await this.#machines.get(url)?.signOut();
	}

	/** Looks for this machine again and reconnects now: after a wake, a retry press or a key press while offline. */
	async retry(url?: string): Promise<void> {
		await this.#apply(this.#settings);
		for (const machine of this.machines) if (url === undefined || machine.url === url) machine.wake();
	}

	#setPairing(pairing: PairingStatus): void {
		this.#pairing = pairing;
		void this.pushStatus();
	}

	/** Actions call this from onWillAppear/onWillDisappear; it only drives the elapsed-time clock now. */
	setVisible(id: string, visible: boolean): void {
		if (visible) this.#visible.add(id);
		else this.#visible.delete(id);
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
			environments: this.machines.map(environmentStatus),
			selected: normalizeEnvironmentUrl(settings.machine ?? "") ?? "",
			pairing: this.#pairing,
		};
		const signature = JSON.stringify(status);
		if (!force && signature === this.#statusSent) return;
		this.#statusSent = signature;
		await streamDeck.ui.sendToPropertyInspector(status);
	}

	/** Elapsed timers need a once-a-second repaint, but only while a visible turn is running. */
	#syncClock(): void {
		const needed = this.#visible.size > 0 && this.board.threads.some((thread) => thread.active);
		if (needed && this.#clock === undefined) this.#clock = setInterval(() => this.repaint(), 1000);
		if (!needed && this.#clock !== undefined) {
			clearInterval(this.#clock);
			this.#clock = undefined;
		}
	}

	/** Machine updates arrive per streamed row; repaint only when a connection state or a shown field changed. */
	#changed(): void {
		this.board.update();
		const states = JSON.stringify(this.machines.map((machine) => [machine.url, machine.state]));
		if (states === this.#machineStates) return;
		this.#machineStates = states;
		this.repaint();
	}

	#create(url: string): Machine {
		// Node's WebSocket types its handlers with DOM events; the client only reads `data` from them.
		const socket = (socketUrl: string) => new WebSocket(socketUrl) as unknown as SocketLike;
		const machine = new Machine(url, this, { fetch, socket }, () => this.#changed());
		this.#machines.set(url, machine);
		return machine;
	}

	async #apply(settings: GlobalSettings): Promise<void> {
		this.#settings = settings;
		// The inspector writes from its own copy of global settings; keep our tokens authoritative.
		if (!this.#authLoaded) {
			this.#authLoaded = true;
			this.#auth = readCredentials(settings.auth);
			if (JSON.stringify(settings.auth ?? {}) !== JSON.stringify(this.#auth)) await this.#persist();
		} else if (JSON.stringify(settings.auth ?? {}) !== JSON.stringify(this.#auth)) await this.#persist();

		// This machine joins the list whenever T3 Code runs here, and stays once paired; a retry or a wake looks again.
		const localReady = this.machines.some((machine) => isLoopbackUrl(machine.url) && machine.state.kind === "ready");
		const local = localReady ? undefined : await findLocalEnvironment(fetch);
		if (local !== undefined) await this.#followLocal(local.url, local.environmentId);
		const wanted = new Set([
			...parseList(settings.environments),
			...Object.keys(this.#auth).filter(isLoopbackUrl),
			...this.machines.filter((machine) => localReady && isLoopbackUrl(machine.url)).map((machine) => machine.url),
			...(local === undefined ? [] : [local.url]),
		]);
		for (const [url, machine] of this.#machines) {
			if (wanted.has(url)) continue;
			this.#machines.delete(url);
			machine.stop();
		}
		for (const url of wanted) if (!this.#machines.has(url)) this.#create(url).start();
		this.#changed();
	}

	/** T3 Code moves to the next free port when 3773 is taken; keep its pairing when it does. */
	async #followLocal(url: string, environmentId: string): Promise<void> {
		if (this.#auth[url] !== undefined) return;
		const moved = Object.entries(this.#auth).find(([other, credential]) => other !== url && isLoopbackUrl(other) && credential.environmentId === environmentId);
		if (moved === undefined) return;
		const [from, credential] = moved;
		this.#machines.get(from)?.stop();
		this.#machines.delete(from);
		await this.save(from, undefined);
		await this.save(url, credential);
	}

	#persist(): Promise<void> {
		return streamDeck.settings.setGlobalSettings<GlobalSettings>({ ...this.#settings, auth: this.#auth });
	}
}

export const deck = new Deck();
