import { afterEach, describe, expect, it, vi } from "vitest";

import { machine, thread } from "../actions/testing/fixtures.js";
import type { DeckThread, ThreadBoard } from "../core/board.js";
import { FLASH_MS } from "../core/feedback.js";
import { t } from "../core/i18n.js";
import { approveKey, denyKey } from "../core/keys/decision.js";
import type { KeyDefinition } from "../core/keys/key.js";
import { COLORS, glyph, renderResultKey, renderSkeletonKey, svgImage, svgMarkup } from "../core/render.js";
import type { Decision, PendingRequest } from "../core/t3/machine.js";
import { Keys } from "./keys.js";
import type { SidecarMessage } from "./protocol.js";
import { glyphResult, ringFace } from "./ring.js";
import { logiRuntime } from "./runtime.js";
import { sharedKind } from "./shared.js";

const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

const ALL: Decision[] = ["accept", "acceptForSession", "acceptAlways", "decline"];
let ids = 0;
/** A thread waiting on an approval; each gets its own id, since keys share their loaded requests. */
function waiting(request?: PendingRequest): DeckThread {
	const id = `t${++ids}`;
	const answer = request ?? { type: "approval", threadId: id, requestId: "req", heading: "Run a command", summary: "npm run build", decisions: ALL };
	return thread({ threadId: id, key: `env/${id}`, deck: "approval", pendingRequest: { id: "req", kind: "command", createdAt: "", threadId: id }, machine: machine({ request: answer }) });
}

/** The sidecar's runtime over a board whose selection is `selected.current`. */
function setup(selected: { current: DeckThread | undefined }) {
	const repaint = vi.fn();
	const openThread = vi.fn(async (_thread: DeckThread) => undefined);
	const board = {
		get threads() {
			return selected.current ? [selected.current] : [];
		},
		selectedOn: () => selected.current,
	} as unknown as ThreadBoard;
	const runtime = logiRuntime({ machines: () => [machine()], board, openThread, repaint });
	const warn = vi.fn<(message: string) => void>();
	return { runtime, repaint, openThread, warn };
}

/** The request loads asynchronously: the first face starts it, and the runtime repaints when it lands. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => void vi.useRealTimers());

describe("sharedKind faces", () => {
	const still: KeyDefinition<object, string> = {
		state: (ctx) => ctx.runtime.motion(),
		tile: (motion) => svgImage(144, 144, `<rect class="tile ${motion}"/>`),
		glyph: (motion) => svgImage(144, 144, `<circle class="glyph ${motion}"/>`),
		press: () => ({ kind: "nothing" }),
	};

	it("draws the glyph at 80 px or less and the tile above, as markup, with Motion reduced", () => {
		const kind = sharedKind("still", still, { "": {} }, setup({ current: undefined }).runtime, () => undefined);
		expect(kind.face(0, "", 80)).toBe(svgMarkup(144, 144, `<circle class="glyph reduced"/>`));
		expect(kind.face(0, "", 60)).toBe(svgMarkup(144, 144, `<circle class="glyph reduced"/>`));
		expect(kind.face(0, "", 116)).toBe(svgMarkup(144, 144, `<rect class="tile reduced"/>`));
		expect(kind.face(0, "", 144)).toBe(svgMarkup(144, 144, `<rect class="tile reduced"/>`));
	});

	it("builds a ring glyph from the tile's icon when a key has no glyph, dimmed as the tile dims it", async () => {
		const selected = { current: waiting() as DeckThread | undefined };
		const { runtime } = setup(selected);
		const approve = sharedKind("approve", approveKey, { "": { approvalAuthority: "once" } }, runtime, () => undefined);
		const deny = sharedKind("deny", denyKey, { "": {} }, runtime, () => undefined);
		// While the request loads the tile is a skeleton, with no icon: a dim placeholder glyph stands in, never the tile.
		expect(approve.face(0, "", 80)).toBe(ringFace(COLORS.muted, "chat", { dim: true }));
		expect(approve.face(0, "", 116)).toBe(decoded(renderSkeletonKey()));
		await settle();
		expect(approve.face(0, "", 80)).toBe(ringFace(COLORS.accent, "check"));
		expect(deny.face(0, "", 80)).toBe(ringFace(COLORS.accent, "denyCircle"));
		selected.current = undefined;
		expect(approve.face(0, "", 80)).toBe(ringFace(COLORS.accent, "check", { dim: true }));
		expect(deny.face(0, "", 80)).toBe(ringFace(COLORS.accent, "denyCircle", { dim: true }));
	});

	it("dims a fallback glyph by what the definition says, not by what the tile's markup looks like", () => {
		const draw = (available: boolean | undefined, tile: string) => {
			const key: KeyDefinition<object, string> = {
				state: () => "",
				tile: () => svgImage(144, 144, tile),
				available: available === undefined ? undefined : () => available,
				press: () => ({ kind: "nothing" }),
			};
			return sharedKind("probe", key, { "": {} }, setup({ current: undefined }).runtime, () => undefined).face(0, "", 80);
		};
		const check = `<g opacity=".5">${glyph("check", 0, 0, 24, "#fff")}</g>`;
		// Another key's tile may fade its icon for its own reasons.
		expect(draw(true, check)).toBe(ringFace(COLORS.accent, "check"));
		expect(draw(undefined, check)).toBe(ringFace(COLORS.accent, "check"));
		expect(draw(false, glyph("check", 0, 0, 24, "#fff"))).toBe(ringFace(COLORS.accent, "check", { dim: true }));
	});

	it("draws nothing for a variant it doesn't have, and says so once", () => {
		const { runtime, warn } = setup({ current: waiting() });
		const kind = sharedKind("approve", approveKey, { "": {} }, runtime, warn);
		expect(kind.face(0, "nope", 80)).toBeUndefined();
		expect(kind.press!(0, "nope")).toBeUndefined();
		expect(kind.face(0, "other", 116)).toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
	});
});

describe("sharedKind presses", () => {
	async function approve(settings = { approvalAuthority: "once" }) {
		const selected = { current: waiting() as DeckThread | undefined };
		const { runtime, repaint, warn } = setup(selected);
		const kind = sharedKind("approve", approveKey, { "": settings }, runtime, warn);
		kind.face(0, "", 80);
		await settle();
		return { kind, target: selected.current!, selected, repaint, warn };
	}

	it("takes a Ring click, with no hold time, as the confirmation", async () => {
		const { kind, target, repaint } = await approve();
		kind.press!(0, "");
		await settle();
		expect(target.machine.respond).toHaveBeenCalledExactlyOnceWith(target.threadId, "req", "accept");
		expect(repaint).toHaveBeenCalled();
	});

	it("on a keypad, flashes the hold it needs after a short press, then shows the key again", async () => {
		vi.useFakeTimers();
		const selected = { current: waiting() as DeckThread | undefined };
		const { runtime, repaint } = setup(selected);
		const kind = sharedKind("approve", approveKey, { "": { approvalAuthority: "once" } }, runtime, () => undefined);
		kind.face(0, "", 80);
		await vi.advanceTimersByTimeAsync(0);
		const live = kind.face(0, "", 80);
		kind.press!(0, "", 100);
		expect(selected.current!.machine.respond).not.toHaveBeenCalled();
		expect(kind.face(0, "", 80)).toBe(glyphResult(false, t("result.holdToAllow")));
		expect(kind.face(0, "", 116)).toBe(decoded(renderResultKey({ ok: false, label: t("result.holdToAllow") })));
		expect(kind.label!(0, "")).toBe(t("result.holdToAllow"));
		repaint.mockClear();
		vi.advanceTimersByTime(FLASH_MS);
		expect(repaint).toHaveBeenCalledOnce();
		expect(kind.face(0, "", 80)).toBe(live);
		expect(kind.label!(0, "")).toBeUndefined();
	});

	it("on a keypad, acts after a 600 ms hold", async () => {
		const { kind, target } = await approve();
		kind.press!(0, "", 600);
		expect(target.machine.respond).toHaveBeenCalledExactlyOnceWith(target.threadId, "req", "accept");
	});

	it("says Deny needs a hold in Deny's own words", async () => {
		const selected = { current: waiting() as DeckThread | undefined };
		const { runtime } = setup(selected);
		const kind = sharedKind("deny", denyKey, { "": {} }, runtime, () => undefined);
		kind.face(0, "", 80);
		await settle();
		kind.press!(0, "", 100);
		expect(kind.label!(0, "")).toBe(t("result.holdToDeny"));
		kind.press!(0, "", 600);
		expect(selected.current!.machine.respond).toHaveBeenCalledExactlyOnceWith(selected.current!.threadId, "req", "decline");
	});

	it("flashes why when the thread is gone between paint and press", async () => {
		const { kind, target, selected } = await approve();
		selected.current = undefined;
		kind.press!(0, "");
		expect(target.machine.respond).not.toHaveBeenCalled();
		expect(kind.label!(0, "")).toBe(t("reason.nothingPending"));
		expect(kind.face(0, "", 80)).toBe(glyphResult(false, t("reason.nothingPending")));
	});

	it("clears a flash when a later press succeeds", async () => {
		const { kind, target } = await approve();
		kind.press!(0, "", 100);
		expect(kind.label!(0, "")).toBe(t("result.holdToAllow"));
		kind.press!(0, "", 600);
		await settle();
		expect(target.machine.respond).toHaveBeenCalledOnce();
		expect(kind.label!(0, "")).toBeUndefined();
		expect(kind.face(0, "", 80)).not.toBe(glyphResult(false, t("result.holdToAllow")));
	});

	it("flashes and logs a press T3 Code refuses, naming the kind", async () => {
		const { kind, target, warn } = await approve();
		vi.mocked(target.machine.respond).mockRejectedValueOnce(new Error("timed out"));
		kind.press!(0, "");
		await settle();
		expect(kind.label!(0, "")).toBe(t("failure.timedOut"));
		expect(warn).toHaveBeenCalledExactlyOnceWith("approve: a press failed: timed out");
	});
});

describe("sharedKind in Keys", () => {
	it("draws the keypad's tile and flashes a short hold there, at the size the key appeared at", async () => {
		const selected = { current: waiting() as DeckThread | undefined };
		const { runtime } = setup(selected);
		const sent: SidecarMessage[] = [];
		const keys = new Keys({ approve: sharedKind("approve", approveKey, { "": { approvalAuthority: "once" } }, runtime, () => undefined) }, (message) => sent.push(message));
		keys.handle({ type: "appear", action: "approve:", size: 116 });
		await settle();
		keys.repaint();
		keys.handle({ type: "press", action: "approve:", heldMs: 100 });
		expect(sent.at(-1)).toEqual({ type: "image", action: "approve:", svg: decoded(renderResultKey({ ok: false, label: t("result.holdToAllow") })), label: t("result.holdToAllow") });
	});
});
