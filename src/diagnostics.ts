import streamDeck from "@elgato/streamdeck";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { arch, release } from "node:os";
import { join } from "node:path";

import { launch, revealCommand } from "./core/commands.js";
import { diagnosticsReport } from "./core/diagnostics.js";
import { deck, onOpenDeck } from "./deck.js";

/** Where the SDK writes the plugin's logs: `logs/<plugin UUID>.<n>.log` beside the plugin, `.0` the current one. */
const logsDir = (): string => join(process.cwd(), "logs");

/** The log's last 256 KB: files run to 50 MB, and the export only wants the latest problems. */
const TAIL_BYTES = 256 * 1024;

async function logTail(): Promise<string> {
	const file = join(logsDir(), `${streamDeck.info.plugin.uuid}.0.log`);
	try {
		const { size } = await stat(file);
		const handle = await open(file, "r");
		try {
			const length = Math.min(size, TAIL_BYTES);
			const buffer = Buffer.alloc(length);
			await handle.read(buffer, 0, length, size - length);
			return buffer.toString("utf8");
		} finally {
			await handle.close();
		}
	} catch {
		return "";
	}
}

/** Runs the OS opener. Explorer exits 1 even when it opened the window, so on Windows only a launch failure counts. */
function reveal(path: string, select: boolean): Promise<void> {
	const windows = process.platform === "win32";
	const [command, args] = revealCommand(path, select);
	return launch(command, args).catch((error: NodeJS.ErrnoException) => {
		if (!windows || error.code === "ENOENT") throw error;
	});
}

export const openLogsFolder = (): Promise<void> => reveal(logsDir(), false);

/** Writes the sanitized report into the logs folder and shows it in Finder or Explorer. */
export async function exportDiagnostics(actions: Record<string, number>): Promise<void> {
	const now = Date.now();
	const { application, plugin } = streamDeck.info;
	const openDeck = onOpenDeck();
	const report = diagnosticsReport({
		now,
		plugin: plugin.version,
		// OpenDeck tells Node plugins they run on Windows 10, so ask Node instead.
		streamDeck: openDeck ? "OpenDeck" : application.version,
		os: { platform: openDeck ? process.platform : application.platform, version: openDeck ? release() : application.platformVersion, arch: arch() },
		node: process.version,
		verboseUntil: deck.verboseUntil,
		settings: deck.globalSettings,
		machines: deck.machines.map((machine) => ({
			url: machine.url,
			state: machine.state.kind,
			message: machine.state.kind === "error" || machine.state.kind === "signed-out" ? machine.state.message : undefined,
			scopes: machine.scopes,
			environmentId: machine.environmentId,
		})),
		actions,
		log: await logTail(),
	});
	const file = join(logsDir(), `turnkey-diagnostics-${new Date(now).toISOString().replace(/[:.]/g, "-")}.json`);
	await mkdir(logsDir(), { recursive: true });
	await writeFile(file, `${JSON.stringify(report, null, "\t")}\n`);
	await reveal(file, true);
}
