# Turnkey for agents

Turnkey for T3 Code is a Stream Deck (+) plugin that controls [T3 Code](https://github.com/pingdotgg/t3code) through T3 Code's own client API (pair link → Bearer session → WebSocket RPC). It is independent of T3 Code and Elgato. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the README first.

## Where things live

- `src/core/`: logic with no Stream Deck dependency. The client API is in `src/core/t3/`, drawing in `render.ts`, `strip.ts`, `styles.ts`, `slider.ts` and `gauge.ts`, and usage and limits (ported from T3 Code, MIT) in `usage/`.
- `src/actions/`: Stream Deck actions. `base.ts` holds `DeckAction`, `run()`, `flash()`, `guard()` and the Target setting; `strip.ts` holds the dials.
- `scripts/`: generators for the settings pages (`ui.ts`), icons, profiles and the version. Never hand-edit `com.alejandrom2.turnkey.sdPlugin/ui/*.html`, `imgs/` or `profiles/`.
- `com.alejandrom2.turnkey.sdPlugin/<lang>.json`: every user-facing string, in eight languages.

## Rules

- Every user-facing string goes in `en.json` and all seven translations; `src/core/i18n.test.ts` enforces matching keys and placeholders.
- A successful press shows no confirmation card: `run()` repaints the live face. Failures flash why. Destructive actions need a hold (`HOLD_CONFIRM_MS`).
- Colors come from `COLORS` and the paint helpers in `render.ts`. Approvals are T3 Code's amber, questions its indigo. Never orange.
- Stream Deck's SVG renderer draws a nested `<svg>` or a mask as nothing: keep art flat.
- No polling while actions are hidden, on-demand subscriptions only, and animation follows the Motion setting.
- Never log tokens or pair links, and never raise the log level to `trace`.
- Extra T3 Code access (`providers:manage`, `terminal:operate`, `access:write`, `environment:maintain`) is only ever requested per machine, after the user opts in.
- American English. Tabs. Comments say why, sparingly. No `any`.
- Conventional commit messages; `scripts/commits.ts` checks them in CI.

## Checks

`npm run typecheck` (src and scripts), `npm test`, `npm run lint`, `npm run assets` (commit its changes), `npm run build`, `npx streamdeck validate com.alejandrom2.turnkey.sdPlugin`. Test behavior, not wiring. You can't run a real Stream Deck: say what you couldn't verify.
