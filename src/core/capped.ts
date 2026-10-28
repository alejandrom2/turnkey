/** Sets `key`, first dropping the oldest entry when a new key would take the map past `cap`. For caches with no removal signal. */
export function setCapped<K, V>(map: Map<K, V>, key: K, value: V, cap = 32): void {
	if (!map.has(key) && map.size >= cap) map.delete(map.keys().next().value as K);
	map.set(key, value);
}
