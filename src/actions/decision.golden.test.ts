import { describe, expect, it, vi } from "vitest";

import type { DeckThread } from "../core/board.js";
import type { Decision, PendingRequest } from "../core/t3/machine.js";
import { Approve, Deny } from "./keys.js";
import { type GoldenOptions, goldenKey } from "./testing/harness.js";
import { machine, thread } from "./testing/fixtures.js";

vi.mock("@elgato/streamdeck", async () => await import("./testing/streamdeck.js"));
vi.mock("node:child_process", async () => await import("./testing/process.js"));
vi.mock("../deck.js", async () => await import("./testing/deck.js"));

// Recorded from today's keys so the shared-keys refactor can prove no Stream Deck key changed. Never update these to make
// a refactor pass: a changed golden is a bug.
const golden = (name: string, value: string, ext: "svg" | "txt" = "svg") => expect(value).toMatchFileSnapshot(`./__goldens__/${name}.${ext}`);

const approval = (id: string, decisions: Decision[]): PendingRequest => ({ type: "approval", threadId: id, requestId: "req", heading: "Run a command", summary: "npm run build", decisions });

/** A thread waiting on a request; each state gets its own id, since keys share their loaded requests. */
const waiting = (id: string, request: PendingRequest | Promise<undefined> | undefined): DeckThread =>
	thread({ threadId: id, deck: "approval", pendingRequest: { id: "req", kind: "command", createdAt: "", threadId: id }, machine: machine({ request: request as PendingRequest }) });

const ALL: Decision[] = ["accept", "acceptForSession", "acceptAlways", "decline"];
const never = new Promise<undefined>(() => undefined);

const states = {
	"no-thread": () => ({ threads: [] as DeckThread[], selected: undefined, machines: [machine()] }),
	"no-request": () => {
		const idle = thread({ threadId: "idle" });
		return { threads: [idle], selected: idle };
	},
	loading: () => {
		const loading = waiting("loading", never);
		return { threads: [loading], selected: loading };
	},
	approval: () => {
		const ready = waiting("ready", approval("ready", ALL));
		return { threads: [ready], selected: ready };
	},
	unsupported: () => {
		const other = waiting("other", { type: "unsupported", threadId: "other", requestId: "req", heading: "Tool call" });
		return { threads: [other], selected: other };
	},
} satisfies Record<string, () => GoldenOptions>;

// A key pinned to a machine that can't act, with no thread: availability counts every machine, as it always has.
const pinned = () => ({ threads: [] as DeckThread[], selected: undefined, machines: [machine({ url: "http://a:1", canOperate: false }), machine({ url: "http://b:2", canOperate: true })], settings: { machine: "http://a:1" } });

describe("Approve goldens", () => {
	it("face: pinned machine can't act, another can", async () => golden("approve-pinned-machine", (await goldenKey(Approve, pinned())).image));
	for (const [name, state] of Object.entries(states)) it(`face: ${name}`, async () => golden(`approve-${name}`, (await goldenKey(Approve, state())).image));
	for (const authority of ["once", "session", "always"]) {
		it(`face: ${authority}, hold`, async () => golden(`approve-${authority}-hold`, (await goldenKey(Approve, { ...states.approval(), settings: { approvalAuthority: authority } })).image));
		it(`face: ${authority}, tap`, async () =>
			golden(`approve-${authority}-tap`, (await goldenKey(Approve, { ...states.approval(), settings: { approvalAuthority: authority, approvalConfirm: "tap" } })).image));
	}

	const press = async (name: string, held: number, settings: Record<string, unknown>, state: GoldenOptions = states.approval()) =>
		golden(name, (await goldenKey(Approve, { ...state, settings, held })).calls.join("\n") + "\n", "txt");
	it("press: a tap needs a hold", () => press("approve-press-tap", 0, { approvalAuthority: "once" }));
	it("press: held 600 ms allows once", () => press("approve-press-held", 600, { approvalAuthority: "once" }));
	it("press: held 600 ms allows for the session", () => press("approve-press-session", 600, { approvalAuthority: "session" }));
	it("press: held 600 ms allows always", () => press("approve-press-always", 600, { approvalAuthority: "always" }));
	it("press: a tap allows when set to tap", () => press("approve-press-tap-confirm", 0, { approvalAuthority: "once", approvalConfirm: "tap" }));
	it("press: while loading", () => press("approve-press-loading", 0, { approvalAuthority: "once" }, states.loading()));
	it("press: no request", () => press("approve-press-no-request", 0, { approvalAuthority: "once" }, states["no-request"]()));
	it("press: no thread", () => press("approve-press-no-thread", 0, { approvalAuthority: "once" }, states["no-thread"]()));
});

describe("Deny goldens", () => {
	it("face: pinned machine can't act, another can", async () => golden("deny-pinned-machine", (await goldenKey(Deny, pinned())).image));
	for (const [name, state] of Object.entries(states)) it(`face: ${name}`, async () => golden(`deny-${name}`, (await goldenKey(Deny, state())).image));

	const press = async (name: string, state: GoldenOptions) =>
		golden(name, (await goldenKey(Deny, { ...state, held: 0 })).calls.join("\n") + "\n", "txt");
	it("press: declines", () => press("deny-press", states.approval()));
	it("press: while loading", () => press("deny-press-loading", states.loading()));
	it("press: no thread", () => press("deny-press-no-thread", states["no-thread"]()));
	it("press: unsupported request opens the thread", () => press("deny-press-unsupported", states.unsupported()));
});
