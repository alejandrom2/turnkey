import { readFileSync, renameSync } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/** The temp file is synced, then renamed over the target, so a crash mid-write can't leave a half-written file. */
export async function writeAtomic(path: string, text: string, mode = 0o666): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temp = `${path}.tmp`;
	// A leftover temp would keep its old mode, so the temp is always created fresh.
	await rm(temp, { force: true });
	const handle = await open(temp, "w", mode);
	try {
		await handle.writeFile(text);
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(temp, path);
}

/** A file that won't parse is moved aside, so the next save can't erase what may still be recoverable. */
export function readJson(path: string): Record<string, unknown> | undefined {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		// Only a missing file is empty; reading any other failure as empty would let the next save overwrite it.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
	} catch {
		// Falls through to keep the file.
	}
	try {
		renameSync(path, `${path}.corrupt-${Date.now()}`);
	} catch {
		// Nothing more to do; the caller starts empty.
	}
	return undefined;
}
