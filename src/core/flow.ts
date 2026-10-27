/**
 * Where each dial sits in the Flow strip background (`flowArt` in render.ts): one wide picture across a run of adjacent
 * dials, each dial showing its 200 px slice. Runs group this plugin's dials by device into adjacent columns; a gap (an
 * empty dial or another plugin's) breaks a run.
 */
export type DialPlace = { id: string; device: string; column: number };
export type Run = { length: number; position: number };

/** Dial ids per run of adjacent columns on one device, left to right. */
export function dialGroups(dials: readonly DialPlace[]): string[][] {
	const groups: string[][] = [];
	const byDevice = new Map<string, DialPlace[]>();
	for (const dial of dials) byDevice.set(dial.device, [...(byDevice.get(dial.device) ?? []), dial]);
	for (const placed of byDevice.values()) {
		const sorted = [...placed].sort((a, b) => a.column - b.column);
		let start = 0;
		for (let index = 1; index <= sorted.length; index++) {
			if (index < sorted.length && sorted[index].column === sorted[index - 1].column + 1) continue;
			groups.push(sorted.slice(start, index).map((dial) => dial.id));
			start = index;
		}
	}
	return groups;
}

export function dialRuns(dials: readonly DialPlace[]): Map<string, Run> {
	const runs = new Map<string, Run>();
	for (const group of dialGroups(dials)) group.forEach((id, position) => runs.set(id, { length: group.length, position }));
	return runs;
}
