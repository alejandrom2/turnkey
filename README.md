# T3 Deck

A Stream Deck plugin for [T3 Code](https://github.com/pingdotgg/t3code). It shows your threads on keys and the Stream Deck + touch strip, and lets you stop turns, send prompts, start threads, adjust model options, and answer agent questions. It works with every provider T3 Code runs (Codex, Claude, Cursor, OpenCode, …), on local and remote environments.

It talks only to T3 Code's public MCP endpoint (`/mcp`), with the same sign-in and permission model as any other outside agent. It doesn't read app files or drive the UI.

## Setup

Open any T3 Deck action's settings in Stream Deck. The **T3 Code** card lists your machines.

- **This machine** shows up by itself whenever T3 Code is running here. Press **Sign in** and approve in the browser.
- **Another machine:** in T3 Code there, open **Settings → Sharing & access** and create a pair link (`http://192.168.1.20:3773/pair#token=…`). Paste it under **Add a machine**, choose what T3 Deck may do, and press **Connect**. The link's one-time code approves the sign-in directly, so no browser is needed.
- Each action follows the machine you pick in its card, or **All machines**. Machines are shared, so add each one once.

Access levels match T3 Code's approval page: **Read only** just watches, **Supervised** or higher lets keys act. Sessions last 30 days. Use **Sign out** on a machine to change its access, and **Remove** to forget a machine you added.

## Actions

| Action | Controller | What it does |
|---|---|---|
| Thread | key | Board slot N (or the focused thread). Shows status, title and timer, with a dot when a finished turn is unseen. Tap opens it in T3 Code, hold focuses it. |
| Activity | key | How many turns are running and how many need you. Tap opens the most urgent. |
| Stop | key | Interrupts the focused running turn, or the most urgent one. |
| Send Prompt | key | Sends a saved prompt to the focused thread (starts, steers or queues). Hold to interrupt and restart with it. |
| New Thread | key | Starts a thread with a saved prompt in the focused thread's project. |
| Organize | key | Settle, pin, unpin, snooze, archive or mark unread. |
| Threads Dial | dial | Rotate moves focus, press or tap opens. Every other action follows focus. |
| Model Dial | dial | Rotate previews a model option value (effort, speed, … as the provider reports them), press applies it to the next run, tap picks the next option. |
| Prompts Dial | dial | Rotate through saved prompts, press sends, hold starts a new thread. |
| Answer Dial | dial | Answers an agent's question choice by choice. For approvals it opens the thread. |

Board order: needs approval, has a question, running, queued, then unseen failures and completions, then everything else.

## Limits

These come from T3 Code's MCP surface:

- **Approvals can't be granted over MCP.** That's by design: approving widens what an agent may do. The deck flags them and opens the thread.
- **No push.** The deck polls every 2 s while a turn runs and every 15 s when idle, only while one of its actions is visible. It long-polls the focused thread so completion shows right away.
- **Opening a thread** uses the desktop app's `t3code://threads/<environment>/<thread>` link. Set **App link** to `t3code-dev` for a dev build. It opens on the machine running Stream Deck.

## Development

Requires Node 24+ and the Stream Deck app 7.1+.

```sh
npm install
npm run build        # bundle to com.alejandrom2.t3deck.sdPlugin/bin
npm test             # core logic, no Stream Deck needed
npx streamdeck link com.alejandrom2.t3deck.sdPlugin
npm run watch        # rebuild + restart the plugin on change
npx streamdeck validate com.alejandrom2.t3deck.sdPlugin
npx streamdeck pack com.alejandrom2.t3deck.sdPlugin
```

- `src/core/` has no Stream Deck dependency: the MCP connection and OAuth, the thread board, commands, and SVG rendering.
- `src/actions/` maps SDK events onto it.
- `node scripts/icons.ts` and `node scripts/ui.ts` regenerate the manifest images and property inspectors.
- The marketplace icon is a PNG rendered from `imgs/plugin/marketplace.svg`.
- Logs are in `com.alejandrom2.t3deck.sdPlugin/logs/`. Keep the log level below `trace`, because trace would log OAuth tokens.

The visual style follows Stream Deck's native agent plugins: flat near-black keys, one white line glyph, a single status accent, and a gradient touch strip. The glyphs and art are drawn for this plugin.
