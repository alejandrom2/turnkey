# Turnkey for agents

Turnkey is a Stream Deck and Logitech plugin that controls [T3 Code](https://github.com/pingdotgg/t3code) through T3 Code's own client API (pair link → Bearer session → WebSocket RPC). It is independent of T3 Code, Elgato and Logitech. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the README first.

## Where things live

- `src/core/`: logic with no Stream Deck dependency. The client API is in `src/core/t3/`, drawing in `render.ts`, `strip.ts`, `styles.ts`, `slider.ts` and `gauge.ts`, and usage and limits (ported from T3 Code, MIT) in `usage/`.
- `src/core/keys/`: shared key definitions (state, tile, optional glyph, label, press plan, watch), one per key. Stream Deck runs them through `SharedKey` (`src/actions/shared.ts`), Logitech through `sharedKind` (`src/logi/shared.ts`).
- `src/actions/`: Stream Deck actions. `base.ts` holds `DeckAction`, `run()`, `flash()`, `guard()` and the Target setting; `strip.ts` holds the dials.
- `src/logi/`: the Logitech sidecar: Turnkey's core over stdin/stdout to the C# plugin.
- `logi/TurnkeyPlugin/`: the Logi Actions SDK plugin. After changing an action's English text, regenerate `localization/Turnkey.xliff` with `logiplugintool xliff Turnkey <dir>` (Logi Plugin Service running, drop its `<header>`), then `npm run assets` regenerates the translations (`scripts/logi.ts`). Logi Plugin Service ships Node 22, which runs the sidecar (a system Node is the fallback).
- `scripts/`: generators for the settings pages (`ui.ts`), icons, profiles and the version. Never hand-edit `com.alejandrom2.turnkey.sdPlugin/ui/*.html`, `imgs/` or `profiles/`.
- `com.alejandrom2.turnkey.sdPlugin/<lang>.json`: every user-facing string, in eight languages.

## Rules

- Every user-facing string goes in `en.json` and all seven translations; `src/core/i18n.test.ts` enforces matching keys and placeholders.
- A successful press shows no confirmation card: `run()` repaints the live face. Failures flash why. Destructive actions on keys need a hold (`HOLD_CONFIRM_MS`); the Actions Ring's open-hover-click is its confirmation, so the Ring never holds, and Logi's existing Stop run and Stop all stay a single press. Opt-in scopes are never requested from Logitech: those keys flash "needs access".
- Golden snapshots in `src/actions/__goldens__/` and `src/logi/__goldens__/` lock every existing face and press. A changed golden is a bug; add goldens only for new faces.
- New Logi variant of a key: shared definition in `src/core/keys/`, register `sharedKind` in `src/logi/kinds.ts`, add a thin C# class (or a Turnkey folder entry for folder-only keys), regenerate the xliff units, then `npm run assets`.
- Colors come from `COLORS` and the paint helpers in `render.ts`. Approvals are T3 Code's amber, questions its indigo. Never orange.
- Stream Deck's SVG renderer draws a nested `<svg>` or a mask as nothing: keep art flat.
- No polling while actions are hidden, on-demand subscriptions only, and animation follows the Motion setting.
- Never log tokens or pair links, and never raise the log level to `trace`.
- Extra T3 Code access (`providers:manage`, `terminal:operate`, `access:write`, `environment:maintain`) is only ever requested per machine, after the user opts in.
- American English. Tabs. Comments say why, sparingly. No `any`.
- Conventional commit messages; `scripts/commits.ts` checks them in CI.

## Checks

`npm run typecheck` (src and scripts), `npm test`, `npm run lint`, `npm run assets` (commit its changes), `npm run build`, `npx streamdeck validate com.alejandrom2.turnkey.sdPlugin`, `npm run logi:pack` (needs .NET 10 and `dotnet tool install --global LogiPluginTool`; on macOS with Homebrew's .NET, point `DOTNET_ROOT` at its `libexec`). Test behavior, not wiring. You can't run a real Stream Deck: say what you couldn't verify.
