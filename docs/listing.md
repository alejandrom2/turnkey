# Marketplace listing

Kept here so the listing, the README and the plugin say the same thing. The plugin stays private until this is submitted.

## Maker

**Name:** Alejandro Martinez

**About:**
> Alejandro Martinez builds small tools for developers who work alongside coding agents. Turnkey brings T3 Code to Stream Deck: thread status at a glance, one-press approvals, and model, effort and git controls on keys and dials.

## Product

**Name:** Turnkey (final once submitted: Maker Console can't rename a product). "for T3 Code" is never part of the name or on its line: where there is room, it sits under the name as subtext; elsewhere the description names T3 Code.

**Category:** Turnkey (Maker Console asks for the plugin's own name)

**Price:** Free.

**License:** no custom EULA, so the Marketplace's standard end-user license applies to the listed plugin. The source on GitHub stays MIT.

**Support:** GitHub issues at https://github.com/alejandrom2/turnkey/issues.

**URL:** add https://github.com/alejandrom2/turnkey to the manifest once the repo is public (validate checks it answers).

**Short description:**
> Control T3 Code from your Stream Deck: see every agent thread, approve and answer from a key, switch models and effort on a dial, and run git and pull request actions without leaving your flow.

## Media

Upload in this order, from `docs/marketplace/` (rendered by the private turnkey-marketing repository):

- **Icon** (288×288): `icon.png`, the logo's keys on black.
- **Thumbnail** (1920×960): `thumbnail.png`.
- **Gallery** (1920×960):
  1. `gallery-1-threads.png`: every agent's thread on the keys.
  2. `gallery-2-approve.png`: Allow once and Deny for a command approval.
  3. `gallery-3-brain.png`: model and effort keys, up to Max.
  4. `gallery-4-dial.png`: the Power dial's strip.
  5. `gallery-5-steer.png`: Steer, Continue and Stop.
  6. `gallery-6-ship.png`: branch, commit, pull request and Fix findings.
  7. `gallery-7-usage.png`: usage and limits on keys and dials.
- **Video** (1920×1080, 39 s, with music): `video.mp4`. The soundtrack is from Suno: commercial use needs it made on a paid plan.

## Permissions

> Turnkey connects only to the T3 Code servers you pair it with, on your network, over Tailscale or through T3 Connect. Pairing grants it a session on that server:
>
> - **Always:** read and operate threads (`orchestration:read`, `orchestration:operate`), read usage (`diagnostics:read`), and commit, push, pull and open pull requests (`source-control:write`).
> - **Only when you turn them on for a server:** spend a banked usage reset (`providers:manage`), update T3 Code (`environment:maintain`), run your project's saved scripts (`terminal:operate`, which runs commands on that server), and create share links (`access:write`). Each one asks you to pair that server again.
>
> Opening a thread, preview or editor starts the T3 Code app, your browser or your editor: on this computer, or on the server for an editor on a remote machine.

## Privacy

> Turnkey collects no analytics and sends nothing to its maker. It stores each server's address and its pairing session in Stream Deck's settings on this computer, and nothing else about you. Removing a server deletes its session. Its logs record server hostnames, connection states and errors, never sessions, pair links, thread titles or prompts. The diagnostics export is a file you save and share yourself.

## Disclaimer

> Turnkey is an independent project. It is not affiliated with, endorsed by, or sponsored by T3 Code or its creators, or by any of the companies below.
>
> T3 Code is a product of T3 Tools Inc. Claude and Claude Code are trademarks of Anthropic, PBC. OpenAI, ChatGPT and Codex are trademarks of OpenAI. Cursor is a trademark of Anysphere, Inc. Grok is a trademark of xAI. Antigravity and Gemini are trademarks of Google LLC. OpenCode, Pi, Muse and any other agent or provider names belong to their respective owners. GitHub is a trademark of GitHub, Inc. Stream Deck is a trademark of Corsair Memory, Inc. All other names, logos and brands are the property of their respective owners and are used only to identify the services Turnkey works with.
>
> Provider marks are shown as T3 Code shows them, to identify the agent a thread runs on. Portions of Turnkey (usage and limits math, prompt texts, provider marks) are adapted from T3 Code under the MIT license; see LICENSES/t3code.txt. Icons are from Lucide under the ISC license; see LICENSES/lucide.txt.
>
> Turnkey talks only to the T3 Code servers you pair it with. It sends nothing to its maker, and it doesn't run or bill any AI model itself: your agents' usage stays with your own provider accounts in T3 Code.
