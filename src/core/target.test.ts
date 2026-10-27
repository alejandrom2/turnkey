import { describe, expect, it } from "vitest";

import { type PinnedLookup, pinnedKey, resolveTarget } from "./target.js";

type Thread = { key: string; title: string };
const selected: Thread = { key: "env/sel", title: "Selected" };
const pinned: Thread = { key: "env/pin", title: "Pinned" };
const lookup =
	(found: PinnedLookup<Thread>) =>
	(key: string): PinnedLookup<Thread> => {
		expect(key).toBe("env/pin");
		return found;
	};

describe("resolveTarget", () => {
	it("follows the selection by default", () => {
		expect(resolveTarget({}, () => selected, lookup({ state: "gone" }))).toEqual({ thread: selected, pinned: false });
		expect(resolveTarget({ target: "selected", thread: "env/pin" }, () => selected, lookup({ state: "gone" }))).toEqual({ thread: selected, pinned: false });
	});

	it("acts on the pinned thread whatever is selected", () => {
		expect(resolveTarget({ target: "thread", thread: "env/pin" }, () => selected, lookup({ state: "found", thread: pinned }))).toEqual({ thread: pinned, pinned: true });
	});

	it("names a pinned thread that is gone by its last title, else its id", () => {
		expect(resolveTarget({ target: "thread", thread: "env/pin", threadTitle: "Fix login" }, () => selected, lookup({ state: "gone" }))).toEqual({
			thread: undefined,
			pinned: true,
			gone: "Not available: Fix login",
		});
		expect(resolveTarget({ target: "thread", thread: "env/pin" }, () => selected, lookup({ state: "gone" })).gone).toBe("Not available: pin");
	});

	it("waits without a reason while the pinned thread's machine can't say", () => {
		expect(resolveTarget({ target: "thread", thread: "env/pin" }, () => selected, lookup({ state: "unknown" }))).toEqual({ thread: undefined, pinned: true, gone: undefined });
	});

	it("asks for a thread when This thread has none picked", () => {
		expect(pinnedKey({ target: "thread" })).toBe("");
		expect(resolveTarget({ target: "thread" }, () => selected, () => ({ state: "gone" })).gone).toBe("Pick a thread");
	});
});
