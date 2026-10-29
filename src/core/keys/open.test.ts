import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { machine, RUNNING, scene, STATES } from "../../actions/testing/fixtures.js";
import type { GoldenOptions } from "../../actions/testing/harness.js";
import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
import { resolveTarget, type TargetSettings } from "../target.js";
import type { KeyContext, KeyRuntime, PressInput, PressPlan } from "./key.js";
import { openKey, type OpenSettings } from "./open.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z")));
afterEach(() => void vi.useRealTimers());

function context(world: GoldenOptions, settings: OpenSettings = {}): KeyContext<OpenSettings> {
	const threads = world.threads ?? [];
	const machines = world.machines ?? [...new Set(threads.map((each) => each.machine))];
	const runtime = {
		board: { threads, threadsOn: () => threads, selectedOn: () => world.selected },
		machines: () => machines,
		repaint: vi.fn(),
		openUrl: vi.fn(async () => undefined),
	} as unknown as KeyRuntime;
	const lookup = (key: string) => {
		const found = threads.find((each) => each.key === key);
		return found === undefined ? ({ state: "gone" } as const) : ({ state: "found", thread: found } as const);
	};
	return { settings, machine: undefined, runtime, target: () => resolveTarget<DeckThread>(settings as TargetSettings, () => world.selected, lookup) };
}

/** The face once any preview read has landed, as a shown key draws it. */
async function face(ctx: KeyContext<OpenSettings>): Promise<string> {
	openKey.state(ctx);
	await vi.advanceTimersByTimeAsync(0);
	openKey.state(ctx);
	await vi.advanceTimersByTimeAsync(0);
	return decoded(openKey.tile(openKey.state(ctx), ctx));
}
const plan = async (ctx: KeyContext<OpenSettings>, input: PressInput = { heldMs: 0, confirmBy: "settings" }): Promise<PressPlan> => {
	await face(ctx);
	return openKey.press(openKey.state(ctx), ctx, input);
};

const editing = (overrides: Parameters<typeof machine>[0] = {}, id = "open-core-1") => scene({ threadId: id }, { editors: ["vscode", "cursor"], ...overrides });
const local = { url: "http://127.0.0.1:3773" };
const sessions = (url: string, title = "Dev server") => ({ sessions: [{ threadId: "x", tabId: "tab", navStatus: { _tag: "Loaded", url, title }, updatedAt: "2026-06-01T11:00:00Z" }], revision: 1 });
let next = 0;
const previewing = (rpc: Record<string, unknown>, overrides: Parameters<typeof machine>[0] = {}) => scene({ threadId: `preview-core-${next++}` }, { ...local, rpc, ...overrides });
const PREVIEW = { mode: "preview" };

describe("Open (editor)", () => {
	it.each([
		["no-thread", STATES["no-thread"], {}],
		["read-only", () => scene({}, { canOperate: false, editors: ["vscode"] }), {}],
		["no-editors", STATES.idle, {}],
		["remote", () => editing(), {}],
		["here", () => editing(local), {}],
		["worktree", () => scene({ worktreePath: "/work/tree" }, { ...local, editors: ["vscode"] }), {}],
		["chosen", () => editing(local), { editor: "cursor" }],
		["chosen-missing", () => editing(local), { editor: "zed" }],
		["no-folder", () => editing({ project: () => undefined }), {}],
	] as Array<[string, () => GoldenOptions, OpenSettings]>)("open-%s", async (name, make, settings) => expect(await face(context(make(), settings))).toBe(golden(`open-${name}`)));

	it("opens the folder in T3 Code's first editor, or the chosen one, on any press", async () => {
		for (const confirmBy of ["settings", "hold", "click"] as const) {
			const world = editing(local);
			const opened = await plan(context(world), { heldMs: 0, confirmBy });
			if (opened.kind !== "run") throw new Error(`expected a run, got ${opened.kind}`);
			await opened.work();
			expect(world.selected!.machine.call).toHaveBeenCalledExactlyOnceWith("shell.openInEditor", { cwd: "/work/project", editor: "cursor" }, "orchestration:operate");
		}
		const chosen = editing(local);
		const run = await plan(context(chosen, { editor: "vscode" }));
		if (run.kind === "run") await run.work();
		expect(chosen.selected!.machine.call).toHaveBeenCalledWith("shell.openInEditor", { cwd: "/work/project", editor: "vscode" }, "orchestration:operate");
	});

	it("flashes why it can't open", async () => {
		expect(await plan(context(STATES["no-thread"]()))).toEqual({ kind: "fail", label: t("reason.noThread") });
		expect(await plan(context(STATES.idle()))).toEqual({ kind: "fail", label: t("editor.none") });
		expect(await plan(context(editing(local), { editor: "zed" }))).toEqual({ kind: "fail", label: t("needs.notAvailable", { value: "Zed" }) });
	});
});

describe("Open (preview)", () => {
	it.each([
		["no-thread", STATES["no-thread"]],
		["no-preview", () => previewing({ "preview.list": { sessions: [], revision: 0 } })],
		["old-t3", () => previewing({ "preview.list": new Error("no previews") })],
		["page", () => previewing({ "preview.list": sessions("http://localhost:5173/app") })],
		["page-untitled", () => previewing({ "preview.list": sessions("http://localhost:5173/app", " ") })],
		["remote-page", () => scene({ threadId: `preview-core-${next++}` }, { rpc: { "preview.list": sessions("http://localhost:5173/app") } })],
		["render", () => previewing({ "preview.list": { sessions: [], revision: 0 } }, { htmlRender: vi.fn(async () => ({ itemId: "item", attachmentId: "att", title: "Report" })) })],
		["running", () => scene({ ...RUNNING, threadId: `preview-core-${next++}` }, { ...local, rpc: { "preview.list": sessions("http://localhost:5173/app") } })],
	] as Array<[string, () => GoldenOptions]>)("preview-%s", async (name, make) => expect(await face(context(make(), PREVIEW))).toBe(golden(`preview-${name}`)));

	it("opens the page its preview shows, else the newest HTML render, in the browser", async () => {
		const page = previewing({ "preview.list": sessions("http://localhost:5173/app") });
		const ctx = context(page, PREVIEW);
		const opened = await plan(ctx, { heldMs: 0, confirmBy: "click" });
		if (opened.kind !== "run") throw new Error(`expected a run, got ${opened.kind}`);
		await opened.work();
		expect(ctx.runtime.openUrl).toHaveBeenCalledExactlyOnceWith("http://localhost:5173/app");
		const render = previewing({ "preview.list": { sessions: [], revision: 0 } }, { htmlRender: vi.fn(async () => ({ itemId: "item", attachmentId: "att", title: "Report" })) });
		const shown = context(render, PREVIEW);
		const rendered = await plan(shown);
		if (rendered.kind === "run") await rendered.work();
		expect(shown.runtime.openUrl).toHaveBeenCalledExactlyOnceWith("https://assets.test/render.html");
	});

	it("flashes why it can't open a preview", async () => {
		expect(await plan(context(previewing({ "preview.list": { sessions: [], revision: 0 } }), PREVIEW))).toEqual({ kind: "fail", label: t("openPreview.none") });
		const remote = scene({ threadId: `preview-core-${next++}` }, { rpc: { "preview.list": sessions("http://localhost:5173/app") } });
		expect(await plan(context(remote, PREVIEW))).toEqual({ kind: "fail", label: t("openPreview.onlyOn", { machine: "Studio" }) });
		const loading = scene({ threadId: `preview-core-${next++}` }, { ...local, rpc: { "preview.list": new Promise(() => undefined) } });
		const ctx = context(loading, PREVIEW);
		expect(openKey.press(openKey.state(ctx), ctx, { heldMs: 0, confirmBy: "click" })).toEqual({ kind: "fail", label: t("result.loading") });
	});

	it("lists a thread's previews again when its runs move and no events stream, as on Logitech", async () => {
		const thread = previewing({ "preview.list": { sessions: [], revision: 0 } });
		const ctx = context(thread, PREVIEW);
		await face(ctx);
		const call = thread.selected!.machine.call as ReturnType<typeof vi.fn>;
		const listed = () => call.mock.calls.filter(([tag]) => tag === "preview.list").length;
		expect(listed()).toBe(1);
		await face(ctx);
		expect(listed()).toBe(1);
		Object.assign(thread.selected!, { latestRunId: "run-9" });
		await face(ctx);
		expect(listed()).toBe(2);
	});
});
