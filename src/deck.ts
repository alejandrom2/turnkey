import streamDeck, { type Action } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { ThreadBoard } from "./core/board.js";
import { openExternal } from "./core/commands.js";
import { QueueStore } from "./core/queues.js";
import { dropScopeRequest, optInStatus, type OptInStatus, readScopeRequests, requestScope, type ScopeRequests, settleScopeRequests } from "./core/scopes.js";
import { VERBOSE_MS, verboseOn } from "./core/diagnostics.js";
import { t } from "./core/i18n.js";
import { AcpIcons } from "./core/models.js";
import { Animator, motionMode, nextMinute, Transitions } from "./core/motion.js";
import { UltrathinkArming } from "./core/ultrathink.js";
import { type CredentialStore, Machine } from "./core/t3/machine.js";
import { type Credential, findLocalEnvironment, isLoopbackUrl, normalizeEnvironmentUrl, type OptInScope, PairingError, parsePairingLink, preferLoopback } from "./core/t3/pairing.js";
import type { SocketLike } from "./core/t3/rpc.js";

/**
 * `environments` lists machines added from pair links; this machine is found on its own.
 * `scheme` and the strip appearance are edited in the property inspector; `environments` and `auth` are written only by the plugin.
 * Global settings are the SDK's recommended home for user tokens; action settings ship in profile exports.
 */
type GlobalSettings = {
	environments?: string;
	scheme?: string;
	stripBackground?: string;
	stripColor?: string;
	stripHairline?: boolean;
	stripStyle?: string;
	textScroll?: string;
	/** Full (default), Reduced or Off. */
	motion?: string;
	/** "on" lets a small robot walk the dial strips while the deck sits idle; off by default. */
	idlePet?: string;
	/** Confirm before sending: review (default), hold or off; actions can override it. */
	confirmSend?: string;
	/** How a model's top effort level stands out: gradient (default), solid, model or off. */
	maxEffort?: string;
	auth?: Record<string, JsonValue>;
	/** Per machine, broader scopes its next pairing asks for (`ScopeRequests`); written only by the plugin. */
	scopeRequests?: Record<string, JsonValue>;
	/** When verbose logging turns itself off, in ms; written only by the plugin, so a stale inspector can't restart it. */
	verboseUntil?: number;
};

const appearanceOf = ({ stripBackground, stripColor, stripHairline, stripStyle, textScroll, motion, idlePet, confirmSend, maxEffort }: GlobalSettings) => ({
	stripBackground,
	stripColor,
	stripHairline,
	stripStyle,
	textScroll,
	motion,
	idlePet,
	confirmSend,
	maxEffort,
});

const logger = streamDeck.logger.createScope("deck");

/** A URL scheme as RFC 3986 spells one: anything else in the setting could turn the app link into another command. */
const SCHEME = /^[a-z][a-z0-9+.-]*$/i;

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
	/** A wire value the inspector maps to its own words. */
	access?: "Read only" | "Can act";
	message?: string;
	/** Broader scopes this machine holds or asks for at its next pairing. */
	optIn: OptInStatus[];
};

function environmentStatus(machine: Machine, requests: ScopeRequests): EnvironmentStatus {
	const { url, state } = machine;
	const parsed = new URL(url);
	const local = isLoopbackUrl(url);
	const where = local ? t("machine.thisMachine") : parsed.host;
	const label = state.kind === "ready" ? state.label : machine.credential?.label;
	const base = { url, local, where, name: label || (local ? "T3 Code" : parsed.hostname), optIn: optInStatus(machine.scopes, requests[url] ?? []) };
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
	readonly acpIcons = new AcpIcons(fetch, () => this.repaint());
	readonly ultrathink = new UltrathinkArming(() => this.repaint());
	readonly animator = new Animator();
	readonly transitions = new Transitions();
	/** Queues of the threads visible faces show, read only when one changes. */
	readonly queues = new QueueStore(() => this.repaint());
	readonly #machines = new Map<string, Machine>();
	readonly #visible = new Set<string>();
	readonly #painters = new Set<() => void>();
	#settings: GlobalSettings = {};
	#auth: Record<string, Credential> = {};
	#scopeRequests: ScopeRequests = {};
	#authLoaded = false;
	#verboseUntil: number | undefined;
	#verboseTimer: ReturnType<typeof setTimeout> | undefined;
	/** Each machine's last connection state, so debug logging notes changes only. */
	readonly #loggedStates = new Map<string, string>();
	#clock: ReturnType<typeof setTimeout> | undefined;
	#statusSent: string | undefined;
	#machineStates = "";
	#pairing: PairingStatus = { state: "idle" };
	/** Machines whose pair link is being redeemed: they count as wanted until it settles, though not saved yet. */
	readonly #pairingUrls = new Set<string>();
	/** Applies run one at a time, so a slow one can't finish last on settings that changed meanwhile. */
	#applying: Promise<void> = Promise.resolve();
	#changeQueued = false;
	/** The open inspector's action and the machine its settings pick, re-read only when forced or another action opens. */
	#inspected: { id: string; machine: string } | undefined;
	#checklist: ((action: Action<JsonObject>) => JsonValue | undefined) | undefined;

	async init(): Promise<void> {
		streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => void this.#apply(ev.settings));
		streamDeck.settings.onDidReceiveSettings<{ machine?: string }>((ev) => {
			if (this.#inspected?.id === ev.action.id) this.#inspected = { id: ev.action.id, machine: ev.payload.settings.machine ?? "" };
		});
		streamDeck.ui.onDidAppear(() => {
			void this.pushStatus(true);
			void this.refreshConfigs();
		});
		streamDeck.system.onSystemDidWakeUp(() => void this.retry());
		this.board.subscribe(() => {
			this.transitions.update(this.board.threads);
			this.queues.retain(this.board.threads.map((thread) => thread.key));
			this.repaint();
		});
		await this.#apply(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
	}

	/**
	 * Where to create a pair link for `url` (else this computer): this computer's T3 Code app, which comes to the front
	 * (its deep links don't reach settings yet), or another machine's Sharing & access page in the browser.
	 */
	async openPairPage(url?: string): Promise<void> {
		if (url === undefined || url === "" || isLoopbackUrl(url)) return openExternal(`${this.scheme}://settings/access`);
		await streamDeck.system.openUrl(new URL("/settings/access", url).toString());
	}

	/** Walks the idle pet once now; set by the dial strips, which own it. */
	previewPet: () => void = () => {};

	/** Global settings, and so the paired machines, have been read once. */
	get loaded(): boolean {
		return this.#authLoaded;
	}

	get machines(): Machine[] {
		return [...this.#machines.values()];
	}

	/** The global strip appearance settings, resolved per dial with its own override. */
	get appearance(): ReturnType<typeof appearanceOf> {
		return appearanceOf(this.#settings);
	}

	/** The global settings as the plugin holds them, for the diagnostics export to pick from. */
	get globalSettings(): Readonly<Record<string, unknown>> {
		return this.#settings;
	}

	/** When verbose logging ends; undefined while it is off. */
	get verboseUntil(): number | undefined {
		return this.#verboseUntil;
	}

	/** Turns verbose logging on for 24 hours, or off now. */
	async setVerbose(on: boolean): Promise<void> {
		this.#verboseUntil = on ? Date.now() + VERBOSE_MS : undefined;
		this.#syncVerbose();
		await this.#persist();
		await this.pushStatus(true);
	}

	/**
	 * Debug while verbose logging is on, info otherwise; never "trace", which would log the tokens kept in global
	 * settings. A timer turns it off at its end, and a restart past the end finds it over.
	 */
	#syncVerbose(): void {
		clearTimeout(this.#verboseTimer);
		const now = Date.now();
		const on = verboseOn(this.#verboseUntil, now);
		streamDeck.logger.setLevel(on ? "debug" : "info");
		if (on) this.#verboseTimer = setTimeout(() => void this.setVerbose(false), Math.min(this.#verboseUntil! - now, 2 ** 31 - 1));
		else if (this.#verboseUntil !== undefined) {
			this.#verboseUntil = undefined;
			void this.#persist();
		}
	}

	get scheme(): string {
		const scheme = this.#settings.scheme?.trim() ?? "";
		return SCHEME.test(scheme) ? scheme : "t3code";
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
		if (parsed === undefined) return this.#setPairing({ state: "error", message: t("pairing.notALink") });
		const url = preferLoopback(parsed.url);
		this.#setPairing({ state: "working" });
		const existing = this.#machines.get(url);
		const machine = existing ?? this.#create(url);
		this.#pairingUrls.add(url);
		try {
			const credential = await machine.pair(parsed.code, this.#scopeRequests[url] ?? []);
			this.#scopeRequests = settleScopeRequests(this.#scopeRequests, url, credential.scopes);
			if (!isLoopbackUrl(url) && !parseList(this.#settings.environments).includes(url)) {
				this.#settings = { ...this.#settings, environments: [...parseList(this.#settings.environments), url].join("\n") };
				await this.#persist();
			}
			this.#setPairing({ state: "idle" });
		} catch (error) {
			if (existing === undefined) {
				machine.stop();
				if (this.#machines.get(url) === machine) {
					this.#machines.delete(url);
					this.#loggedStates.delete(url);
				}
			}
			if (!(error instanceof PairingError)) logger.warn(`Pairing with ${new URL(url).host} failed`, error instanceof Error ? error.message : error);
			this.#setPairing({ state: "error", message: error instanceof Error ? error.message : String(error) });
		} finally {
			this.#pairingUrls.delete(url);
		}
		this.#changed();
	}

	/** Forgets a machine added from a pair link, and its token. */
	async remove(url: string): Promise<void> {
		await this.#machines.get(url)?.signOut();
		this.#settings = { ...this.#settings, environments: parseList(this.#settings.environments).filter((listed) => listed !== url).join("\n") };
		await this.#persist();
		await this.#apply();
	}

	/** Flags broader scopes for the machine's next pairing, when the user turns on an action that needs them there. */
	async optInScope(url: string, ...scopes: OptInScope[]): Promise<void> {
		const next = scopes.reduce((requests, scope) => requestScope(requests, url, scope), this.#scopeRequests);
		if (next === this.#scopeRequests) return;
		this.#scopeRequests = next;
		await this.#persist();
		void this.pushStatus();
	}

	/** Un-flags a scope from the inspector's machine card: the next pairing won't ask for it. */
	async unflagScope(url: string, scope: string): Promise<void> {
		const next = dropScopeRequest(this.#scopeRequests, url, scope);
		if (next === this.#scopeRequests) return;
		this.#scopeRequests = next;
		await this.#persist();
		void this.pushStatus();
	}

	/** Whether the machine's next pairing will ask for `scope`. */
	scopeRequested(url: string, scope: OptInScope): boolean {
		return this.#scopeRequests[url]?.includes(scope) ?? false;
	}

	async signOut(url: string): Promise<void> {
		await this.#machines.get(url)?.signOut();
	}

	/** Looks for this machine again and reconnects now: after a wake, a retry press or a key press while offline. */
	async retry(url?: string): Promise<void> {
		await this.#apply();
		for (const machine of this.machines) if (url === undefined || machine.url === url) machine.wake();
	}

	/** Re-reads favorites and providers from every ready machine (or one), as an opening inspector needs them current. */
	async refreshConfigs(url?: string): Promise<void> {
		await Promise.all(this.machines.filter((machine) => url === undefined || machine.url === url).map((machine) => machine.refreshConfig()));
	}

	#setPairing(pairing: PairingStatus): void {
		this.#pairing = pairing;
		void this.pushStatus();
	}

	/** Actions call this from onWillAppear/onWillDisappear; it only drives the elapsed-time clock. */
	setVisible(id: string, visible: boolean): void {
		if (visible) this.#visible.add(id);
		else this.#visible.delete(id);
		this.#syncClock();
	}

	/** Builds the open inspector's "What this action needs" list, sent with the connection status. */
	useChecklist(checklist: (action: Action<JsonObject>) => JsonValue | undefined): void {
		this.#checklist = checklist;
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
		const action = streamDeck.ui.action;
		if (action === undefined) return;
		if (force || this.#inspected?.id !== action.id) {
			// The inspector can close mid-request; the app then never answers and the SDK rejects after a timeout.
			const settings = (await action.getSettings().catch(() => undefined)) as { machine?: string } | undefined;
			if (settings === undefined) return;
			this.#inspected = { id: action.id, machine: settings.machine ?? "" };
		}
		const status = {
			event: "status",
			environments: this.machines.map((machine) => environmentStatus(machine, this.#scopeRequests)),
			selected: normalizeEnvironmentUrl(this.#inspected.machine) ?? "",
			pairing: this.#pairing,
			verboseUntil: this.#verboseUntil ?? null,
			requirements: this.#checklist?.(action),
		};
		const signature = JSON.stringify(status);
		if (!force && signature === this.#statusSent) return;
		this.#statusSent = signature;
		await streamDeck.ui.sendToPropertyInspector(status);
	}

	/** Elapsed labels change once a minute per running turn: repaint at the soonest boundary, only while something shows. */
	#syncClock(): void {
		clearTimeout(this.#clock);
		this.#clock = undefined;
		// Thread keys show how long ago an idle thread last moved, too.
		const starts = this.#visible.size === 0 ? [] : this.board.threads.map((thread) => (thread.active ? (thread.activeSince ?? thread.updatedAt) : thread.updatedAt));
		const wait = nextMinute(starts, Date.now());
		if (wait !== undefined) this.#clock = setTimeout(() => this.repaint(), wait + 50);
	}

	/** Machine updates arrive in bursts; the board is rebuilt once per burst, and repainted only when a connection state, the config or a shown field changed. */
	#changed(): void {
		if (this.#changeQueued) return;
		this.#changeQueued = true;
		queueMicrotask(() => {
			this.#changeQueued = false;
			try {
				this.#update();
			} catch (error) {
				logger.warn(`Couldn't update the board: ${error instanceof Error ? error.message : String(error)}`);
			}
		});
	}

	#update(): void {
		this.board.update();
		const states = JSON.stringify(this.machines.map((machine) => [machine.url, machine.state, machine.configVersion, machine.tasksVersion, machine.terminalsVersion]));
		if (states === this.#machineStates) return;
		for (const machine of this.machines) {
			if (this.#loggedStates.get(machine.url) === machine.state.kind) continue;
			this.#loggedStates.set(machine.url, machine.state.kind);
			logger.debug(`${new URL(machine.url).host}: ${machine.state.kind}`);
		}
		this.#machineStates = states;
		this.repaint();
	}

	#create(url: string): Machine {
		// Node's WebSocket types its handlers with DOM events; the client only reads `data` from them.
		const socket = (socketUrl: string) => new WebSocket(socketUrl) as unknown as SocketLike;
		const machine = new Machine(url, this, { fetch, socket, warn: (message) => logger.warn(`${new URL(url).host}: ${message}`) }, () => this.#changed());
		this.#machines.set(url, machine);
		return machine;
	}

	/** Applies global settings from Stream Deck, or re-applies the current ones without `incoming`. */
	#apply(incoming?: GlobalSettings): Promise<void> {
		const persist = incoming !== undefined && this.#take(incoming);
		const run = this.#applying.then(async () => {
			if (persist) await this.#persist();
			await this.#sync();
		});
		this.#applying = run.catch((error: unknown) => void logger.warn(`Couldn't apply settings: ${error instanceof Error ? error.message : String(error)}`));
		return run;
	}

	/** Takes in settings from Stream Deck; true when the plugin's own copy has to be written back. */
	#take(incoming: GlobalSettings): boolean {
		let settings = incoming;
		// The Gradient option is gone; its users get T3 Code's background.
		const migrated = settings.stripBackground === "gradient";
		if (migrated) settings = { ...settings, stripBackground: "t3" };
		// The inspector writes from its own copy of global settings; the plugin's machines and tokens stay authoritative.
		if (this.#authLoaded) settings = { ...settings, environments: this.#settings.environments };
		const restyled = JSON.stringify(appearanceOf(settings)) !== JSON.stringify(appearanceOf(this.#settings));
		this.#settings = settings;
		this.animator.mode = motionMode(settings.motion);
		if (restyled) this.repaint();
		if (!this.#authLoaded) {
			this.#authLoaded = true;
			this.#auth = readCredentials(settings.auth);
			this.#scopeRequests = readScopeRequests(settings.scopeRequests);
			this.#verboseUntil = Number.isFinite(settings.verboseUntil) ? settings.verboseUntil : undefined;
			this.#syncVerbose();
		}
		return migrated || this.#stale(incoming);
	}

	/** Starts and stops machines to match the current settings, after looking for T3 Code on this computer. */
	async #sync(): Promise<void> {
		// This machine joins the list whenever T3 Code runs here, and stays once paired; a retry or a wake looks again.
		const localReady = this.machines.some((machine) => isLoopbackUrl(machine.url) && machine.state.kind === "ready");
		const local = localReady ? undefined : await findLocalEnvironment(fetch);
		if (local !== undefined) await this.#followLocal(local.url, local.environmentId);
		const wanted = new Set([
			...parseList(this.#settings.environments),
			...Object.keys(this.#auth).filter(isLoopbackUrl),
			...this.machines.filter((machine) => localReady && isLoopbackUrl(machine.url)).map((machine) => machine.url),
			...(local === undefined ? [] : [local.url]),
			...this.#pairingUrls,
		]);
		for (const [url, machine] of this.#machines) {
			if (wanted.has(url)) continue;
			this.#machines.delete(url);
			this.#loggedStates.delete(url);
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
		this.#loggedStates.delete(from);
		await this.save(from, undefined);
		await this.save(url, credential);
	}

	/** The inspector's copy of global settings lags behind the plugin's machines, tokens and scope requests. */
	#stale(settings: GlobalSettings): boolean {
		return (
			(settings.environments ?? "") !== (this.#settings.environments ?? "") ||
			JSON.stringify(settings.auth ?? {}) !== JSON.stringify(this.#auth) ||
			JSON.stringify(settings.scopeRequests ?? {}) !== JSON.stringify(this.#scopeRequests) ||
			settings.verboseUntil !== this.#verboseUntil
		);
	}

	#persist(): Promise<void> {
		const { verboseUntil: _stale, ...settings } = this.#settings;
		return streamDeck.settings.setGlobalSettings<GlobalSettings>({
			...settings,
			auth: this.#auth,
			scopeRequests: this.#scopeRequests,
			...(this.#verboseUntil === undefined ? {} : { verboseUntil: this.#verboseUntil }),
		});
	}
}

export const deck = new Deck();
