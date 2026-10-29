import { describe, it, vi } from "vitest";

import { OpenInEditor, OpenKey, OpenPreview } from "./open.js";
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

const connection: Setup[] = [
	["none", STATES.none],
	["offline", STATES.offline],
	["no-thread", STATES["no-thread"]],
	["read-only", () => scene({}, { canOperate: false, editors: ["vscode"] })],
];

/** A thread on a machine with editors, here (loopback) or elsewhere. */
const editing = (overrides: Parameters<typeof machine>[0] = {}, id = "open-1") => scene({ threadId: id }, { editors: ["vscode", "cursor"], ...overrides });
const local = { url: "http://127.0.0.1:3773" };

describe("Open (editor) goldens", () => {
	faces("open", OpenKey, [
		...connection,
		["no-editors", STATES.idle],
		["remote", () => editing()],
		["here", () => editing(local)],
		["worktree", () => ({ ...scene({ worktreePath: "/work/tree" }, { ...local, editors: ["vscode"] }) })],
		["chosen", () => editing(local), { editor: "cursor" }],
		["chosen-missing", () => editing(local), { editor: "zed" }],
		["no-folder", () => editing({ project: () => undefined })],
	]);
	faces("open-legacy-editor", OpenInEditor, [["here", () => editing(local)]]);
	presses("open", OpenKey, [
		["tap", () => editing(local)],
		["chosen", () => editing(local), { editor: "cursor" }],
		["worktree", () => scene({ worktreePath: "/work/tree" }, { ...local, editors: ["vscode"] })],
		["chosen-missing", () => editing(local), { editor: "zed" }],
		["no-editors", STATES.idle],
		["no-thread", STATES["no-thread"]],
		["read-only", () => scene({}, { canOperate: false, editors: ["vscode"] })],
		["offline", STATES.offline],
		["failure", () => editing({ ...local, call: vi.fn(async () => Promise.reject(new Error("boom"))) })],
	]);
	presses("open-legacy-editor", OpenInEditor, [["tap", () => editing(local)]]);
});

const sessions = (url: string, title = "Dev server") => ({ sessions: [{ threadId: "x", tabId: "tab", navStatus: { _tag: "Loaded", url, title }, updatedAt: "2026-06-01T11:00:00Z" }], revision: 1 });
const previewing = (rpc: Record<string, unknown>, overrides: Parameters<typeof machine>[0] = {}, id = "preview-1") => scene({ threadId: id }, { ...local, rpc, ...overrides });
const preview = { mode: "preview" };

describe("Open (preview) goldens", () => {
	faces("preview", OpenKey, [
		["none", STATES.none, preview],
		["offline", STATES.offline, preview],
		["no-thread", STATES["no-thread"], preview],
		["no-preview", () => previewing({ "preview.list": { sessions: [], revision: 0 } }), preview],
		["old-t3", () => previewing({ "preview.list": new Error("no previews") }), preview],
		["page", () => previewing({ "preview.list": sessions("http://localhost:5173/app") }), preview],
		["page-untitled", () => previewing({ "preview.list": sessions("http://localhost:5173/app", " ") }), preview],
		["remote-page", () => scene({}, { rpc: { "preview.list": sessions("http://localhost:5173/app") } }), preview],
		["render", () => previewing({ "preview.list": { sessions: [], revision: 0 } }, { htmlRender: vi.fn(async () => ({ itemId: "item", attachmentId: "att", title: "Report" })) }), preview],
		["running", () => ({ ...scene({ ...RUNNING }, { ...local, rpc: { "preview.list": sessions("http://localhost:5173/app") } }) }), preview],
	]);
	faces("preview-legacy", OpenPreview, [["page", () => previewing({ "preview.list": sessions("http://localhost:5173/app") })]]);
	presses("preview", OpenKey, [
		["page", () => previewing({ "preview.list": sessions("http://localhost:5173/app") }), preview],
		["render", () => previewing({ "preview.list": { sessions: [], revision: 0 } }, { htmlRender: vi.fn(async () => ({ itemId: "item", attachmentId: "att", title: "Report" })) }), preview],
		["no-preview", () => previewing({ "preview.list": { sessions: [], revision: 0 } }), preview],
		["remote-page", () => scene({}, { rpc: { "preview.list": sessions("http://localhost:5173/app") } }), preview],
		["no-thread", STATES["no-thread"], preview],
		["offline", STATES.offline, preview],
	]);
	presses("preview-legacy", OpenPreview, [["page", () => previewing({ "preview.list": sessions("http://localhost:5173/app") })]]);
});
