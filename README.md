# T3 Deck

A Stream Deck plugin for [T3 Code](https://github.com/pingdotgg/t3code). It shows your threads on keys and the Stream Deck + touch strip, and lets you stop turns, send prompts, start threads, adjust model options, and answer agent questions. It works with every provider T3 Code runs (Codex, Claude, Cursor, OpenCode, …), on local and remote environments.

It connects like T3 Code's own web and mobile clients: a pair link, then a live WebSocket feed of your threads. It doesn't read app files or drive the UI.

## Setup

Open any T3 Deck action's settings in Stream Deck. The **T3 Code** card lists your machines.

- In T3 Code, open **Settings → Sharing & access** and create a pair link (`http://192.168.1.20:3773/pair#token=…`). Paste it under **Add a machine** and press **Connect**. This works the same for this machine and for others; **this machine** shows up by itself whenever T3 Code runs here, marked **Needs pairing** until you do.
- Each action follows the machine you pick in its card, or **All machines**. Machines are shared, so add each one once.

T3 Deck asks to read threads and act on them. A link that only grants reading gives a read-only deck. Pairings last 30 days, then need a new link. T3 Deck appears under **Sharing & access** in T3 Code, which is where you revoke it. **Sign out** only forgets the pairing on this computer, and **Remove** forgets a machine you added.

## Actions

Most actions act on the **selected thread**: the one you opened last in T3 Code, on the action's machine or across all of them. Opening a thread from the deck, holding a Thread key or turning the Threads dial selects it too, by visiting it in T3 Code. The selected thread's key has a white outline.

| Action | Controller | What it does |
|---|---|---|
| Activity | key | The most urgent thread matching a filter (all, needs you, working, unread) and optional project. More Activity keys with the same settings show the next ones. Tap opens it. |
| New Thread | key | Starts a thread in the selected thread's project (no project when nothing is selected), in no project, or in a chosen project. With a prompt it starts working; without one it opens empty in T3 Code. It uses T3 Code's default model and access mode. |
| Send Prompt | key | Sends a saved prompt to the selected thread (starts, steers or queues). Hold to interrupt and restart with it. |
| Steer | key | Adds a saved instruction to the selected thread's running turn. |
| Quick Prompt | key | Continue, run tests and fix failures, diagnose and fix, explain the current state, commit, or a custom prompt. Hold restarts, like Send Prompt. |
| Stop | key | Stops the selected thread's running turn. |
| Model | key | Switches the selected thread to one model, or to the next of your favorites in T3 Code (star them in its model picker), across providers. Without favorites it steps through the thread's provider's models. Switching provider works as in T3 Code's picker; when T3 Code refuses, the key shows why. |
| Effort | key | Sets the reasoning effort, or steps through what the thread's model offers. **Ultrathink**, where Claude offers it, works as in T3 Code: the effort stays, and the deck prefixes its next prompts to that thread with `Ultrathink:` (not slash commands) until you pick another effort or switch to a model without it. Keys and dials that send to it get T3 Code's spectrum frame meanwhile. |
| Speed | key | Toggles fast mode where the model has one (Claude's Fast mode, Codex's Fast tier). |
| Permissions | key | Sets access (Supervised, Auto-accept edits, Auto, Full access), or steps through the modes the provider supports. |
| Plan | key | Switches between Build and Plan. |
| Approve | key | Answers the selected thread's approval as far as its **Approvals** setting allows: open it in T3 Code (default), allow once, for the session, or always. Answering needs a hold unless set to tap. |
| Deny | key | Declines the selected thread's approval with a tap. |
| Thread | key | A board thread. Keys fill by position, left to right and top to bottom, unless a slot is set (or **Selected thread**). Shows status, title and timer, with a dot when a finished turn is unseen. Tap opens it in T3 Code, hold selects it. |
| Organize | key | Settle, pin, unpin, snooze, archive or mark unread. |
| Pull Request | key | The selected thread's pull request and its state. Tap opens it in the browser. |
| Branch | key | The selected thread's branch. Tap opens the thread. |
| Health | key | The connection to the action's machine (or all): connected, read only, connecting, needs pairing or the error. Tap reconnects. |
| Threads Dial | dial | Like Activity: the threads matching a filter (all, needs you, working, unread), project and **From the last** (no limit, 24 hours … 7 days), most urgent first. Rotate selects one (it settles after a short pause), press or tap opens it. The strip shows its provider, title, status and timer or diff. |
| Power Dial | dial | Controls one setting of the selected thread, picked in its settings: the **model** (your favorites across providers, with each provider's mark), the **effort** (with Ultrathink) or **access** (with T3 Code's mode icons). Rotate previews, press applies; when T3 Code refuses, the strip shows why. Press with nothing to apply, or tap, switches Speed where the model has it. |
| Prompts Dial | dial | Rotate through your prompts, then Quick Prompt's templates (turn them off in settings). Press or tap sends to the selected thread, hold starts a new thread. |
| Answer Dial | dial | Approvals: the strip shows the request; rotate between the dial's **Approvals** setting and Deny, then hold (or press, if set) to answer. **Approvals** defaults to opening the request in T3 Code; it can allow once, for the session, or always. Questions: pick a choice per question. Tap opens the thread. Requests the deck can't answer open in T3 Code. |

A key that can't act right now is dimmed, and pressing it says why. After a press, the key shows what happened for a moment. Setting keys (Model, Effort, Permissions) set to one value are highlighted while the thread already has it. Models and favorites are read again whenever a key's settings open.

On the dials, text too long for the strip scrolls once the dial has rested for a second, twice, then stops; touch and hold the strip to read it across both lines. Strip backgrounds follow **Advanced → Dial strips** in any action's settings: T3 Code (default), a dark blue-to-violet gradient, the thread's state (green done, red failed, amber needs you) or a colour of your own, with or without the coloured state line. Each dial can override it.

Board order: needs approval, has a question, running, queued, then unseen failures and completions, then everything else. Unread matches T3 Code: opening a thread from the deck marks it read everywhere.

## Limits

- **Free-text answers and approval feedback** need T3 Code; the dials pick from the offered choices.
- **Opening a thread** uses the desktop app's `t3code://threads/<environment>/<thread>` link. Set **App link** to `t3code-dev` for a dev build. It opens on the machine running Stream Deck. Selecting with the dial or a hold doesn't switch the app's window.
- **Provider icons** for ACP registry agents load from `cdn.agentclientprotocol.com`, as T3 Code's do; until then, or if that fails, the key shows the generic ACP mark.
- **Selection** follows the open time T3 Code records, which it keeps for 10 minutes: switching back to a thread you opened in the app a few minutes ago may not move the deck. A read-only pairing selects on the deck only.

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
