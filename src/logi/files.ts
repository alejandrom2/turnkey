import { readFileSync, renameSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** The temp file is renamed over the target, so a crash mid-write can't leave a half-written file. */
export async function writeAtomic(path: string, text: string, mode = 0o666): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temp = `${path}.tmp`;
	await writeFile(temp, text, { mode });
	await rename(temp, path);
}

/** A file that won't parse is moved aside, so the next save can't erase what may still be recoverable. */
export function readJson(path: string): Record<string, unknown> | undefined {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
	} catch {
		// Falls through to keep the file.
	}
	try {
		renameSync(path, `${path}.corrupt`);
	} catch {
		// Nothing more to do; the caller starts empty.
	}
	return undefined;
}
