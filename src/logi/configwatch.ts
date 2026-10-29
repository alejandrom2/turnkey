type Config = { url: string; watchConfig(): () => void };

/**
 * The machines' config subscriptions, held while any key that needs them shows. A key that never reports hiding holds
 * them for good, so the release comes only once every key that asked has hidden.
 */
export function configWatch(ready: () => readonly Config[]): { watch(action: string): void; unwatch(action: string): void } {
	const releases = new Map<string, () => void>();
	const users = new Set<string>();
	return {
		watch(action) {
			users.add(action);
			// A machine that became ready since the last call is picked up by the next key that shows.
			for (const each of ready()) if (!releases.has(each.url)) releases.set(each.url, each.watchConfig());
		},
		unwatch(action) {
			if (!users.delete(action) || users.size > 0) return;
			for (const release of releases.values()) release();
			releases.clear();
		},
	};
}
