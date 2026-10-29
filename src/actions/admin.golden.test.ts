import { afterEach, beforeEach, describe, it, vi } from "vitest";

import { RpcError } from "../core/t3/rpc.js";
import { RunScriptKey, ShareKey, UpdateKey } from "./admin.js";
import { type GoldenOptions, recordFace, recordPress } from "./testing/harness.js";
import { machine, RUNNING, scene, STATES } from "./testing/fixtures.js";

vi.mock("@elgato/streamdeck", async () => await import("./testing/streamdeck.js"));
vi.mock("node:child_process", async () => await import("./testing/process.js"));
vi.mock("../deck.js", async () => await import("./testing/deck.js"));

// Recorded from today's keys so the shared-keys refactor can prove no Stream Deck key changed. Never update these to make
// a refactor pass: a changed golden is a bug.

type Setup = [name: string, make: () => GoldenOptions, settings?: Record<string, unknown>, held?: number | number[]];

const faces = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings] of setups) it(`${key} face: ${name}`, () => recordFace(`${key}-${name}`, Class, { ...make(), settings }));
};
const presses = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings, held] of setups) it(`${key} press: ${name}`, () => recordPress(`${key}-press-${name}`, Class, { ...make(), settings }, held ?? 0));
};

// The opt-in scopes are recorded with the machine's URL, so these machines keep one.
const URL = "http://studio:3773";
const MAINTAIN = ["orchestration:read", "orchestration:operate", "environment:maintain"];
const TERMINAL = ["orchestration:read", "orchestration:operate", "terminal:operate", "terminal:read"];
const ACCESS = ["orchestration:read", "orchestration:operate", "access:write"];
const UPDATE_REQUESTED: Pick<GoldenOptions, "requested"> = { requested: ["environment:maintain"] };

describe("Update goldens", () => {
	beforeEach(() => void vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ latest: "1.1.0" }) }))));
	afterEach(() => void vi.unstubAllGlobals());

	const service = { serverVersion: "1.0.0", capabilities: { serverSelfUpdate: "boot-service", serverSelfUpdateProgress: true } };
	const updating = (overrides: Parameters<typeof machine>[0] = {}): GoldenOptions => ({
		machines: [
			machine({
				url: URL,
				scopes: MAINTAIN,
				updateEnvironment: service,
				updateServer: vi.fn(async (target: string, onStage: (stage: string) => void) => {
					onStage("downloading");
					onStage("installing");
					return target;
				}),
				...overrides,
			}),
		],
	});

	faces("update", UpdateKey, [
		["none", STATES.none],
		["offline", STATES.offline],
		["ready", () => updating()],
		["no-version", () => updating({ updateEnvironment: { capabilities: service.capabilities } })],
		["manual", () => updating({ updateEnvironment: { serverVersion: "1.0.0", capabilities: {} } })],
		["desktop-too-old", () => updating({ updateEnvironment: { serverVersion: "1.0.0", capabilities: { serverSelfUpdate: "desktop-managed" } } })],
		["desktop", () => updating({ updateEnvironment: { serverVersion: "1.0.0", capabilities: { serverSelfUpdate: "desktop-managed", desktopAppUpdate: true } } })],
		["needs-access", () => ({ ...updating({ scopes: ["orchestration:read"] }), ...UPDATE_REQUESTED })],
		["without-access-yet", () => updating({ scopes: ["orchestration:read"] })],
		["several-remote", () => ({ machines: [machine({ url: "http://a:3773" }), machine({ url: "http://b:3773" })] })],
		["local-of-two", () => ({ machines: [machine({ url: "http://a:3773" }), machine({ url: "http://127.0.0.1:3773", updateEnvironment: service })] })],
		["picked-machine", () => ({ machines: [machine({ url: "http://a:3773", updateEnvironment: service }), machine({ url: "http://b:3773" })] }), { machine: "http://a:3773" }],
		["picked-machine-missing", () => updating(), { machine: "http://gone:3773" }],
	]);
	presses("update", UpdateKey, [
		["held-service", () => updating(), undefined, 600],
		["held-desktop", () => updating({ updateEnvironment: { serverVersion: "1.0.0", capabilities: { serverSelfUpdate: "desktop-managed", desktopAppUpdate: true } } }), undefined, 600],
		["tap", () => updating()],
		["manual", () => updating({ updateEnvironment: { serverVersion: "1.0.0", capabilities: {} } }), undefined, 600],
		["no-access", () => updating({ scopes: ["orchestration:read"] }), undefined, 600],
		["no-version", () => updating({ updateEnvironment: { capabilities: service.capabilities } }), undefined, 600],
		["failure", () => updating({ updateServer: vi.fn(async () => Promise.reject(new RpcError("ServerSelfUpdateError", "x", undefined, undefined, "service install missing"))) }), undefined, 600],
		["failure-plain", () => updating({ updateServer: vi.fn(async () => Promise.reject(new Error("boom"))) }), undefined, 600],
		["several-remote", () => ({ machines: [machine({ url: "http://a:3773" }), machine({ url: "http://b:3773" })] }), undefined, 600],
		["offline", STATES.offline, undefined, 600],
	]);
	it("update press: up to date", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ latest: "1.0.0" }) })));
		await recordPress("update-press-up-to-date", UpdateKey, updating(), 600);
	});
});

const BUILD = { id: "build", name: "Build", command: "npm run build", icon: "build" };
const TEST = { id: "test", name: "Test", command: "npm test", icon: "test" };
const project = (scripts: unknown[] = [BUILD, TEST]) => () => ({ id: "project", title: "Project", workspaceRoot: "/work/project", scripts });
const terminal = (threadId: string, id: string, state: Record<string, unknown>) =>
	new Map([[`${threadId}\ndeck-${id}`, { threadId, terminalId: `deck-${id}`, status: "running", exitCode: null, hasRunningSubprocess: false, ...state }]]);

/** A thread whose project has scripts and whose machine may run them. */
const scripting = (id: string, extra: Parameters<typeof machine>[0] = {}, thread = {}): GoldenOptions =>
	scene({ threadId: id, ...thread }, { url: URL, scopes: TERMINAL, project: project(), ...extra });
const BUILD_KEY = { script: "build", scriptName: "Build" };

describe("Run Script goldens", () => {
	faces("script", RunScriptKey, [
		["none", STATES.none, BUILD_KEY],
		["offline", STATES.offline, BUILD_KEY],
		["no-thread", STATES["no-thread"], BUILD_KEY],
		["pick", () => scripting("s-pick"), {}],
		["gone", () => scripting("s-gone"), { script: "deploy", scriptName: "Deploy" }],
		["no-project", () => scripting("s-no-project", { project: () => undefined }), BUILD_KEY],
		["idle", () => scripting("s-idle"), BUILD_KEY],
		["test-icon", () => scripting("s-test"), { script: "test", scriptName: "Test" }],
		["worktree", () => scripting("s-tree", {}, { worktreePath: "/work/tree" }), BUILD_KEY],
		["running", () => scripting("s-running", { terminals: terminal("s-running", "build", { hasRunningSubprocess: true }) }), BUILD_KEY],
		["finished", () => scripting("s-finished", { terminals: terminal("s-finished", "build", {}) }), BUILD_KEY],
		["exited-0", () => scripting("s-exit0", { terminals: terminal("s-exit0", "build", { status: "exited", exitCode: 0 }) }), BUILD_KEY],
		["exited-1", () => scripting("s-exit1", { terminals: terminal("s-exit1", "build", { status: "exited", exitCode: 1 }) }), BUILD_KEY],
		["ended", () => scripting("s-ended", { terminals: terminal("s-ended", "build", { status: "exited", exitCode: null }) }), BUILD_KEY],
		["error", () => scripting("s-error", { terminals: terminal("s-error", "build", { status: "error" }) }), BUILD_KEY],
		["needs-access", () => ({ ...scripting("s-access", { scopes: ["orchestration:read", "orchestration:operate"] }), requested: ["terminal:operate"] }), BUILD_KEY],
		["pinned", () => ({ ...scripting("s-pinned"), selected: undefined }), { ...BUILD_KEY, target: "thread", thread: "env/s-pinned", threadTitle: "Thread" }],
		["pinned-gone", () => scripting("s-pinned-gone"), { ...BUILD_KEY, target: "thread", thread: "env/gone", threadTitle: "Old thread" }],
		["unnamed", () => scripting("s-unnamed"), { script: "build" }],
	]);
	it("script face: running, full motion", () =>
		recordFace("script-running-full", RunScriptKey, { ...scripting("s-full", { terminals: terminal("s-full", "build", { hasRunningSubprocess: true }) }), settings: BUILD_KEY, motion: "full" }));
	presses("script", RunScriptKey, [
		["run", () => scripting("p-run"), BUILD_KEY],
		["run-worktree", () => scripting("p-tree", {}, { worktreePath: "/work/tree" }), BUILD_KEY],
		["run-then-tap", () => scripting("p-twice"), BUILD_KEY, [0, 0]],
		["running-tap", () => scripting("p-running", { terminals: terminal("p-running", "build", { hasRunningSubprocess: true }) }), BUILD_KEY],
		["running-held", () => scripting("p-running-held", { terminals: terminal("p-running-held", "build", { hasRunningSubprocess: true }) }), BUILD_KEY, 600],
		["no-access", () => scripting("p-access", { scopes: ["orchestration:read", "orchestration:operate"] }), BUILD_KEY],
		["pick", () => scripting("p-pick"), {}],
		["gone", () => scripting("p-gone"), { script: "deploy", scriptName: "Deploy" }],
		["no-thread", STATES["no-thread"], BUILD_KEY],
		["offline", STATES.offline, BUILD_KEY],
		["failure", () => scripting("p-fail", { runScript: vi.fn(async () => Promise.reject(new Error("boom"))) }), BUILD_KEY],
	]);
});

const SHARE = { id: "share-1", expiresAt: "2026-06-02T12:00:00Z", guestName: null, messages: [] as { status: string }[] };
const sharing = (id: string, share: unknown, extra: Parameters<typeof machine>[0] = {}, thread = {}): GoldenOptions =>
	scene({ threadId: id, ...thread }, { url: URL, scopes: ACCESS, guestShare: vi.fn(async () => share), ...extra });

describe("Share goldens", () => {
	faces("share", ShareKey, [
		["none", STATES.none],
		["offline", STATES.offline],
		["no-thread", STATES["no-thread"]],
		["loading", () => sharing("h-loading", null, { guestShare: () => new Promise(() => undefined) })],
		["not-shared", () => sharing("h-none", null)],
		["disabled", () => sharing("h-disabled", null, { guestLinksEnabled: false })],
		["needs-access", () => ({ ...sharing("h-access", null, { scopes: ["orchestration:read", "orchestration:operate"] }), requested: ["access:write"] })],
		["unused", () => sharing("h-unused", SHARE)],
		["guest", () => sharing("h-guest", { ...SHARE, guestName: "Sam" })],
		["pending-one", () => sharing("h-pending1", { ...SHARE, guestName: "Sam", messages: [{ status: "pending" }] })],
		["pending", () => sharing("h-pending", { ...SHARE, guestName: "Sam", messages: [{ status: "pending" }, { status: "pending" }, { status: "sent" }] })],
		["expired", () => sharing("h-expired", { ...SHARE, expiresAt: "2026-05-31T12:00:00Z" })],
		["pinned", () => ({ ...sharing("h-pinned", SHARE), selected: undefined }), { target: "thread", thread: "env/h-pinned", threadTitle: "Thread" }],
		["pinned-gone", () => sharing("h-pinned-gone", SHARE), { target: "thread", thread: "env/gone", threadTitle: "Old thread" }],
		["running", () => sharing("h-running", SHARE, {}, RUNNING)],
	]);
	presses("share", ShareKey, [
		["create", () => sharing("q-create", null)],
		["create-then-tap", () => sharing("q-create-twice", null), undefined, [0, 0]],
		["create-then-hold", () => sharing("q-create-hold", null), undefined, [0, 600]],
		["active-tap", () => sharing("q-active", SHARE)],
		["active-held", () => sharing("q-active-held", SHARE), undefined, 600],
		["expired-tap", () => sharing("q-expired", { ...SHARE, expiresAt: "2026-05-31T12:00:00Z" })],
		["expired-held", () => sharing("q-expired-held", { ...SHARE, expiresAt: "2026-05-31T12:00:00Z" }), undefined, 600],
		["no-access", () => sharing("q-access", null, { scopes: ["orchestration:read", "orchestration:operate"] })],
		["disabled", () => sharing("q-disabled", null, { guestLinksEnabled: false })],
		["unavailable", () => sharing("q-unavailable", null, { createGuestLink: vi.fn(async () => Promise.reject(new RpcError("GuestShareCreateError", "x", undefined, undefined, "connect_unavailable"))) })],
		["failure", () => sharing("q-failure", null, { createGuestLink: vi.fn(async () => Promise.reject(new Error("boom"))) })],
		["no-thread", STATES["no-thread"]],
		["offline", STATES.offline],
	]);
});
