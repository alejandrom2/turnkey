import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { machine, thread } from "../../actions/testing/fixtures.js";
import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
import type { Decision, PendingRequest } from "../t3/machine.js";
import { approveKey, type ApproveSettings, denyKey } from "./decision.js";
import type { KeyContext, KeyRuntime, PressInput, PressPlan } from "./key.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");

const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

const ALL: Decision[] = ["accept", "acceptForSession", "acceptAlways", "decline"];
const approval = (id: string): PendingRequest => ({ type: "approval", threadId: id, requestId: "req", heading: "Run a command", summary: "npm run build", decisions: ALL });
const never = new Promise<undefined>(() => undefined);

/** A thread waiting on a request; each state gets its own id, since keys share their loaded requests. */
const waiting = (id: string, request: PendingRequest | Promise<undefined>): DeckThread =>
	thread({ threadId: id, deck: "approval", pendingRequest: { id: "req", kind: "command", createdAt: "", threadId: id }, machine: machine({ request: request as PendingRequest }) });

function context<S>(selected: DeckThread | undefined, settings: S) {
	const openThread = vi.fn(async () => undefined);
	const repaint = vi.fn();
	const runtime = { board: { threads: selected ? [selected] : [] }, machines: () => [machine()], openThread, repaint } as unknown as KeyRuntime;
	const ctx: KeyContext<S> = { settings, machine: undefined, runtime, target: () => ({ thread: selected, pinned: false }) };
	return { ctx, openThread, repaint };
}

const hold = (heldMs: number): PressInput => ({ heldMs, confirmBy: "settings" });
const run = async (plan: PressPlan) => {
	if (plan.kind !== "run") throw new Error(`expected run, got ${plan.kind}`);
	await plan.work();
};
// The request loads asynchronously; the first state() starts it, the next sees it.
const loaded = async <S, St>(key: { state(ctx: KeyContext<S>): St }, ctx: KeyContext<S>): Promise<St> => {
	key.state(ctx);
	await new Promise((resolve) => setTimeout(resolve, 0));
	return key.state(ctx);
};

describe("Approve faces match the recorded goldens", () => {
	const cases: [string, () => DeckThread | undefined, ApproveSettings][] = [
		["approve-no-thread", () => undefined, {}],
		["approve-no-request", () => thread({ threadId: "idle" }), {}],
		["approve-loading", () => waiting("loading", never), {}],
		["approve-approval", () => waiting("ready", approval("ready")), {}],
		["approve-unsupported", () => waiting("other", { type: "unsupported", threadId: "other", requestId: "req", heading: "Tool call" }), {}],
		["approve-once-hold", () => waiting("ready", approval("ready")), { approvalAuthority: "once" }],
		["approve-session-tap", () => waiting("ready", approval("ready")), { approvalAuthority: "session", approvalConfirm: "tap" }],
		["approve-always-hold", () => waiting("ready", approval("ready")), { approvalAuthority: "always" }],
	];
	for (const [name, make, settings] of cases)
		it(name, async () => {
			const { ctx } = context(make(), settings);
			expect(decoded(approveKey.tile(await loaded(approveKey, ctx), ctx))).toBe(golden(name));
		});
});

describe("Deny faces match the recorded goldens", () => {
	const cases: [string, () => DeckThread | undefined][] = [
		["deny-no-thread", () => undefined],
		["deny-no-request", () => thread({ threadId: "idle" })],
		["deny-loading", () => waiting("loading", never)],
		["deny-approval", () => waiting("ready", approval("ready"))],
		["deny-unsupported", () => waiting("other", { type: "unsupported", threadId: "other", requestId: "req", heading: "Tool call" })],
	];
	for (const [name, make] of cases)
		it(name, async () => {
			const { ctx } = context(make(), {});
			expect(decoded(denyKey.tile(await loaded(denyKey, ctx), ctx))).toBe(golden(name));
		});
});

describe("Approve press", () => {
	const ready = () => waiting("ready", approval("ready"));

	it("fails while the request loads", () => {
		const { ctx } = context(waiting("loading", never), { approvalAuthority: "once" });
		expect(approveKey.press(approveKey.state(ctx), ctx, hold(0))).toEqual({ kind: "fail", label: t("result.loading") });
	});

	it("asks for a hold when a tap isn't enough", async () => {
		const { ctx } = context(ready(), { approvalAuthority: "once" });
		expect(approveKey.press(await loaded(approveKey, ctx), ctx, hold(0))).toEqual({ kind: "needsHold", label: t("result.holdToAllow") });
	});

	it("allows on a tap when set to tap", async () => {
		const target = ready();
		const { ctx } = context(target, { approvalAuthority: "session", approvalConfirm: "tap" });
		await run(approveKey.press(await loaded(approveKey, ctx), ctx, hold(0)));
		expect(target.machine.respond).toHaveBeenCalledWith("ready", "req", "acceptForSession");
	});

	it("allows after a 600 ms hold, and not after 100 ms", async () => {
		const target = ready();
		const { ctx } = context(target, { approvalAuthority: "always" });
		const state = await loaded(approveKey, ctx);
		expect(approveKey.press(state, ctx, hold(100)).kind).toBe("needsHold");
		await run(approveKey.press(state, ctx, hold(600)));
		expect(target.machine.respond).toHaveBeenCalledWith("ready", "req", "acceptAlways");
	});

	it("takes a click as the confirmation", async () => {
		const target = ready();
		const { ctx } = context(target, { approvalAuthority: "once" });
		await run(approveKey.press(await loaded(approveKey, ctx), ctx, { heldMs: 0, confirmBy: "click" }));
		expect(target.machine.respond).toHaveBeenCalledOnce();
		expect(target.machine.respond).toHaveBeenCalledWith("ready", "req", "accept");
	});

	it("opens the thread when the authority is open or the request can't be answered", async () => {
		for (const [target, settings] of [
			[ready(), {}],
			[waiting("other", { type: "unsupported", threadId: "other", requestId: "req", heading: "Tool call" }), { approvalAuthority: "once" }],
		] as const) {
			const { ctx, openThread } = context(target, settings);
			await run(approveKey.press(await loaded(approveKey, ctx), ctx, hold(0)));
			expect(openThread).toHaveBeenCalledWith(target);
		}
	});

	it("fails with why when the thread is gone at press time", async () => {
		const { ctx } = context(undefined, { approvalAuthority: "once" });
		expect(approveKey.press(approveKey.state(ctx), ctx, hold(0))).toEqual({ kind: "fail", label: t("reason.nothingPending") });
	});
});

describe("Deny press", () => {
	it("declines", async () => {
		const target = waiting("ready", approval("ready"));
		const { ctx } = context(target, {});
		await run(denyKey.press(await loaded(denyKey, ctx), ctx, hold(0)));
		expect(target.machine.respond).toHaveBeenCalledWith("ready", "req", "decline");
	});

	it("fails while loading and when nothing is pending", () => {
		const loading = context(waiting("loading", never), {});
		expect(denyKey.press(denyKey.state(loading.ctx), loading.ctx, hold(0))).toEqual({ kind: "fail", label: t("result.loading") });
		const none = context(undefined, {});
		expect(denyKey.press(denyKey.state(none.ctx), none.ctx, hold(0))).toEqual({ kind: "fail", label: t("reason.nothingPending") });
	});

	it("opens the thread for a request the deck can't answer", async () => {
		const target = waiting("other", { type: "unsupported", threadId: "other", requestId: "req", heading: "Tool call" });
		const { ctx, openThread } = context(target, {});
		await run(denyKey.press(await loaded(denyKey, ctx), ctx, hold(0)));
		expect(openThread).toHaveBeenCalledWith(target);
	});
});

describe("availability with no thread", () => {
	it("counts every machine, not just the key's own", () => {
		const { ctx } = context<ApproveSettings>(undefined, {});
		const runtime = { ...ctx.runtime, machines: () => [machine({ url: "http://a:1", canOperate: false }), machine({ url: "http://b:2", canOperate: true })] } as KeyRuntime;
		const pinned = { ...ctx, machine: "http://a:1", runtime };
		expect(approveKey.state(pinned).check).toEqual({ available: false, reason: t("reason.nothingPending") });
		expect(denyKey.state(pinned).check).toEqual({ available: false, reason: t("reason.nothingPending") });
	});
});
