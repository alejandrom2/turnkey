import { describe, expect, it, vi } from "vitest";

import { configWatch } from "./configwatch.js";
import { Keys } from "./keys.js";
import { type SidecarDeps, sidecarKinds } from "./kinds.js";
import { logiRuntime } from "./runtime.js";
import type { ThreadBoard } from "../core/board.js";

/** The sidecar's wiring: Keys over the real kinds, with the config watch the sidecar builds. */
function sidecar() {
	const release = vi.fn();
	const machine = { url: "http://m", watchConfig: vi.fn(() => release) };
	const { watch, unwatch } = configWatch(() => [machine]);
	const board = { threads: [], threadsOn: () => [], selectedOn: () => undefined } as unknown as ThreadBoard;
	const runtime = logiRuntime({ machines: () => [], board, openThread: async () => undefined, selectThread: () => undefined, repaint: () => undefined, warn: () => undefined });
	const deps = { board, open: () => undefined, openExternal: async () => undefined, refreshLimits: () => undefined, watchConfigs: watch, unwatchConfigs: unwatch, failed: () => () => undefined, settingsUrl: () => "", runtime, warn: () => undefined } as unknown as SidecarDeps;
	return { keys: new Keys(sidecarKinds(deps), () => undefined), machine, release };
}

describe("the config watch", () => {
	it("opens when the folder's keys appear and is released when they disappear", () => {
		const { keys, machine, release } = sidecar();
		for (const action of ["health:", "open:preview"]) keys.handle({ type: "appear", action, size: 80 });
		expect(machine.watchConfig).toHaveBeenCalledOnce();
		keys.handle({ type: "disappear", action: "health:" });
		expect(release).not.toHaveBeenCalled();
		keys.handle({ type: "disappear", action: "open:preview" });
		expect(release).toHaveBeenCalledOnce();
	});

	it("stays held while a top-level key that never reports hiding is shown", () => {
		const { keys, release } = sidecar();
		keys.handle({ type: "appear", action: "open:editor", size: 80 });
		keys.handle({ type: "appear", action: "health:", size: 80 });
		keys.handle({ type: "disappear", action: "health:" });
		expect(release).not.toHaveBeenCalled();
	});

	it("is taken again by the next key that shows", () => {
		const { keys, machine, release } = sidecar();
		keys.handle({ type: "appear", action: "health:", size: 80 });
		keys.handle({ type: "disappear", action: "health:" });
		keys.handle({ type: "appear", action: "health:", size: 80 });
		expect(release).toHaveBeenCalledOnce();
		expect(machine.watchConfig).toHaveBeenCalledTimes(2);
	});
});
