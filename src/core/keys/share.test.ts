import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { world } from "../../actions/testing/deck.js";
import { RUNNING, scene, STATES } from "../../actions/testing/fixtures.js";
import type { GoldenOptions } from "../../actions/testing/harness.js";
import type { DeckThread } from "../board.js";
import { failureLabel } from "../feedback.js";
import { t } from "../i18n.js";
import { needsAccessLabel } from "../scopes.js";
import { resolveTarget, type TargetSettings } from "../target.js";
import { ACCESS_SCOPE } from "../t3/pairing.js";
import type { KeyContext, KeyRuntime, PressInput, PressPlan } from "./key.js";
import { shareKey, type ShareSettings } from "./share.js";

vi.mock("node:child_process", async () => await import("../../actions/testing/process.js"));

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

beforeEach(() => {
	vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z"));
	world.spawned = [];
});
afterEach(() => void vi.useRealTimers());

const SHARE = { id: "share-1", expiresAt: "2026-06-02T12:00:00Z", guestName: null, messages: [] as { status: string }[] };
const ACCESS = ["orchestration:read", "orchestration:operate", "access:write"];
const sharing = (id: string, share: unknown, extra: Parameters<typeof scene>[1] = {}, thread = {}): GoldenOptions =>
	scene({ threadId: `core-${id}`, ...thread }, { url: "http://studio:3773", scopes: ACCESS, guestShare: vi.fn(async () => share), ...extra });

/** A Stream Deck runtime asks for opt-in access; Logitech's has no `optIn` at all. */
function context(options: GoldenOptions, settings: ShareSettings = {}, optIn = true): KeyContext<ShareSettings> {
	const threads = options.threads ?? [];
	const requested = new Set(options.requested ?? []);
	const runtime = {
		board: { threads, threadsOn: () => threads, selectedOn: () => options.selected },
		machines: () => [...new Set(threads.map((each) => each.machine))],
		repaint: vi.fn(),
		warn: vi.fn(),
		refreshConfigs: vi.fn(async () => undefined),
		optIn: optIn ? { requested: (_url: string, scope: string) => requested.has(scope), request: vi.fn(async () => undefined) } : undefined,
	} as unknown as KeyRuntime;
	const lookup = (key: string) => {
		const found = threads.find((each) => each.key === key);
		return found === undefined ? ({ state: "gone" } as const) : ({ state: "found", thread: found } as const);
	};
	return { settings, machine: undefined, runtime, target: () => resolveTarget<DeckThread>(settings as TargetSettings, () => options.selected, lookup), instance: "share-key" };
}

/** The face once the share has been read, as a shown key draws it. */
async function face(ctx: KeyContext<ShareSettings>): Promise<string> {
	shareKey.state(ctx);
	await vi.advanceTimersByTimeAsync(0);
	return decoded(shareKey.tile(shareKey.state(ctx), ctx));
}
const plan = async (ctx: KeyContext<ShareSettings>, input: PressInput): Promise<PressPlan> => {
	await face(ctx);
	await shareKey.prepare?.(ctx);
	return shareKey.press(shareKey.state(ctx), ctx, input);
};
const TAP: PressInput = { heldMs: 0, confirmBy: "settings" };

describe("Share", () => {
	it.each([
		["no-thread", STATES["no-thread"], {}],
		["loading", () => sharing("loading", null, { guestShare: () => new Promise(() => undefined) }), {}],
		["not-shared", () => sharing("none", null), {}],
		["disabled", () => sharing("disabled", null, { guestLinksEnabled: false }), {}],
		["needs-access", () => ({ ...sharing("access", null, { scopes: ["orchestration:read", "orchestration:operate"] }), requested: ["access:write"] }), {}],
		["unused", () => sharing("unused", SHARE), {}],
		["guest", () => sharing("guest", { ...SHARE, guestName: "Sam" }), {}],
		["pending", () => sharing("pending", { ...SHARE, guestName: "Sam", messages: [{ status: "pending" }, { status: "pending" }, { status: "sent" }] }), {}],
		["expired", () => sharing("expired", { ...SHARE, expiresAt: "2026-05-31T12:00:00Z" }), {}],
		["pinned-gone", () => sharing("pinned-gone", SHARE), { target: "thread", thread: "env/gone", threadTitle: "Old thread" }],
		["running", () => sharing("running", SHARE, {}, RUNNING), {}],
	] as Array<[string, () => GoldenOptions, ShareSettings]>)("share-%s", async (name, make, settings) => expect(await face(context(make(), settings))).toBe(golden(`share-${name}`)));

	it("makes a guest link and copies it, then copies it again on a tap", async () => {
		const options = sharing("create", null);
		const ctx = context(options);
		const create = await plan(ctx, { heldMs: 0, confirmBy: "click" });
		if (create.kind !== "run") throw new Error(`expected a run, got ${create.kind}`);
		await create.work();
		expect(options.selected!.machine.createGuestLink).toHaveBeenCalledOnce();
		expect(world.spawned).toEqual(["spawn clipboard ", "stdin https://t3.link/guest/abc"]);
		const again = await plan(ctx, TAP);
		if (again.kind !== "run") throw new Error(`expected a run, got ${again.kind}`);
		await again.work();
		expect(world.spawned).toHaveLength(4);
	});

	it("stops sharing on a hold, never on a Ring click, which can't hold", async () => {
		const shared = sharing("stop", SHARE);
		const held = await plan(context(shared), { heldMs: 600, confirmBy: "hold" });
		if (held.kind !== "run") throw new Error(`expected a run, got ${held.kind}`);
		await held.work();
		expect(shared.selected!.machine.closeGuestLink).toHaveBeenCalledOnce();
		const clicked = sharing("click", SHARE);
		expect(await plan(context(clicked), { heldMs: 0, confirmBy: "click" })).toEqual({ kind: "fail", label: t("share.holdToStop") });
		expect(await plan(context(sharing("tap", SHARE)), { heldMs: 0, confirmBy: "hold" })).toEqual({ kind: "fail", label: t("share.holdToStop") });
	});

	it("asks for access on Stream Deck, and only says it needs it on Logitech", async () => {
		const scopes = ["orchestration:read", "orchestration:operate"];
		const deck = context(sharing("deck-access", null, { scopes }));
		const asked = await plan(deck, TAP);
		if (asked.kind !== "run") throw new Error(`expected a run, got ${asked.kind}`);
		// Flagged for the next pairing first, then the press flashes the scope it lacks.
		const failed = asked.work();
		expect(deck.runtime.optIn!.request).toHaveBeenCalledExactlyOnceWith("http://studio:3773", ACCESS_SCOPE);
		await expect(failed).rejects.toSatisfy((error: unknown) => failureLabel(error) === needsAccessLabel(ACCESS_SCOPE));
		const logi = context(sharing("logi-access", null, { scopes }), {}, false);
		expect(await plan(logi, { heldMs: 0, confirmBy: "click" })).toEqual({ kind: "fail", label: needsAccessLabel(ACCESS_SCOPE) });
	});

	it("reads the config again before a press while guest links look off", async () => {
		const ctx = context(sharing("refresh", null, { guestLinksEnabled: false }));
		expect(await plan(ctx, TAP)).toEqual({ kind: "fail", label: t("share.disabled") });
		expect(ctx.runtime.refreshConfigs).toHaveBeenCalledExactlyOnceWith("http://studio:3773");
		expect(await plan(context(STATES["no-thread"]()), TAP)).toEqual({ kind: "fail", label: t("reason.noThread") });
	});
});
