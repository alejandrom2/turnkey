import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { machine, offline } from "../../actions/testing/fixtures.js";
import { COLORS } from "../render.js";
import { ringFace } from "../ring.js";
import type { Machine } from "../t3/machine.js";
import { healthKey } from "./health.js";
import type { KeyContext, KeyRuntime } from "./key.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

const healthy = (overrides: Parameters<typeof machine>[0] = {}) => machine({ url: "http://studio:3773", ...overrides });
const brokenProvider = { instanceId: "codex", driver: "codex", installed: false, models: [] };

function context(machines: Machine[], url?: string): KeyContext<Record<string, never>> {
	const runtime = { machines: () => machines, retry: vi.fn(async () => undefined) } as unknown as KeyRuntime;
	return { settings: {}, machine: url, runtime, target: () => ({ thread: undefined, pinned: false }) };
}
const face = (ctx: KeyContext<Record<string, never>>) => decoded(healthKey.tile(healthKey.state(ctx), ctx));

describe("Health", () => {
	it.each([
		["ready", () => [healthy()]],
		["read-only", () => [healthy({ canOperate: false, state: { kind: "ready", environmentId: "env", label: "Studio", canOperate: false } })]],
		["provider-missing", () => [healthy({ modelConfig: { providers: [brokenProvider] } })]],
		["two-ready", () => [healthy(), healthy({ url: "http://laptop:3773", state: { kind: "ready", environmentId: "env2", label: "Laptop", canOperate: true } })]],
		["two-one-offline", () => [healthy(), offline()]],
		["signed-out", () => [healthy({ state: { kind: "signed-out" } })]],
	] as Array<[string, () => Machine[]]>)("health-%s", (name, make) => expect(face(context(make()))).toBe(golden(`health-${name}`)));

	it("says when the picked machine is gone, or none is found", () => {
		expect(face(context([healthy()], "http://gone:3773"))).toBe(golden("health-machine-removed"));
		expect(face(context([]))).toBe(golden("health-none"));
	});

	it("reconnects the key's machine on any press, on either platform", async () => {
		for (const confirmBy of ["settings", "hold", "click"] as const) {
			const ctx = context([offline()], "http://studio:3773");
			const plan = healthKey.press(healthKey.state(ctx), ctx, { heldMs: 0, confirmBy });
			if (plan.kind !== "run") throw new Error(`expected a run, got ${plan.kind}`);
			await plan.work();
			expect(ctx.runtime.retry).toHaveBeenCalledExactlyOnceWith("http://studio:3773");
		}
	});

	it("draws the Ring glyph in the worst problem's color", () => {
		const ctx = context([offline()]);
		expect(healthKey.glyph!(healthKey.state(ctx), ctx)).toBe(ringFace(COLORS.error, "health"));
		const fine = context([healthy()]);
		expect(healthKey.glyph!(healthKey.state(fine), fine)).toBe(ringFace(COLORS.done, "health"));
	});
});
