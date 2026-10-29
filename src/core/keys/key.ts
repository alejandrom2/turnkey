import { HOLD_CONFIRM_MS } from "../approvals.js";
import type { DeckThread, ThreadBoard } from "../board.js";
import type { AcpIcons } from "../models.js";
import type { MotionMode } from "../motion.js";
import type { Target } from "../target.js";
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

export type FaceStyle = "tile" | "glyph";
/** "settings": Stream Deck, each key's own Confirm/approval setting. "hold": MX Keypad. "click": Actions Ring, already deliberate. */
export type ConfirmBy = "settings" | "hold" | "click";
export type PressInput = { heldMs: number; confirmBy: ConfirmBy };
export type PressPlan =
  | { kind: "run"; work: () => Promise<unknown> }
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
}

export type KeyContext<S> = {
  settings: S;
  machine: string | undefined;
  runtime: KeyRuntime;
  target(): Target<DeckThread>;
};

export interface KeyDefinition<S, St> {
  state(ctx: KeyContext<S>): St;
  tile(state: St, ctx: KeyContext<S>): string;
  glyph?(state: St, ctx: KeyContext<S>): string;
  label?(state: St, ctx: KeyContext<S>): string | undefined;
  press(state: St, ctx: KeyContext<S>, input: PressInput): PressPlan;
  watch?: ConstructorParameters<typeof MachineWatch>[0];
}

/** Whether an irreversible press may go ahead: "settings" defers to `fromSettings`, the key's own rule. */
export function confirmed(
  input: PressInput,
  fromSettings: () => boolean,
): boolean {
  if (input.confirmBy === "click") return true;
  if (input.confirmBy === "hold") return input.heldMs >= HOLD_CONFIRM_MS;
  return fromSettings();
}
