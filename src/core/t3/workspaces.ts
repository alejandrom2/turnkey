import type { ConfigProvider } from "../models.js";
import { WORKSPACE_SNAPSHOT_TTL_MS, type WorkspaceSnapshot } from "../skills.js";
import type { RpcSocket } from "./rpc.js";

/** Provider refreshes may probe CLIs, so they get longer before they count as failed. */
export const PROVIDERS_TIMEOUT_MS = 60_000;
/** T3 Code's composer retries a checkout's skills read this long after a failure, at most three times in a row. */
const WORKSPACE_RETRY_MS = 10_000;
const WORKSPACE_MAX_FAILURES = 3;
/** Skills reads kept per provider and checkout; the oldest go first. */
const MAX_WORKSPACES = 50;

/** One checkout's skills read: the snapshot T3 Code sent, when it was asked for, and its failures in a row. */
type WorkspaceRead = { snapshot?: WorkspaceSnapshot; requestedAt?: number; retryAt?: number; failures: number; pending?: Promise<void> };

/** Per provider instance and checkout, its skills snapshot: config replies leave these out, so they are read on demand. */
export class WorkspaceReads {
	readonly #reads = new Map<string, WorkspaceRead>();

	constructor(
		private readonly now: () => number,
		private readonly onChange: () => void,
	) {}

	/**
	 * Starts a checkout's read on `rpc` when it has none, or a stale one, unless failures hold it back
	 * (`planProviderWorkspaceSnapshotRefresh`); without `rpc` it only reports what it has.
	 */
	read(instanceId: string, cwd: string, rpc: RpcSocket | undefined): WorkspaceRead {
		const key = `${instanceId}\n${cwd}`;
		const read = this.#reads.get(key) ?? { failures: 0 };
		// Re-inserted so the map stays oldest-used first, and the least recently shown checkout is the one dropped.
		this.#reads.delete(key);
		this.#reads.set(key, read);
		if (this.#reads.size > MAX_WORKSPACES) this.#reads.delete(this.#reads.keys().next().value!);
		const now = this.now();
		const due = read.requestedAt === undefined || now - read.requestedAt >= WORKSPACE_SNAPSHOT_TTL_MS;
		if (read.pending !== undefined || !due || (read.retryAt ?? 0) > now || read.failures >= WORKSPACE_MAX_FAILURES || rpc === undefined) return read;
		read.requestedAt = now;
		read.pending = rpc
			.request<{ providers?: ConfigProvider[] }>("server.refreshProviders", { instanceId, cwd, workspaceSnapshotsOnDemand: true }, PROVIDERS_TIMEOUT_MS)
			.then(({ providers }) => providers?.find((provider) => provider.instanceId === instanceId)?.workspaceSnapshots?.find((snapshot) => snapshot.cwd === cwd))
			.catch(() => undefined)
			.then((snapshot) => {
				read.pending = undefined;
				if (this.#reads.get(key) !== read) return;
				if (snapshot === undefined || snapshot.slashCommandsPending === true) {
					read.failures++;
					read.requestedAt = undefined;
					read.retryAt = this.now() + WORKSPACE_RETRY_MS;
				} else {
					read.snapshot = snapshot;
					read.failures = 0;
				}
				this.onChange();
			});
		return read;
	}

	clear(): void {
		this.#reads.clear();
	}
}
