import { HOLD_CONFIRM_MS } from "../approvals.js";
import type { DeckThread, ThreadBoard } from "../board.js";
import type { GitStatuses } from "../git.js";
import type { AcpIcons } from "../models.js";
import type { MotionMode, Transitions } from "../motion.js";
import type { ReviewCard } from "../render.js";
import type { SlotIndex } from "../slots.js";
import type { Target } from "../target.js";
import type { UltrathinkArming } from "../ultrathink.js";
import type { Machine } from "../t3/machine.js";
import type { MachineWatch } from "../watch.js";

/** The global strip appearance settings, as the host resolves them. */
export type Appearance = {
	stripBackground?: string;
	stripColor?: string;
	stripStyle?: string;
	textScroll?: string;
	motion?: string;
	idlePet?: string;
	confirmSend?: string;
	maxEffort?: string;
};

/** How long a press counts as a hold rather than a tap. */
export const LONG_PRESS_MS = 500;

export type FaceStyle = "tile" | "glyph";
/** "settings": Stream Deck, each key's own Confirm/approval setting. "hold": MX Keypad. "click": Actions Ring, already deliberate. */
export type ConfirmBy = "settings" | "hold" | "click";
export type PressInput = { heldMs: number; confirmBy: ConfirmBy };
export type PressPlan =
	| { kind: "run"; work: () => Promise<unknown> }
	/** Stream Deck only ("settings"): the key's Confirm setting decides, with this review card, hold hint and scope (any change reviews again). */
	| { kind: "guard"; guard: { scope: string; holdHint: string; card: () => ReviewCard }; work: () => Promise<unknown> }
	| { kind: "fail"; label: string }
	| { kind: "needsHold"; label: string }
	| { kind: "nothing" };

export interface KeyRuntime {
	machines(): readonly Machine[];
	board: ThreadBoard;
	openThread(thread: DeckThread): Promise<void>;
	openExternal(url: string): Promise<void>;
	repaint(): void;
	appearance(): Appearance;
	acpIcons: AcpIcons | undefined;
	/** Stream Deck: the Motion setting. The sidecar always answers "reduced": Logi faces stay still. */
	motion(): MotionMode;
	/** When threads last changed state, for the flash on their faces. */
	transitions: Pick<Transitions, "age">;
	/** How many messages wait in the thread's queue, as far as the host knows. */
	queued(thread: DeckThread): number;
	/** Selects the thread without opening it. */
	selectThread(thread: Pick<DeckThread, "key" | "machine">): void;
	/** The app link scheme T3 Code answers to; undefined for the default. */
	scheme(): string | undefined;
	/** Where the host arms Ultrathink; undefined where it sends no prompts of its own to prefix (Logitech). */
	ultrathink: UltrathinkArming | undefined;
	/** The checkout statuses the git keys and Branch share, read on demand. */
	git: GitStatuses;
	/** Opens a web page in the browser. */
	openUrl(url: string): Promise<void>;
	/** Logs what went wrong in the background, after a press already showed it went ahead. */
	warn(message: string): void;
}

export type KeyContext<S> = {
	settings: S;
	machine: string | undefined;
	runtime: KeyRuntime;
	target(): Target<DeckThread>;
	/** The board slot the host worked out for this key (Stream Deck: by position among its siblings); absent where the settings say. */
	slot?: SlotIndex;
	/** This key on its host, for what a press leaves on its own face: a git action's progress. */
	instance?: string;
};

export interface KeyDefinition<S, St> {
	state(ctx: KeyContext<S>): St;
	tile(state: St, ctx: KeyContext<S>): string;
	glyph?(state: St, ctx: KeyContext<S>): string;
	label?(state: St, ctx: KeyContext<S>): string | undefined;
	/** Whether the key can act now; false dims its Ring glyph. Absent means always. */
	available?(state: St): boolean;
	/** Whether the face animates, so the host should ask for frames. */
	moving?(state: St): boolean;
	press(state: St, ctx: KeyContext<S>, input: PressInput): PressPlan;
	watch?: ConstructorParameters<typeof MachineWatch>[0];
}

/** Whether the machine that owns `thread`, else any machine, may act: with no thread the key's own machine setting is not consulted, as on Stream Deck always. */
export const canOperate = (ctx: KeyContext<unknown>, thread: DeckThread | undefined): boolean =>
	thread !== undefined ? thread.machine.canOperate : ctx.runtime.machines().some((machine) => machine.canOperate);

/** Whether an irreversible press may go ahead: "settings" defers to `fromSettings`, the key's own rule. */
export function confirmed(
	input: PressInput,
	fromSettings: () => boolean,
): boolean {
	if (input.confirmBy === "click") return true;
	if (input.confirmBy === "hold") return input.heldMs >= HOLD_CONFIRM_MS;
	return fromSettings();
}
