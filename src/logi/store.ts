import type { CredentialStore } from "../core/t3/machine.js";
import type { Credential } from "../core/t3/pairing.js";
import { readJson, writeAtomic } from "./files.js";

/** Tokens by machine URL in one JSON file only its owner can read; Logitech has no secure settings store for them. */
export class FileCredentials implements CredentialStore {
	#all: Record<string, Credential> | undefined;

	constructor(private readonly path: string) {}

	load(url: string): Credential | undefined {
		return this.#read()[url];
	}

	urls(): string[] {
		return Object.keys(this.#read());
	}

	async save(url: string, credential: Credential | undefined): Promise<void> {
		const { [url]: _previous, ...rest } = this.#read();
		this.#all = credential === undefined ? rest : { ...rest, [url]: credential };
		await writeAtomic(this.path, JSON.stringify(this.#all), 0o600);
	}

	#read(): Record<string, Credential> {
		if (this.#all === undefined) {
			this.#all = (readJson(this.path) as Record<string, Credential> | undefined) ?? {};
		}
		return this.#all;
	}
}
