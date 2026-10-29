# Changelog

## [1.1.1](https://github.com/alejandrom2/turnkey/compare/v1.1.0...v1.1.1) (2026-10-29)


### Fixes

* avoid generated visibility expressions ([#38](https://github.com/alejandrom2/turnkey/issues/38)) ([6dfa7fd](https://github.com/alejandrom2/turnkey/commit/6dfa7fdebb3d2e81af8f132525cb8249c6ec2991))
* hide review comments revealed by overlapping comment markers ([#36](https://github.com/alejandrom2/turnkey/issues/36)) ([6ee0813](https://github.com/alejandrom2/turnkey/commit/6ee08132d0f099aa7cf9890939fbac0cb3b6eeb6))
* reject active markup in registry SVG icons ([#37](https://github.com/alejandrom2/turnkey/issues/37)) ([aa7d1fa](https://github.com/alejandrom2/turnkey/commit/aa7d1fa63a7d39269b965cb573c98d479ee6bea1))

## [1.1.0](https://github.com/alejandrom2/turnkey/compare/v1.0.0...v1.1.0) (2026-10-29)


### Features

* Turnkey runs under OpenDeck, including on Linux ([#28](https://github.com/alejandrom2/turnkey/issues/28)) ([4329cf5](https://github.com/alejandrom2/turnkey/commit/4329cf56cc8f1894a97dc5a25618a11529011415))

## [1.0.0](https://github.com/alejandrom2/turnkey/compare/v0.12.0...v1.0.0) (2026-10-29)

Turnkey 1.0 controls T3 Code from a Stream Deck or a Logitech mouse or keyboard. It pairs with T3 Code the way T3 Code's own web and mobile clients do, and talks only to the T3 Code servers you pair it with.

### Stream Deck

* Every thread on keys and dials: status, run time, diffs, queued messages and subagents, tinted when one needs you.
* Approve, deny or answer agents, send prompts and quick prompts, steer or stop a turn, start, fork and merge back threads.
* Model, effort with Ultrathink, speed, access and plan mode, from keys or the Power dial, across every provider.
* Git and pull requests: commit, push, open a PR, watch its checks and send Fix findings to the thread.
* Usage and limits as T3 Code's Usage page shows them, plus scheduled tasks, devices, health and diagnostics.
* A ready-made profile for the Stream Deck +, the 15-key Stream Deck, XL, Mini and Neo, with folders, that switches in when T3 Code opens. On a Neo, the info bar follows the page.

### Logitech

* T3 Code gets its own Actions Ring on an MX mouse or keyboard: the most urgent thread, Continue, Stop, and folders for your threads, quick prompts, models and limits.
* Each slot shows live state, and hovering names its thread, model or limit.
* An MX Master 4 buzzes when a thread needs approval, asks a question, finishes or fails.
* Every action is also in Logi Options+'s list, for any profile or console.

### Both

* Pair any number of machines with a T3 Code pair link; each action follows one machine or all of them.
* Eight languages: English, German, Spanish, French, Japanese, Korean, and Simplified and Traditional Chinese.
* Downloads keep fixed names, `Turnkey.streamDeckPlugin` and `Turnkey.lplug4`, so the README's buttons always fetch the latest.

### Upgrading from 0.x

* Install over the old version.
* On Logitech, choose T3 Code's **Default** profile again in Options+ to get the new ring and its folders.

Turnkey is an independent project, not affiliated with or endorsed by T3 Code, Elgato or Logitech.

## [0.12.0](https://github.com/alejandrom2/turnkey/compare/v0.11.0...v0.12.0) (2026-10-29)


### Features

* Turnkey for Logitech, sharing Turnkey's core with Stream Deck ([#22](https://github.com/alejandrom2/turnkey/issues/22)) ([6c3db8b](https://github.com/alejandrom2/turnkey/commit/6c3db8b692e4d74dc138c2838f970395741dcbf4))

## [0.11.0](https://github.com/alejandrom2/turnkey/compare/v0.10.0...v0.11.0) (2026-10-28)


### Features

* one Turnkey profile per deck, with folders, that switches in when T3 Code opens ([#19](https://github.com/alejandrom2/turnkey/issues/19)) ([b813115](https://github.com/alejandrom2/turnkey/commit/b813115439fe2247dea1c780940cafc7600e2841))
* the Neo info bar follows the page: model, queue, branch, pull request and limits ([#20](https://github.com/alejandrom2/turnkey/issues/20)) ([37734ad](https://github.com/alejandrom2/turnkey/commit/37734ad5205e889f223d9a2e5f53fa3ceb163a71))
* the plugin is named Turnkey, with "for T3 Code" only as subtext under it ([6956d5b](https://github.com/alejandrom2/turnkey/commit/6956d5b8f87081b397f394bce493e04129ff40ac))

## [0.10.0](https://github.com/alejandrom2/turnkey/compare/v0.9.2...v0.10.0) (2026-10-28)


### Features

* a 3D keycap logo and app icon ([054c592](https://github.com/alejandrom2/turnkey/commit/054c5924fdb2b8c93a478b43d03ec23e4368fe69))
* strips drop the colored state line and its setting ([#13](https://github.com/alejandrom2/turnkey/issues/13)) ([6d8a29e](https://github.com/alejandrom2/turnkey/commit/6d8a29e146e035834e0c1d30bc1e278437af97fa))


### Fixes

* bound caches that grew for days, and finish the audit leftovers ([#11](https://github.com/alejandrom2/turnkey/issues/11)) ([d1f7180](https://github.com/alejandrom2/turnkey/commit/d1f71805c79bba3c4ce187531dac7e45b8b9be0f))

## [0.9.2](https://github.com/alejandrom2/turnkey/compare/v0.9.1...v0.9.2) (2026-10-27)


### Fixes

* audit cleanup — crash and pairing fixes, shared drawing and action code ([#7](https://github.com/alejandrom2/turnkey/issues/7)) ([3d09115](https://github.com/alejandrom2/turnkey/commit/3d09115ebf51cec2d03103f61b297fa67a6a95d3))

## [0.9.1](https://github.com/alejandrom2/turnkey/compare/v0.9.0...v0.9.1) (2026-10-27)


### Maintenance

* Releases now come from a tag: merging a release PR tags the version, and every `v*` tag publishes the GitHub Release with the packed plugin.

## 0.9.0 (2026-10-27)

First private beta of Turnkey for T3 Code.

### Features

* Threads on keys and dials: status, elapsed time, diffs, queued messages and subagents, with status faces, motion and strip styles (Classic, List, Carousel).
* Send, steer, stop, quick prompts, skills, fork and merge back, new threads (in a worktree too), with confirm before sending.
* Model, effort (with Ultrathink), speed, access and plan controls across every favorite model and provider, with model-colored gradients.
* Approvals and questions answered from keys and the Answer dial, as far as each action's approval setting allows.
* Git (commit, push, create PR, pull), pull request actions (fix findings, explain, ask, review guide) and Open in editor or preview.
* Usage and Limits keys and dials, with T3 Code's own figures.
* Scheduled tasks, the queue, devices, health and diagnostics.
* Opt-in extra access per machine: Update T3, Run Script and Share Thread.
* Bundled profiles for Stream Deck +, Neo, 15-key, XL and Mini; the Neo info bar.
* Eight languages: English, German, Spanish, French, Japanese, Korean, and Simplified and Traditional Chinese.
* A settings window for machines, appearance, behavior and diagnostics.
