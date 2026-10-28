import { readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CredentialStore } from "../core/t3/machine.js";
import type { Credential } from "../core/t3/pairing.js";

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
		await mkdir(dirname(this.path), { recursive: true });
		await writeFile(this.path, JSON.stringify(this.#all), { mode: 0o600 });
		// `mode` only applies when the file is created.
		await chmod(this.path, 0o600);
	}

	#read(): Record<string, Credential> {
		if (this.#all === undefined) {
			try {
				const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
				this.#all = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, Credential>) : {};
			} catch {
				this.#all = {};
			}
		}
		return this.#all;
	}
}
