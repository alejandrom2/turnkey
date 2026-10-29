import { type Availability, availability } from "../availability.js";
import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
import { modeOf } from "../modes.js";
import { findModel } from "../models.js";
import { templatePrompt } from "../prompts.js";
import { COLORS, renderControlKey } from "../render.js";
import { confirmMode } from "../review.js";
import { customPromptFace, PROMPT_GLYPHS, promptFace, ringFace } from "../ring.js";
import type { SendMode } from "../t3/machine.js";
import { canOperate, type KeyContext, type KeyDefinition, LONG_PRESS_MS } from "./key.js";

export type SendSettings = { title?: string; prompt?: string; template?: string; machine?: string; target?: string; thread?: string; threadTitle?: string; confirmSend?: string };

export type SendState = {
	template: ReturnType<typeof modeOf<"send">>;
	text: string;
	label: string | undefined;
	thread: DeckThread | undefined;
	pinned: boolean;
	check: Availability;
};

const isPromptGlyph = (name: unknown): name is keyof typeof PROMPT_GLYPHS => typeof name === "string" && Object.hasOwn(PROMPT_GLYPHS, name);

/** `text` as the host sends it to `thread`: with T3 Code's Ultrathink prefix where the host has it armed. */
const prompted = (ctx: KeyContext<unknown>, thread: DeckThread, text: string): string =>
	ctx.runtime.ultrathink?.prompt(thread.key, findModel(thread.machine.modelConfig, thread.model), text) ?? text;

/**
 * Sends the key's own prompt, or one of a few everyday ones (continue, fix tests, …), to the selected thread. A tap
 * starts, steers or queues it as T3 Code decides; on Stream Deck a long press interrupts and restarts with it.
 */
export const sendKey: KeyDefinition<SendSettings, SendState> = {
	state(ctx) {
		const template = modeOf("send", undefined, ctx.settings);
		const { text, label } = templatePrompt(template, ctx.settings.prompt);
		const { thread, gone, pinned } = ctx.target();
		return { template, text, label: ctx.settings.title || label, thread, pinned, check: availability("send", { thread, gone, canOperate: canOperate(ctx, thread), hasPrompt: text !== "" }) };
	},

	tile({ template, label, check, thread, pinned }, ctx) {
		const ultrathink = thread !== undefined && ctx.runtime.ultrathink?.armed(thread.key, findModel(thread.machine.modelConfig, thread.model)) === true;
		return renderControlKey({ glyph: template === "custom" ? "send" : "spark", primary: true, label, available: check.available, ultrathink, pinned });
	},

	/** Logitech's prompt actions: a template's own glyph, Send's arrow for a written prompt, else a dim chat bubble. */
	glyph({ text }, ctx) {
		const { template } = ctx.settings;
		if (template === "custom") return customPromptFace(text !== "");
		return isPromptGlyph(template) ? promptFace(template) : ringFace(COLORS.muted, "chat", { dim: true });
	},

	press({ template, text, thread, check }, ctx, input) {
		if (!check.available) return { kind: "fail", label: check.reason };
		const target = thread!;
		const send = (mode: SendMode) => target.machine.send(target, prompted(ctx, target, text), mode);
		// Logitech sends on any press, as it always has.
		if (input.confirmBy !== "settings") return { kind: "run", work: () => send("auto") };
		// Under Hold, the hold confirms the send itself, so it can't also mean restart.
		const restart = confirmMode(ctx.settings.confirmSend, ctx.runtime.appearance().confirmSend) !== "hold" && input.heldMs >= LONG_PRESS_MS;
		const asked: SendMode = restart ? "restart" : "auto";
		return {
			kind: "guard",
			guard: {
				scope: JSON.stringify([target.key, text]),
				detail: asked,
				holdHint: t("result.holdToSend"),
				card: () => ({ glyph: template === "custom" ? "send" : "spark", verb: t(asked === "restart" ? "review.restart" : "review.send"), target: target.title, body: text, footer: t("review.pressToSend") }),
			},
			work: (mode) => send(mode as SendMode),
		};
	},
};
