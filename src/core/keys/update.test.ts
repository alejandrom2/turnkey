import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { machine } from "../../actions/testing/fixtures.js";
import { t } from "../i18n.js";
import { needsAccessLabel } from "../scopes.js";
import type { Machine } from "../t3/machine.js";
import { MAINTAIN_SCOPE } from "../t3/pairing.js";
import type { KeyContext, KeyRuntime, PressInput, PressPlan } from "./key.js";
import { createUpdateKey, type UpdateKey, type UpdateSettings } from "./update.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

const results: Array<[string, string]> = [];
let updateKey: UpdateKey;
beforeEach(() => {
	updateKey = createUpdateKey();
	vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z"));
	vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ latest: "1.1.0" }) })));
	results.length = 0;
	updateKey.onResult((url, label) => void results.push([url, label]));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const MAINTAIN = ["orchestration:read", "orchestration:operate", "environment:maintain"];
const service = { serverVersion: "1.0.0", capabilities: { serverSelfUpdate: "boot-service", serverSelfUpdateProgress: true } };
let next = 0;
const updating = (overrides: Parameters<typeof machine>[0] = {}): Machine =>
	machine({
		url: `http://update-core-${next++}:3773`,
		scopes: MAINTAIN,
		updateEnvironment: service,
		updateServer: vi.fn(async (target: string, onStage: (stage: string) => void) => {
			onStage("downloading");
			onStage("installing");
			return target;
		}),
		...overrides,
	});

/** A Stream Deck runtime asks for opt-in access; Logitech's has no `optIn`. */
function context(machines: Machine[], settings: UpdateSettings = {}, options: { requested?: string[]; optIn?: boolean } = {}): KeyContext<UpdateSettings> {
	const requested = new Set(options.requested ?? []);
	const runtime = {
		machines: () => machines,
		repaint: vi.fn(),
		warn: vi.fn(),
		motion: () => "off",
		optIn: options.optIn === false ? undefined : { requested: (_url: string, scope: string) => requested.has(scope), request: vi.fn(async () => undefined) },
	} as unknown as KeyRuntime;
	return { settings, machine: settings.machine, runtime, target: () => ({ thread: undefined, pinned: false }) };
}
const face = (ctx: KeyContext<UpdateSettings>) => decoded(updateKey.tile(updateKey.state(ctx), ctx));
const press = (ctx: KeyContext<UpdateSettings>, input: PressInput): PressPlan => updateKey.press(updateKey.state(ctx), ctx, input);
const HELD: PressInput = { heldMs: 600, confirmBy: "settings" };

describe("Update T3", () => {
	it.each([
		["ready", () => [updating({ url: "http://studio:3773" })], {}, {}],
		["no-version", () => [updating({ url: "http://studio:3773", updateEnvironment: { capabilities: service.capabilities } })], {}, {}],
		["manual", () => [updating({ url: "http://studio:3773", updateEnvironment: { serverVersion: "1.0.0", capabilities: {} } })], {}, {}],
		["desktop", () => [updating({ url: "http://studio:3773", updateEnvironment: { serverVersion: "1.0.0", capabilities: { serverSelfUpdate: "desktop-managed", desktopAppUpdate: true } } })], {}, {}],
		["needs-access", () => [updating({ url: "http://studio:3773", scopes: ["orchestration:read"] })], {}, { requested: ["environment:maintain"] }],
		["without-access-yet", () => [updating({ url: "http://studio:3773", scopes: ["orchestration:read"] })], {}, {}],
		["several-remote", () => [machine({ url: "http://a:3773" }), machine({ url: "http://b:3773" })], {}, {}],
		["local-of-two", () => [machine({ url: "http://a:3773" }), machine({ url: "http://127.0.0.1:3773", updateEnvironment: service })], {}, {}],
		["picked-machine", () => [machine({ url: "http://a:3773", updateEnvironment: service }), machine({ url: "http://b:3773" })], { machine: "http://a:3773" }, {}],
	] as Array<[string, () => Machine[], UpdateSettings, { requested?: string[] }]>)("update-%s", (name, make, settings, options) =>
		expect(face(context(make(), settings, options))).toBe(golden(`update-${name}`)),
	);

	it("updates on a hold through each stage, then waits for the machine to come back on the new version", async () => {
		const shown = updating();
		const ctx = context([shown]);
		const plan = press(ctx, HELD);
		if (plan.kind !== "run") throw new Error(`expected a run, got ${plan.kind}`);
		await plan.work();
		expect(shown.updateServer).toHaveBeenCalledWith("1.1.0", expect.any(Function));
		expect(face(ctx)).toContain(t("update.restarting"));
		expect(press(ctx, HELD)).toEqual({ kind: "nothing" });
		Object.assign(shown, { updateEnvironment: { ...service, serverVersion: "1.1.0" } });
		updateKey.settle(ctx.runtime);
		expect(face(ctx)).toContain("v1.1.0");
	});

	it("reports up to date, and a failure, to every key on that machine", async () => {
		const current = updating();
		Object.assign(current, { updateEnvironment: { ...service, serverVersion: "1.1.0" } });
		const plan = press(context([current]), HELD);
		if (plan.kind === "run") await plan.work();
		const failing = updating({ updateServer: vi.fn(async () => Promise.reject(new Error("boom"))) });
		const failed = press(context([failing]), HELD);
		if (failed.kind === "run") await failed.work();
		expect(results).toEqual([
			[current.url, t("update.upToDate")],
			[failing.url, t("update.failed")],
		]);
	});

	it("says when the machine doesn't come back in time", async () => {
		const shown = updating();
		const ctx = context([shown]);
		const plan = press(ctx, HELD);
		if (plan.kind === "run") await plan.work();
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(results).toEqual([[shown.url, t("update.noReturn")]]);
		expect(face(ctx)).toContain("v1.0.0");
	});

	it("needs a hold on Stream Deck and a keypad, and acts on a Ring click", () => {
		expect(press(context([updating()]), { heldMs: 0, confirmBy: "settings" })).toEqual({ kind: "needsHold", label: t("update.holdToUpdate") });
		expect(press(context([updating()]), { heldMs: 599, confirmBy: "hold" })).toEqual({ kind: "needsHold", label: t("update.holdToUpdate") });
		expect(press(context([updating()]), { heldMs: 600, confirmBy: "hold" }).kind).toBe("run");
		expect(press(context([updating()]), { heldMs: 0, confirmBy: "click" }).kind).toBe("run");
	});

	it("checks access, then the route, then the hold; Logitech never asks for access", () => {
		const scopes = ["orchestration:read"];
		const deck = context([updating({ scopes, updateEnvironment: { serverVersion: "1.0.0", capabilities: {} } })]);
		expect(press(deck, { heldMs: 0, confirmBy: "settings" })).toEqual({ kind: "fail", label: needsAccessLabel(MAINTAIN_SCOPE) });
		expect(deck.runtime.optIn!.request).toHaveBeenCalledOnce();
		const logi = context([updating({ scopes })], {}, { optIn: false });
		expect(press(logi, { heldMs: 0, confirmBy: "click" })).toEqual({ kind: "fail", label: needsAccessLabel(MAINTAIN_SCOPE) });
		expect(press(context([updating({ updateEnvironment: { serverVersion: "1.0.0", capabilities: {} } })]), { heldMs: 0, confirmBy: "click" }).kind).toBe("fail");
		expect(press(context([machine({ url: "http://a:3773" }), machine({ url: "http://b:3773" })]), HELD)).toEqual({ kind: "fail", label: t("update.pickMachine") });
	});
});
