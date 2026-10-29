import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scene, STATES, thread } from "../../actions/testing/fixtures.js";
import type { GoldenOptions } from "../../actions/testing/harness.js";
import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
import { QUICK_PROMPTS } from "../prompts.js";
import { COLORS } from "../render.js";
import { customPromptFace, promptFace, ringFace } from "../ring.js";
import { resolveTarget, type TargetSettings } from "../target.js";
import { UltrathinkArming } from "../ultrathink.js";
import type { KeyContext, KeyRuntime, PressInput, PressPlan } from "./key.js";
import { sendKey, type SendSettings } from "./prompt.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z")));
afterEach(() => void vi.useRealTimers());

/** A context as Stream Deck's test deck gives it (Confirm off), or Logitech's with no Ultrathink. */
function context(world: GoldenOptions, settings: SendSettings, options: { confirmSend?: string; ultrathink?: UltrathinkArming | null } = {}): KeyContext<SendSettings> {
	const threads = world.threads ?? [];
	const runtime = {
		board: { threadsOn: () => threads, selectedOn: () => world.selected },
		machines: () => world.machines ?? [...new Set(threads.map((each) => each.machine))],
		appearance: () => ({ confirmSend: options.confirmSend ?? "off" }),
		ultrathink: options.ultrathink === null ? undefined : (options.ultrathink ?? new UltrathinkArming()),
	} as unknown as KeyRuntime;
	const lookup = (key: string) => {
		const found = threads.find((each) => each.key === key);
		return found === undefined ? ({ state: "gone" } as const) : ({ state: "found", thread: found } as const);
	};
	return { settings, machine: undefined, runtime, target: () => resolveTarget<DeckThread>(settings as TargetSettings, () => world.selected, lookup) };
}

const face = (ctx: KeyContext<SendSettings>) => decoded(sendKey.tile(sendKey.state(ctx), ctx));
const plan = (ctx: KeyContext<SendSettings>, input: PressInput = { heldMs: 0, confirmBy: "settings" }): PressPlan => sendKey.press(sendKey.state(ctx), ctx, input);

const prompt = { prompt: "Ship it", title: "Ship" };
const pinnedScene = (): GoldenOptions => {
	const base = scene({ threadId: "pinned-one", title: "Pinned one" });
	const other = thread({ threadId: "other-one", title: "Other one", machine: base.threads![0]!.machine });
	return { threads: [...base.threads!, other], selected: other };
};
const PIN = { target: "thread", thread: "env/pinned-one", threadTitle: "Pinned one" };
const GONE = { target: "thread", thread: "env/gone", threadTitle: "Old thread" };

describe("Send Prompt", () => {
	it.each([
		["no-thread", STATES["no-thread"], {}],
		["read-only", STATES["read-only"], {}],
		["idle", STATES.idle, prompt],
		["running", STATES.running, prompt],
		["no-prompt", STATES.idle, {}],
		["untitled", STATES.idle, { prompt: "Ship it" }],
		["pinned", pinnedScene, { ...PIN, ...prompt }],
		["pinned-gone", pinnedScene, { ...GONE, ...prompt }],
		...(["continue", "test", "fix", "explain", "commit"] as const).map((template) => [`template-${template}`, STATES.idle, { template }] as const),
	] as [string, () => GoldenOptions, SendSettings][])("send-%s", (name, make, settings) => expect(face(context(make(), settings))).toBe(golden(`send-${name}`)));

	it("draws Quick Prompt with its Continue template", () => expect(face(context(STATES.idle(), { template: "continue" }))).toBe(golden("quick-idle")));

	it("sends on a tap, through the key's Confirm setting, what the review shows", async () => {
		const world = scene({ threadId: "send-1" });
		const result = plan(context(world, prompt));
		if (result.kind !== "guard") throw new Error(`expected a guard, got ${result.kind}`);
		expect(result.guard.scope).toBe(JSON.stringify([world.selected!.key, "Ship it"]));
		expect(result.guard.detail).toBe("auto");
		expect(result.guard.holdHint).toBe(t("result.holdToSend"));
		expect(result.guard.card()).toEqual({ glyph: "send", verb: t("review.send"), target: world.selected!.title, body: "Ship it", footer: t("review.pressToSend") });
		await result.work("auto");
		expect(world.selected!.machine.send).toHaveBeenCalledExactlyOnceWith(world.selected, "Ship it", "auto");
	});

	it("restarts on a long press, unless Confirm holds", () => {
		const held = plan(context(scene(), prompt), { heldMs: 600, confirmBy: "settings" });
		if (held.kind !== "guard") throw new Error(`expected a guard, got ${held.kind}`);
		expect(held.guard.detail).toBe("restart");
		expect(held.guard.card().verb).toBe(t("review.restart"));
		const holding = plan(context(scene(), { ...prompt, confirmSend: "hold" }), { heldMs: 600, confirmBy: "settings" });
		expect(holding.kind === "guard" && holding.guard.detail).toBe("auto");
		const globalHold = plan(context(scene(), prompt, { confirmSend: "hold" }), { heldMs: 600, confirmBy: "settings" });
		expect(globalHold.kind === "guard" && globalHold.guard.detail).toBe("auto");
	});

	it("sends the mode a review confirmed", async () => {
		const world = scene();
		const result = plan(context(world, prompt));
		if (result.kind !== "guard") throw new Error(`expected a guard, got ${result.kind}`);
		await result.work("restart");
		expect(world.selected!.machine.send).toHaveBeenCalledExactlyOnceWith(world.selected, "Ship it", "restart");
	});

	it("prefixes Ultrathink where the host armed it", async () => {
		// A model the config doesn't list keeps Ultrathink armed, as before the config loads.
		const world = scene({ model: { instanceId: "unlisted", model: "unlisted" } });
		const arming = new UltrathinkArming();
		arming.arm(world.selected!.key);
		const result = plan(context(world, prompt, { ultrathink: arming }));
		if (result.kind !== "guard") throw new Error(`expected a guard, got ${result.kind}`);
		await result.work("auto");
		expect(world.selected!.machine.send).toHaveBeenCalledExactlyOnceWith(world.selected, "Ultrathink:\nShip it", "auto");
	});

	it("fails with why it can't send", () => {
		expect(plan(context(STATES.idle(), {}))).toEqual({ kind: "fail", label: t("reason.noPrompt") });
		expect(plan(context(STATES["no-thread"](), prompt))).toEqual({ kind: "fail", label: t("reason.noThread") });
		expect(plan(context(STATES["read-only"](), prompt))).toEqual({ kind: "fail", label: t("reason.readOnly") });
	});

	it("sends on Logitech at once, never restarting, held or not", async () => {
		const world = scene();
		for (const input of [{ heldMs: 0, confirmBy: "click" }, { heldMs: 900, confirmBy: "hold" }] as const) {
			const result = plan(context(world, { template: "fix" }, { ultrathink: null }), input);
			if (result.kind !== "run") throw new Error(`expected a run, got ${result.kind}`);
			await result.work();
		}
		expect(world.selected!.machine.send).toHaveBeenNthCalledWith(1, world.selected, QUICK_PROMPTS.fix.text, "auto");
		expect(world.selected!.machine.send).toHaveBeenNthCalledWith(2, world.selected, QUICK_PROMPTS.fix.text, "auto");
	});

	it("draws Logitech's prompt glyphs: the template's, Send's arrow for a written prompt, else a dim chat bubble", () => {
		const glyph = (settings: SendSettings) => {
			const ctx = context(STATES.idle(), settings, { ultrathink: null });
			return sendKey.glyph!(sendKey.state(ctx), ctx);
		};
		expect(glyph({ template: "fix" })).toBe(promptFace("fix"));
		expect(glyph({ template: "custom", prompt: " hi " })).toBe(customPromptFace(true));
		expect(glyph({ template: "custom", prompt: "  " })).toBe(customPromptFace(false));
		expect(glyph({})).toBe(ringFace(COLORS.muted, "chat", { dim: true }));
		expect(glyph({ template: "continue" })).toBe(ringFace(COLORS.muted, "chat", { dim: true }));
	});
});
