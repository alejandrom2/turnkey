import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type Saved = { haptics?: boolean };

/** The Logitech plugin's own settings, which its settings actions change, in one JSON file. */
export class FileSettings {
	#saved: Saved;

	constructor(private readonly path: string) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			this.#saved = typeof parsed === "object" && parsed !== null ? (parsed as Saved) : {};
		} catch {
			this.#saved = {};
		}
	}

	get haptics(): boolean {
		return this.#saved.haptics !== false;
	}

	async setHaptics(on: boolean): Promise<void> {
		this.#saved = { ...this.#saved, haptics: on };
		await mkdir(dirname(this.path), { recursive: true });
		await writeFile(this.path, JSON.stringify(this.#saved));
	}
}
