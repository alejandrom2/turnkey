# T3 Deck

A Stream Deck plugin for [T3 Code](https://github.com/pingdotgg/t3code). It shows your threads on keys and the Stream Deck + touch strip, and lets you stop turns, send prompts, start threads, adjust model options, and answer agent questions. It works with every provider T3 Code runs (Codex, Claude, Cursor, OpenCode, …), on local and remote environments.

It connects like T3 Code's own web and mobile clients: a pair link, then a live WebSocket feed of your threads. It doesn't read app files or drive the UI.

## Setup

Open any T3 Deck action's settings in Stream Deck. The **T3 Code** card lists your machines.

- In T3 Code, open **Settings → Sharing & access** and create a pair link (`http://192.168.1.20:3773/pair#token=…`). Paste it under **Add a machine** and press **Connect**. This works the same for this machine and for others; **this machine** shows up by itself whenever T3 Code runs here, marked **Needs pairing** until you do.
- Each action follows the machine you pick in its card, or **All machines**. Machines are shared, so add each one once.

T3 Deck asks to read threads and act on them. A link that only grants reading gives a read-only deck. Pairings last 30 days, then need a new link. T3 Deck appears under **Sharing & access** in T3 Code, which is where you revoke it. **Sign out** only forgets the pairing on this computer, and **Remove** forgets a machine you added.

## Actions

| Action | Controller | What it does |
|---|---|---|
| Thread | key | Board slot N (or the focused thread). Shows status, title and timer, with a dot when a finished turn is unseen. Tap opens it in T3 Code, hold focuses it. |
| Activity | key | The thread that needs you most. Tap opens it. |
| Stop | key | Stops the focused running turn, or the most urgent one. |
| Send Prompt | key | Sends a saved prompt to the focused thread (starts, steers or queues). Hold to interrupt and restart with it. |
| New Thread | key | Starts a thread with a saved prompt in the focused thread's project, or with no project when the board is empty. It uses T3 Code's default model and access mode. |
| Organize | key | Settle, pin, unpin, snooze, archive or mark unread. |
| Threads Dial | dial | Rotate moves focus, press or tap opens. Every other action follows focus. |
| Model Dial | dial | Tap picks a setting: the model, its options as the provider reports them (effort, speed, …), access (Supervised … Full access) and Build/Plan. Rotate previews a value, press applies it. |
| Prompts Dial | dial | Rotate through saved prompts, press sends, hold starts a new thread. |
| Answer Dial | dial | Approvals: rotate between Allow once, Allow for session and Deny, press to answer. Questions: pick a choice per question. Tap opens the thread. Requests the deck can't answer open in T3 Code. |

Board order: needs approval, has a question, running, queued, then unseen failures and completions, then everything else. Unread matches T3 Code: opening a thread from the deck marks it read everywhere.

## Limits

- **Free-text answers and approval feedback** need T3 Code; the dials pick from the offered choices.
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

- `src/core/` has no Stream Deck dependency: the client API in `t3/` (pairing, RPC socket, shell reducer, `Machine`), the thread board, commands, and SVG rendering.
- `src/actions/` maps SDK events onto it.
- `node scripts/icons.ts` and `node scripts/ui.ts` regenerate the manifest images and property inspectors.
- The marketplace icon is a PNG rendered from `imgs/plugin/marketplace.svg`.
- Logs are in `com.alejandrom2.t3deck.sdPlugin/logs/`. Keep the log level below `trace`, because trace would log access tokens.

The visual style follows Stream Deck's native agent plugins: flat near-black keys, one white line glyph, a single status accent, and a gradient touch strip. The glyphs and art are drawn for this plugin.
