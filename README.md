<div align="center">

<img src="docs/logo.png" alt="Turnkey logo: three Stream Deck keys" width="240" height="240">

<h1>Turnkey<br><sub>for T3 Code</sub></h1>

**Control [T3 Code](https://github.com/pingdotgg/t3code) from your Stream Deck or your Logitech mouse.**<br>
See every agent thread, approve and answer from a key, switch models and effort on a dial, and run git and pull request actions without switching to T3 Code.

<a href="https://github.com/alejandrom2/turnkey/releases/latest"><img src="https://img.shields.io/badge/Download-for_Stream_Deck-4a68f0?style=for-the-badge" alt="Download for Stream Deck" height="36"></a>&nbsp;&nbsp;<a href="https://github.com/alejandrom2/turnkey/releases/latest"><img src="https://img.shields.io/badge/Download-for_Logitech-4a68f0?style=for-the-badge" alt="Download for Logitech" height="36"></a>&nbsp;&nbsp;<a href="https://github.com/sponsors/alejandrom2"><img src="https://img.shields.io/badge/Buy_me_an_energy_drink-%E2%9A%A1-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Buy me an energy drink" height="36"></a>

[![CI](https://github.com/alejandrom2/turnkey/actions/workflows/release.yml/badge.svg)](https://github.com/alejandrom2/turnkey/actions/workflows/release.yml)
[![Release](https://img.shields.io/github/v/release/alejandrom2/turnkey?include_prereleases&label=release)](https://github.com/alejandrom2/turnkey/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Guide](docs/guide.md) · [Discussions](https://github.com/alejandrom2/turnkey/discussions) · [Contributing](CONTRIBUTING.md)

<img src="docs/marketplace/gallery-1-threads.png" alt="Turnkey on a Stream Deck +, showing agent threads on its keys" width="800">

</div>

## What it does

<table>
<tr>
<td align="center" width="33%"><img src="docs/readme/threads.png" alt="A thread's key: done, three minutes" width="96"><br><b>Threads on keys and dials</b><br>Status, title and run time for every thread, tinted when one needs you. Tap to open it.</td>
<td align="center" width="33%"><img src="docs/readme/approve.png" alt="The Allow once key for a command approval" width="96"><br><b>Act without switching windows</b><br>Approve, deny or answer agents, send prompts, steer or stop a turn.</td>
<td align="center" width="33%"><img src="docs/readme/model.png" alt="The Model key on Terra 5.6" width="96"><br><b>Model controls</b><br>Model, effort, fast mode, access and plan mode, from keys or the Power dial.</td>
</tr>
<tr>
<td align="center" width="33%"><img src="docs/readme/git.png" alt="A pull request key with one check failing" width="96"><br><b>Git and pull requests</b><br>Commit, push, open a PR, watch its checks and send Fix findings to the thread.</td>
<td align="center" width="33%"><img src="docs/readme/usage.png" alt="A usage key: 72% of the 5-hour limit" width="96"><br><b>Usage and limits</b><br>Cost, tokens and subscription limit windows, as on T3 Code's Usage page.</td>
<td align="center" width="33%"><img src="docs/readme/machines.png" alt="A machine's key: Studio, connected" width="96"><br><b>Every provider and machine</b><br>Codex, Claude, Cursor, OpenCode and the rest, on local and remote T3 Code.</td>
</tr>
</table>

## Supported devices

Each device gets a ready-made Turnkey profile, and you can drag any action onto your own.

<table>
<tr>
<td width="40%"><img src="docs/marketplace/gallery-4-dial.png" alt="The Power dial's strip on a Stream Deck +: model, effort, speed and access mode" width="320"></td>
<td><b>Stream Deck +</b><br>Keys for everyday actions and dials for threads, usage, the Power dial (model, effort and access) and skills. Swipe the touch strip to a menu of folders: Threads, Controls, Prompts, Skills, Git, Pull Requests, Usage and More, each with its own dials.</td>
</tr>
<tr>
<td width="40%" align="center"><img src="docs/readme/threads.png" alt="A thread's key: done, three minutes" width="96"></td>
<td><b>Stream Deck, XL and Mini</b><br>The 15-key Stream Deck has four thread keys and the everyday actions, then pages for threads, controls, skills, git and usage. The XL shows eight threads on its first page, and the Mini fits two threads with Activity, Approve and Stop.</td>
</tr>
<tr>
<td width="40%"><img src="docs/readme/neo.png" alt="A Stream Deck Neo info bar: Fix flaky auth needs approval, two minutes, with one thread waiting and two running" width="320"></td>
<td><b>Stream Deck Neo</b><br>The Stream Deck + pages on keys. The info bar follows the page you're on: the most urgent thread on home, the model in Controls, the branch in Git, the pull request in Pull Requests, the queue in Prompts and the tightest limit in Usage.</td>
</tr>
<tr>
<td width="40%"><img src="docs/readme/ring.png" alt="Turnkey's Actions Ring for T3 Code: hovering the most urgent thread names it, then the Threads, Prompts, Models and Limits folders open in turn, each with a slot hovered: 2 waiting on you · 3 running, Fix tests, Claude · Opus 5.5 and Claude · 5-hour: 47% used" width="320"></td>
<td><b>Logitech Actions Ring</b><br>T3 Code gets its own Actions Ring on an MX mouse or keyboard: the thread that needs you, Continue and Stop, and folders for your threads, quick prompts, models and limits. Each slot shows live state, and hovering names its thread, model or limit. An MX Master 4 buzzes when a thread needs approval, asks a question, finishes or fails.</td>
</tr>
</table>

## See it

https://github.com/user-attachments/assets/64852819-5e90-46e4-a6ac-824dbe0ff64f

<p align="center"><img src="docs/marketplace/gallery-2-approve.png" alt="Allow once and Deny keys for an agent's command approval" width="640"></p>

## Get started

Turnkey connects the way T3 Code's own web and mobile clients do: a pair link, then a live WebSocket feed of your threads. It doesn't read app files or drive the UI, and it talks only to the T3 Code servers you pair it with.

### Stream Deck

You need the Stream Deck app 7.6 or newer on macOS 12+ or Windows 10+, and [T3 Code](https://github.com/pingdotgg/t3code) running on this computer or one you can reach. Turnkey works on the Stream Deck +, the 15-key Stream Deck, XL, Mini and Neo; dials need a Stream Deck +.

1. **Install.** Download `com.alejandrom2.turnkey.streamDeckPlugin` from the [latest release](https://github.com/alejandrom2/turnkey/releases/latest) and double-click it. Stream Deck offers Turnkey's ready-made profiles: pick one, or drag actions from the **Turnkey** category onto your deck.
2. **Create a pair link.** In T3 Code, open **Settings → Sharing & access** and create one.
3. **Connect.** In Stream Deck, open any Turnkey action's settings, paste the link under **Add a machine** and press **Connect**.

Add each machine once; every action can follow one machine or all of them. Pairings last 30 days, and you can revoke Turnkey anytime from **Sharing & access** in T3 Code.

### Logitech

You need Logi Options+ on macOS, an MX mouse or keyboard with the Actions Ring, and T3 Code as above. Haptics need an MX Master 4. Windows isn't tested yet.

1. **Install.** Download `Turnkey_<version>.lplug4` from the [latest release](https://github.com/alejandrom2/turnkey/releases/latest) and open it to install it in Logi Options+.
2. **Pair.** In Options+, Turnkey's actions show a **Pair with T3 Code** banner. Its button opens a Turnkey Settings page on this computer: paste a pair link from T3 Code's **Settings → Sharing & access** and press **Connect**.
3. **Pick the ring.** In Options+, add T3 Code to the Actions Ring and choose its **Default** profile. Rearrange it as you like, or put Turnkey's actions on any other profile. **Turnkey Settings** on the ring reopens the settings page.

The [guide](docs/guide.md) covers every action, the settings window, profiles, extra access and known limits.

## Support Turnkey

Turnkey is free. If it saves you some clicks, an energy drink keeps it going. ⚡

<a href="https://github.com/sponsors/alejandrom2"><img src="https://img.shields.io/badge/Buy_me_an_energy_drink-%E2%9A%A1-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Buy me an energy drink" height="36"></a>

## Contributing

Bug reports, fixes, translations and ideas are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and house rules, and [SECURITY.md](SECURITY.md) to report a vulnerability privately. Turnkey's translations were machine-made, so corrections from native speakers help a lot.

## License

MIT © 2026 Alejandro Martinez. See [LICENSE](LICENSE). Bundled third-party code and assets keep their own licenses: T3 Code (MIT) and Lucide (ISC), in [LICENSES](LICENSES).

<details>
<summary><b>Disclaimer</b>: Turnkey is an independent project, not affiliated with T3 Code or the companies it names.</summary>

<br>

Turnkey is an independent project. It is not affiliated with, endorsed by, or sponsored by T3 Code or its creators, Elgato or Logitech, or by any of the companies below.

T3 Code is a product of T3 Tools Inc. Claude and Claude Code are trademarks of Anthropic, PBC. OpenAI, ChatGPT and Codex are trademarks of OpenAI. Cursor is a trademark of Anysphere, Inc. Grok is a trademark of xAI. Antigravity and Gemini are trademarks of Google LLC. OpenCode, Pi, Muse and any other agent or provider names belong to their respective owners. GitHub is a trademark of GitHub, Inc. Stream Deck is a trademark of Corsair Memory, Inc. Logitech, Logi, Logi Options+, MX Master and Actions Ring are trademarks of Logitech. All other names, logos and brands are the property of their respective owners and are used only to identify the services Turnkey works with.

Provider marks are shown as T3 Code shows them, to identify the agent a thread runs on. Portions of Turnkey (usage and limits math, prompt texts, provider marks) are adapted from T3 Code under the MIT license; see LICENSES/t3code.txt. Icons are from Lucide under the ISC license; see LICENSES/lucide.txt.

Turnkey talks only to the T3 Code servers you pair it with. It sends nothing to its maker, and it doesn't run or bill any AI model itself: your agents' usage stays with your own provider accounts in T3 Code.

</details>
