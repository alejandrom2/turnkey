# Contributing to Turnkey

Thanks for helping. Turnkey is a small, independent project, and bug reports, fixes, translations and ideas are all welcome.

## Ways to help

- **Found a bug?** Open an issue with the bug form. The export from **Turnkey settings → Diagnostics → Export diagnostics** helps a lot; it leaves out tokens and pair links.
- **Have an idea?** Start a thread in [Discussions → Ideas](../../discussions/categories/ideas). Talking it through first saves you from building something that doesn't fit, and it's a good place to sketch how it would look on keys and dials.
- **Want to fix something?** Small, focused fixes can go straight to a pull request. For bigger changes or new actions, say hello in an issue or discussion first so we can agree on the shape.
- **Speak another language?** Corrections to the translations in `com.alejandrom2.turnkey.sdPlugin/<language>.json` are very welcome. They were machine-made.

## Setting up

You need Node 24, the [Stream Deck app](https://www.elgato.com/downloads) 7.6 or newer, and [T3 Code](https://github.com/pingdotgg/t3code) running somewhere you can pair with.

```sh
npm install
npx streamdeck link com.alejandrom2.turnkey.sdPlugin
npm run watch          # rebuilds and restarts the plugin as you edit
```

For the Logitech plugin you also need the .NET 10 SDK and `dotnet tool install --global LogiPluginTool` (on macOS with Homebrew's .NET, set `DOTNET_ROOT` to its `libexec`). `npm run logi:pack` builds the sidecar and the C# plugin and packs `logi/dist/Turnkey.lplug4`. Logi Plugin Service ships Node 22, which runs the sidecar; a system Node is the fallback. After changing an action's English text in `logi/TurnkeyPlugin/`, regenerate the template with `logiplugintool xliff Turnkey <dir>` (Logi Plugin Service running), drop its `<header>`, and run `npm run assets` to regenerate the translations.

Turn on Stream Deck's developer mode (`npx streamdeck dev`) if linking complains. Then open any Turnkey action's settings and pair with a link from T3 Code (Settings → Sharing & access → Create link).

## How the code is laid out

- `src/core/` has no Stream Deck dependency: the client API in `t3/` (pairing, RPC socket, shell reducer, `Machine`), the thread board, commands, and SVG rendering. `npm test` covers it without a Stream Deck.
- `src/actions/` maps SDK events onto it.
- `scripts/` generates the manifest images, settings pages and profiles. Turnkey's mark (three stacked keys, the front one turning with a prompt whose cursor is a spark in T3 Code's blue) is drawn flat by `scripts/icons.ts`, and the category icon is the same mark in plain white. The logo (`docs/logo.png`) and the app icon (`imgs/plugin/marketplace.png`) are the same keys rendered in Blender. They, the README's images in `docs/marketplace/` and `docs/social-preview.png` come from a private repository (turnkey-marketing), which also keeps the rest of the Marketplace listing's media, because they're rendered from Elgato's Stream Deck + model.
- Logs are in `com.alejandrom2.turnkey.sdPlugin/logs/`. Keep the log level below `trace`, because trace would log access tokens.

The visual style follows Stream Deck's native agent plugins: flat near-black keys, one white line glyph, a single status accent, and a gradient touch strip. The glyphs and art are drawn for this plugin.

To try a build without linking, `npx streamdeck pack com.alejandrom2.turnkey.sdPlugin` makes a `.streamDeckPlugin` you can double-click.

## Before you open a pull request

```sh
npm run typecheck
npm test
npx oxlint src
npm run assets        # regenerates settings pages, icons, profiles and the manifest version: commit what it changes
npm run build
npx streamdeck validate com.alejandrom2.turnkey.sdPlugin
npm run logi:pack     # needs .NET 10 and LogiPluginTool
```

CI runs the same checks.

A few house rules keep the plugin consistent:

- **Every user-facing string** goes in `en.json` and in all seven translations. The i18n test fails if a key is missing. A best-effort translation is fine; mention it in the PR.
- **Settings pages, icons and profiles are generated** by `scripts/`. Edit the scripts, not the generated files.
- **American English** in code, comments and copy. T3 Code's own wire values stay as T3 Code spells them.
- **A press that works shows no confirmation**: the key or strip just shows its new state. Failures say why. Anything destructive asks for a hold.
- **No polling while actions are hidden**, and animation follows the Motion setting.
- **Don't copy anyone's art.** Icons come from Lucide (the set T3 Code uses) or are drawn in code.

## Commits and pull requests

Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org): `fix: the Power dial no longer flashes red without a fast mode`, `feat: …`, `docs: …`. Pull requests are squash-merged, so the title becomes the commit and the release note. `git config core.hooksPath .githooks` checks your messages locally.

Keep a pull request to one change. For anything you can see on a key or strip, add a photo or short video from your Stream Deck, and say which model you tested on.

## Releases

`feat:` adds a minor version, `fix:` a patch, and `!` or `BREAKING CHANGE:` a major once past 1.0. On every push to main, release-please keeps a release pull request open with the next version and its changelog. Merging it lets the release workflow tag that version (`vX.Y.Z`); every `v*` tag, from the workflow or pushed by hand, runs the publish workflow, which checks the tag matches `package.json`, packs `Turnkey.streamDeckPlugin` with Stream Deck's four-part version (`0.9.0` → `0.9.0.0`) and creates the GitHub Release with that version's changelog section. `npm run assets` keeps the manifest's version in step with `package.json`.

## Using a coding agent

Agent-written pull requests are welcome too. Point your agent at [AGENTS.md](AGENTS.md), check what it did on a real device, and mention the model and tool you used in the PR.

## Code of conduct

Be kind and assume good intent. Harassment or personal attacks aren't welcome here.
