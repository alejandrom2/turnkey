import { t } from "../i18n.js";
import { type CredentialStore, Machine } from "./machine.js";
import { type Credential, findLocalEnvironment, isLoopbackUrl, PairingError, parsePairingLink, preferLoopback } from "./pairing.js";
import type { SocketFactory } from "./rpc.js";

export type MachinesDeps = {
	fetch: typeof fetch;
	socket: SocketFactory;
	/** Which Turnkey this is, as T3 Code lists its pairings. */
	clientLabel: string;
	/** Where a machine's connection reports frames it couldn't handle. */
	warn?: (url: string, message: string) => void;
};

/** The T3 Code machines a host talks to: finds this computer's, pairs new ones, and keeps the set it's told to. */
export class Machines {
	readonly #machines = new Map<string, Machine>();
	/** Machines mid-pairing stay wanted through a sync, though nothing lists them yet. */
	readonly #pairingUrls = new Set<string>();

	constructor(
		private readonly store: CredentialStore,
		private readonly deps: MachinesDeps,
		private readonly onChange: () => void,
	) {}

	get all(): readonly Machine[] {
		return [...this.#machines.values()];
	}

	get(url: string): Machine | undefined {
		return this.#machines.get(url);
	}

	/**
	 * Finds T3 Code on this computer (unless a loopback machine is ready), follows it to a new port, then keeps exactly: `kept()` ∪ stored loopback URLs ∪ a ready loopback machine ∪ the one found ∪ any being paired. Stops the rest, starts the missing.
	 * `kept` is read after the search, so a machine paired and listed meanwhile survives.
	 */
	async sync(kept: () => readonly string[]): Promise<void> {
		// This machine joins the list whenever T3 Code runs here, and stays once paired; a retry or a wake looks again.
		const localReady = this.all.some((machine) => isLoopbackUrl(machine.url) && machine.state.kind === "ready");
		const local = localReady ? undefined : await findLocalEnvironment(this.deps.fetch);
		if (local !== undefined) await this.#followLocal(local.url, local.environmentId);
		const wanted = new Set([
			...kept(),
			...this.store.urls().filter(isLoopbackUrl),
			...this.all.filter((machine) => localReady && isLoopbackUrl(machine.url)).map((machine) => machine.url),
			...(local === undefined ? [] : [local.url]),
			...this.#pairingUrls,
		]);
		for (const [url, machine] of this.#machines) {
			if (wanted.has(url)) continue;
			this.#machines.delete(url);
			machine.stop();
		}
		for (const url of wanted) if (!this.#machines.has(url)) this.#create(url).start();
		this.onChange();
	}

	/** Spends a pair link; throws PairingError(t("pairing.notALink")) for a bad one. A machine it added is stopped and dropped again if pairing fails. */
	async pair(link: string, extraScopes: readonly string[] = []): Promise<{ url: string; credential: Credential }> {
		const parsed = parsePairingLink(link);
		if (parsed === undefined) throw new PairingError(t("pairing.notALink"));
		const url = preferLoopback(parsed.url);
		const existing = this.#machines.get(url);
		const machine = existing ?? this.#create(url);
		this.#pairingUrls.add(url);
		try {
			return { url, credential: await machine.pair(parsed.code, extraScopes) };
		} catch (error) {
			if (existing === undefined) {
				machine.stop();
				if (this.#machines.get(url) === machine) this.#machines.delete(url);
			}
			throw error;
		} finally {
			this.#pairingUrls.delete(url);
			this.onChange();
		}
	}

	/** Reconnects now: after a wake, a retry press or a key press while offline. */
	wake(url?: string): void {
		for (const machine of this.all) if (url === undefined || machine.url === url) machine.wake();
	}

	#create(url: string): Machine {
		const { warn } = this.deps;
		const machine = new Machine(url, this.store, { ...this.deps, warn: warn && ((message) => warn(url, message)) }, this.onChange);
		this.#machines.set(url, machine);
		return machine;
	}

	/** T3 Code moves to the next free port when 3773 is taken; keep its pairing when it does. */
	async #followLocal(url: string, environmentId: string): Promise<void> {
		if (this.store.load(url) !== undefined) return;
		const moved = this.store
			.urls()
			.map((other) => [other, this.store.load(other)] as const)
			.find(([other, credential]) => other !== url && isLoopbackUrl(other) && credential?.environmentId === environmentId);
		if (moved === undefined) return;
		const [from, credential] = moved;
		this.#machines.get(from)?.stop();
		this.#machines.delete(from);
		await this.store.save(from, undefined);
		await this.store.save(url, credential);
	}
}
