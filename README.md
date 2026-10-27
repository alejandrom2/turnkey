# T3 Deck

A Stream Deck plugin for [T3 Code](https://github.com/pingdotgg/t3code). It shows your threads on keys and the Stream Deck + touch strip, and lets you stop turns, send prompts, start threads, adjust model options, and answer agent questions. It works with every provider T3 Code runs (Codex, Claude, Cursor, OpenCode, …), on local and remote environments.

It connects like T3 Code's own web and mobile clients: a pair link, then a live WebSocket feed of your threads. It doesn't read app files or drive the UI.

## Setup

Open any T3 Deck action's settings in Stream Deck. The **Machines** list there shows your machines.

- In T3 Code, open **Settings → Sharing & access** and create a pair link (`http://192.168.1.20:3773/pair#token=…`). Paste it under **Add a machine** and press **Connect**. This works the same for this machine and for others; **this machine** shows up by itself whenever T3 Code runs here, marked **Needs pairing** until you do.
- Each action follows the machine you pick in its card, or **All machines**. Machines are shared, so add each one once.

T3 Deck asks to read threads and act on them, for source control access (git and pull request keys) and to read usage. T3 Code grants what the pair link allows, so a link that only grants reading gives a read-only deck, and a key that needs access the pairing lacks says so; pair again with a new standard link to grant it. Actions that need broader access later ask for it on that machine's next pairing. Pairings last 30 days, then need a new link. T3 Deck appears under **Sharing & access** in T3 Code, which is where you revoke it. **Sign out** only forgets the pairing on this computer, and **Remove** forgets a machine you added.

## Profiles

T3 Deck comes with ready-made profiles. Stream Deck offers them when the plugin is installed, and they stay in its profile list; none switches your deck by itself.

- **T3 Deck** is one page of the everyday set. On Stream Deck +: Activity, Steer, Speed and Model over Send "Continue", New Thread, Stop and Effort, with the Threads, Usage, Power and Skills dials. On the 15-key Stream Deck: four thread keys, Activity, New Thread, Send "Continue", Steer, Stop, Approve, Deny, Model, Effort, Speed and Health. Stream Deck XL adds more threads and the git and usage keys; Stream Deck Mini keeps two threads, Activity, Send "Continue", Stop and Approve; Stream Deck Neo takes the Stream Deck + keys, with Activity on its info bar.
- **T3 Deck (All actions)** has every action, a page per area: threads, controls, prompts, skills, git, pull requests, devices, tasks, admin and usage on Stream Deck + and Neo, and fewer, fuller pages on the 15-key Stream Deck and XL. Stream Deck + turns pages with a swipe on the touch strip and Neo with its page buttons; on the 15-key Stream Deck and XL, Stream Deck's own **Previous Page** and **Next Page** keys sit in the bottom corners. Mini has no All actions profile.

On Stream Deck Neo, drag **Activity** or **Usage** onto the info bar. Activity shows the most urgent thread matching its filter, with its state, and dots counting threads that need an approval (amber), have a question (indigo) or are working (blue). Usage shows its period's cost, with tokens under it. The info bar only shows; press a key to act.

## Actions

Most actions act on the **selected thread**: the one you opened last in T3 Code, on the action's machine or across all of them. Opening a thread from the deck, holding a Thread key or turning the Threads dial selects it too, by visiting it in T3 Code. The selected thread's key is lit, and the other thread keys dim their titles.

Stop, Send Prompt, Steer, Quick Prompt, Approve, Deny, Model, Effort, Speed, Permissions, Plan, Organize, Run Skill, Run Script, Share Thread, Stop Workflow, Fork, Merge Back, Open Preview, the Skills dial and the Devices dial can instead aim at one thread: set **Target** to **This thread** and pick it. The key then acts on that thread whatever is selected, even while it is settled or snoozed, and shows a small pin. Once that thread is archived or deleted the key says **Not available** with its name until you pick another.

| Action | Controller | What it does |
|---|---|---|
| Activity | key | The most urgent thread matching a filter (all, needs you, working, unread) and optional project. More Activity keys with the same settings show the next ones. Tap opens it. |
| New Thread | key | Starts a thread in the selected thread's project (no project when nothing is selected), in no project, or in a chosen project. With a prompt it starts working; without one it opens empty in T3 Code. It uses T3 Code's default model and access mode. **Start in: New worktree** starts it in a new worktree from the repository's default branch, as T3 Code's composer does (from origin when the project's **New worktrees start from origin** is on); the branch is named from the prompt, so it needs one. |
| Send Prompt | key | Sends a saved prompt to the selected thread (starts, steers or queues). Hold to interrupt and restart with it. |
| Steer | key | Adds a saved instruction to the selected thread's running turn. |
| Quick Prompt | key | Continue, run tests and fix failures, diagnose and fix, explain the current state, commit, or a custom prompt. Hold restarts, like Send Prompt. |
| Stop | key | Stops the selected thread's running turn. For 30 seconds after the deck stops one, it shows Resume, which sends "Continue" to that thread. |
| Model | key | Switches the selected thread to one model, or to the next of your favorites in T3 Code (star them in its model picker), across providers. Without favorites it steps through the thread's provider's models. Switching provider works as in T3 Code's picker; when T3 Code refuses, the key shows why. Its name shows in the model's color, or white (**Name color**). |
| Effort | key | Sets the reasoning effort, or steps through what the thread's model offers. **Ultrathink**, where Claude offers it, works as in T3 Code: the effort stays, and the deck prefixes its next prompts to that thread with `Ultrathink:` (not slash commands) until you pick another effort or switch to a model without it. Keys and dials that send to it get T3 Code's spectrum frame meanwhile. |
| Speed | key | Toggles fast mode where the model has one (Claude's Fast mode, Codex's Fast tier). |
| Permissions | key | Sets access (Supervised, Auto-accept edits, Auto, Full access), or steps through the modes the provider supports. |
| Plan | key | Switches between Build and Plan. |
| Approve | key | Answers the selected thread's approval as far as its **Approvals** setting allows: open it in T3 Code (default), allow once, for the session, or always. Answering needs a hold unless set to tap. |
| Deny | key | Declines the selected thread's approval with a tap. |
| Thread | key | A board thread. Keys fill by position, left to right and top to bottom, unless a slot is set (or **Selected thread**). Shows status, title and how long the turn has run (4m, 1.5h), tinted amber while it waits for an approval and indigo for a question (T3 Code's colors), red when it failed and green when a finished turn is unseen, with a dot when a failed or stopped turn is unseen, **+N** for messages waiting in its queue, a bot with a count while subagents run, and a small folder mark when it works in its own worktree. Tap opens it in T3 Code, hold selects it. |
| Organize | key | Settle, pin, snooze, archive or mark unread, or wake a snoozed thread. Pin toggles: it lights up while the selected thread is pinned, and pressing it then unpins. Settle and Snooze ask first: by default the first press shows which thread and, for Snooze, for how long (set in its settings, 15 minutes to 1 day; the key shows it too), and a second press goes ahead. Their settings can make it a hold or act right away. **Wake latest snoozed** names the thread snoozed last on the key's machine (or any) and wakes it, as T3 Code's Wake thread does; it is dimmed with **Nothing snoozed** otherwise. |
| Pull Request | key | The selected thread's pull request and its state. Tap opens it in the browser. |
| Branch | key | The selected thread's branch, with its changed files and commits ahead (↑) and behind (↓). Tap opens the thread. |
| Commit | key | Commits the selected thread's changes, or commits and pushes, or also opens a pull request (**Action**). T3 Code writes the message unless you set one. Shows the changed files, or why it can't. |
| Push | key | Pushes the selected thread's branch. Hold to push (**To run**: tap or hold). |
| Create PR | key | Pushes the selected thread's branch and opens a pull request for it. Hold to create. |
| Pull | key | Pulls the selected thread's branch when it is behind its upstream. |
| Fix Findings | key | T3 Code's Fix findings for the selected thread's pull request: its unresolved review threads, review remarks and failing checks, sent to that thread (queued if it is busy). Hold to send. Shows how many findings there are. |
| Explain PR | key | T3 Code's Explain: asks the selected thread to walk through its pull request. |
| Ask about PR | key | Opens the thread that holds the pull request in T3 Code, to ask about it there. |
| Review Guide | key | Writes T3 Code's review guide for the selected thread's pull request, shows its progress, then opens the thread. Needs **Review guides** on in T3 Code. |
| Open in Editor | key | Opens the selected thread's worktree, or its project's folder, in an editor T3 Code found on that machine: the one you pick, or T3 Code's default. A key on a remote machine says where it opens. |
| Open Preview | key | Opens the thread's preview in this computer's browser: the page its preview panel shows (named by its title and host), else its newest HTML render. Dimmed with **No preview** when it has neither. A page on another machine's `localhost` can't be reached from here, so the key says **Only on <machine>** instead of opening it. The deck can't start a preview itself: that takes T3 Code's preview access. |
| Health | key | The connection to the action's machine (or all) and their providers, worst problem first, in T3 Code's words: offline, needs pairing, a provider not found, unavailable, not authenticated, on an unsupported or known broken version, or needing attention, then how many more. With nothing wrong it says connected or read only, and mentions a provider update available or a provider turned off. Tap reconnects. T3 Code doesn't tell clients when T3 Code itself has an update, so Health can't show that yet. |
| Run Task | key | One of T3 Code's scheduled tasks, picked in its settings: its name and when it runs next (in 4m, off, running, on webhook), red when its last run failed. Press runs it now; it keeps its schedule. A task deleted in T3 Code shows as **Not available**. |
| Run Skill | key | One of the thread's provider skills, picked in its settings, with optional text to send after it. Press runs it the way picking it in T3 Code's composer and sending does (`$name`, which T3 Code hands to the provider), under **Confirm before sending**. Codex, Claude and Antigravity list skills, including the repository's own. |
| Stop Workflow | key | Stops the workflows the thread runs, as T3 Code's Lineage panel does; only Claude's can be stopped. Shows how many subagents are out. Hold to stop. |
| Fork | key | Forks the thread from its newest finished reply into a new thread, as its Fork button in T3 Code does, named "… fork", and opens it. |
| Merge Back | key | On a forked thread: merges it back into the thread it came from, and opens that thread. Hold to merge. Says why when the thread isn't a fork or a turn is still running. |
| Update T3 | key | T3 Code's version on the key's machine (this computer's when none is picked). Hold updates it to the newest release on its channel, as T3 Code's Update action does, showing each stage until the server is back on the new version; a desktop app installs its own update and relaunches. A machine T3 Code can't update from a client says **Update by hand**. Needs update access (see below). |
| Run Script | key | One of the project's saved scripts (T3 Code's project actions), picked in its settings: its name and whether it runs. Press runs it in its own terminal on the thread, in the thread's worktree or else the project's folder, as T3 Code's script button does. While it runs, hold stops it (Ctrl-C). Needs terminal access (see below). |
| Share Thread | key | Makes a guest link for the thread, as T3 Code's **Share with guest** does, and copies it; the link also shows in the key's settings while T3 Deck runs. A shared thread shows **Shared** and its guest, in amber while their messages wait for you. Hold stops sharing. Needs Guest links on (**Settings → Labs**), T3 Connect running, and guest link access (see below). |
| Usage | key | A period's API-estimate cost (Past 24h, 7, 30 or 90 days, as on T3 Code's Usage page), with its tokens and sessions, on the key's machine or all of them merged, for every provider or just one (with its mark). Tap reads it again; hold also reloads T3 Code's model prices. |
| Limits | key | One provider's subscription limit window (5-hour, Weekly, Monthly…), pooled across its accounts like T3 Code's **Usage → Limits**: % left (or used) with a bar, a tick where even pace would be, the next reset and the resets banked. Tap refreshes; hold opens T3 Code or uses a reset (see below). |
| Threads Dial | dial | Like Activity: the threads matching a filter (all, needs you, working, unread), project and **From the last** (no limit, 24 hours … 7 days), most urgent first. Rotate selects one (it settles after a short pause), press or tap opens it. The strip shows its provider, title, status and timer or diff, how many messages wait in its queue, and how many subagents run. |
| Power Dial | dial | Controls one setting of the selected thread, picked in its settings: the **model** (your favorites across providers, with each provider's mark), the **effort** (with Ultrathink) or **access** (with T3 Code's mode icons). Rotate previews, press applies; when T3 Code refuses, the strip shows why. Press with nothing to apply, or tap, switches Speed where the model has it. |
| Prompts Dial | dial | Rotate through your prompts, then Quick Prompt's templates (turn them off in settings). Press or tap sends to the selected thread, hold starts a new thread. |
| PR Dial | dial | The open pull requests T3 Code lists, with their checks. Rotate picks one; press runs Fix findings (a hold by default) in the thread linked to it, or in a new thread on a worktree checked out at it; tap opens it in the browser; touch and hold reads its findings. |
| Limits Dial | dial | Every provider's limit windows, with their marks: rotate through them; press or tap refreshes, and holding the press does what the Limits key's hold does. |
| Usage Dial | dial | A period's total, then each model by cost, for every provider or just one (its share then counts against that provider): its provider's mark, cost with its share of the period, tokens, cache hit rate and cost per million tokens. Rotate through them; press or tap reads again, a long press also reloads model prices. |
| Answer Dial | dial | Approvals: the strip shows the request; rotate between the dial's **Approvals** setting and Deny, then hold (or press, if set) to answer. **Approvals** defaults to opening the request in T3 Code; it can allow once, for the session, or always. Questions: pick a choice per question. Tap opens the thread. Requests the deck can't answer open in T3 Code. |
| Queue Dial | dial | The selected thread's queued messages. Rotate picks one; press sends it now, into the running turn where the provider takes steering or as the next turn when nothing runs (which also releases a queue that Stop held); hold removes it. Tap opens the thread. |
| Tasks Dial | dial | T3 Code's scheduled tasks on the dial's machine (or all), with when each runs next. Rotate picks one, press runs it now, tap turns it off, and tapping again turns it back on. |
| Skills Dial | dial | The thread's provider skills. Rotate picks one; press or tap runs it on the thread, under **Confirm before sending**; touch and hold reads its description. |
| Devices Dial | dial | T3 Code's simulators and emulators on the thread's machine and its device hosts, with platform, version and whether each runs (**Open here** when it is open in the thread). Rotate picks one; press starts it, or opens a running one, in the thread's Device panel; hold powers it off. A cloud (EAS) device needs a hold to start, since Expo bills while it runs; a real device can't be powered off. Touch looks for devices again. Turning Devices on and adding hosts happens in T3 Code. |

A key that can't act right now is dimmed, and pressing it says why. A press that works shows no confirmation: the key or strip just shows the new state. Each action's settings list **What this action needs**: every condition it checks (paired, can act, a selected thread, access, what the thread's model offers, a pull request…), met or not, with how to fix what isn't; a saved choice that no longer exists shows as **Not available**. Setting keys (Model, Effort, Permissions) set to one value are highlighted while the thread already has it. Effort shows where it sits on its model's ladder, Model where it sits among your favorites, and Permissions a track of the modes its provider offers, from Supervised to Full access, colored blue through violet to amber; the Power dial's access view uses the same colors. Models and favorites are read again whenever a key's settings open.

**Confirm before sending** (**Advanced**, overridable per action) covers Send Prompt, Steer, Quick Prompt, Run Skill, the Prompts dial and the Skills dial. Model, Effort, Speed, Permissions and the Power dial always apply on the press:

- **Review, then press again** (default): the first press shows what would be sent and to which thread; press again between ¾ of a second and 10 seconds later to go ahead. If anything changed in between, it shows the new review instead. Turning the dial drops a review.
- **Hold to send**: a held press sends. Holding then can't also restart (Send Prompt, Quick Prompt) or start a thread (Prompts dial).
- **Send right away**: a press acts at once.

**Colors** (**Advanced**): Gradient (default) colors each effort level along a ladder in the model's own color, from a light tint up to the color and turning toward violet at the top (blue to violet for providers with a white mark), on the Effort key and the Power dial, and gives each model's slider and Fast its provider's own gradient. Solid and Model color mark only a model's top effort level, in violet or the model's color; Off leaves them plain. Ultrathink always shows T3 Code's spectrum.

**Motion** (**Advanced**): Full (default) spins running threads on keys and strips, pulses keys waiting on you and flashes a thread once when it finishes or fails. The upper half of an effort ladder sparkles on the Effort key and dial; the sparkles twinkle in Full, twinkle slowly in Reduced and stay still when Off. Reduced spins slowly without pulsing. Off keeps every face still.

**Idle pet** (**Advanced**, off by default): on a Stream Deck +, after two minutes without a press, turn or touch, a small robot walks across the longest row of neighboring T3 Deck dial strips, then rests four minutes and walks back, up to three times. Any press, turn or touch on a T3 Deck key or dial sends it away and starts the wait over; presses on other plugins' keys don't count. It follows **Motion**: Full walks with a small bounce, Reduced walks calmly at fewer frames, Off keeps it away. It never draws over keys, a press result, a review card or a strip you are reading. **Preview pet**, beside it, sends it across once now, even while it is off.

Each dial's strip has a style, set under **Advanced → Strip style** in any action's settings and overridable per dial. Classic is the default:

- **Classic**: Elgato's layout, with an icon, the value and a detail line. The Threads dial shows the selected thread's title large, with the next two dimmed below and their status at the right. The Power dial shows effort and access as a slider: the thread's level filled, the one you turned to as a hollow thumb. Models aren't levels, so for models it shows one pill per favorite instead, like the Model key: the thread's filled in its color, the one you turned to outlined. Its bottom row shows Speed on the left and the thread's effort on the right, in its level's color; either can be turned off in the dial's settings, and with nothing left there the pills sit lower.
- **List**: a wheel of the dial's items (threads, models, efforts or access modes, prompts, answers). The heading shows the dial and where you are (`3/12`), the selected item is bold with its glyph between the previous and the next ones, and the last row says what pressing does or why the dial can't act.
- **Carousel**: the selected item as a tile between its dimmed neighbors, with its title below. Turning slides to the next tile. On the Power dial every tile has its short name on the bottom row, sliding with it, and the selected model's name (and its row in List) takes its provider's color: T3 Code's accent for the instance, else the brand color.

Text too long for its line moves once the dial has rested for a second, twice, then stops. **Long text** picks how: scroll sideways (default), roll up line by line, or don't scroll (it fades at the edge). Touch and hold the strip to read the full text, including what the list and carousel leave out; turn the dial to scroll it, and press, touch or wait five seconds to close it. Strip backgrounds follow **Advanced → Dial strips** in any action's settings: Dark (default, a plain near-black), Flow (one picture across neighboring dials), the thread's state (green unseen done, red failed, amber approval, indigo question) or a color of your own, with or without the colored state line. Each dial can override it.

### Usage and limits

Usage keys and dials need T3 Code's usage access, which standard pair links grant; without it they say **Needs usage access**. T3 Code scans its agents' history folders for every read, so the deck reads a period when a key shows it (unless it did in the last minute), every five minutes while one shows, and when you press it; a history folder two machines share counts once, as in T3 Code.

Limits come from T3 Code's live server config: the same pooled figures as **Usage → Limits**, with an account signed in on several machines or through a hub counted once. While a Limits key or dial shows, the deck asks T3 Code to read limits again when it appears, when the figures go stale (15 minutes after the last read, or at a reset, as T3 Code's widget judges it; the face then says **Press to refresh**) and when you press it, at most every five minutes on its own. Nothing is read while none shows.

**Hold to** sets what holding a Limits key (or the dial's press) does:

- **Open Usage in T3 Code** (default): brings T3 Code forward to use a reset there.
- **Use a banked reset**: spends one reset credit on the account T3 Code would refill first, then says which account and what happened. A tap says **Hold to use reset** when there is one to use. This needs T3 Code's provider access, which the deck doesn't ask for by default: choosing it on a machine whose pairing lacks it shows **Needs provider access — re-pair to enable**, and that machine's next pair link asks for it.

### Extra access

Some actions need access a standard pairing doesn't ask for. The deck asks for it only on the machine an action works on, and only once you use the action there: pressing the key (or, for Run Script, picking a script). Until that machine is paired again with a new link, the key says what it needs, like **Needs update access — re-pair to enable**; T3 Code's standard pair links grant all of these when asked.

| Access | Asked for by | What it lets the deck do on that machine |
|---|---|---|
| Provider access | Limits set to **Use a banked reset** | Manage provider accounts, including spending reset credits. |
| Update access | Update T3 | Update T3 Code and restart it. |
| Terminal access | Run Script | Run any command in T3 Code's terminals: shell access to that machine. Terminal status access comes with it, so the key can show whether the script runs. |
| Guest link access | Share Thread | Create guest links, which let someone outside watch a thread for a day and propose messages. |

The **T3 Code** card in any action's settings lists, per machine, the extra access its pairing holds (**Granted**) and what its next pairing will ask for (**Next pairing**). **Don't ask** takes back a pending request. To give up access the pairing already holds, sign out and pair again, or revoke the session in T3 Code under **Sharing & access**.

Board order: needs approval, has a question, running, queued, then unseen failures and completions, then everything else. Unread matches T3 Code: opening a thread from the deck marks it read everywhere.

### Diagnostics

Under **Diagnostics** in any action's settings:

- **Verbose logging** writes more detail to the plugin's log for 24 hours, then turns itself off, across restarts too. It never logs tokens.
- **Open logs folder** shows the plugin's logs.
- **Export diagnostics** saves a file to the logs folder and shows it: plugin, Stream Deck, OS and Node versions, each machine's host, state, access and environment id, how many of each action are on the deck, and the last 50 warnings and errors. Tokens, pair links and full addresses are left out, so it is safe to attach to a bug report.

## Limits

- **Free-text answers and approval feedback** need T3 Code; the dials pick from the offered choices.
- **Opening a thread** uses the desktop app's `t3code://threads/<environment>/<thread>` link. Set **App link** to `t3code-dev` for a dev build. It opens on the machine running Stream Deck. Selecting with the dial or a hold doesn't switch the app's window.
- **Provider icons** for ACP registry agents load from `cdn.agentclientprotocol.com`, as T3 Code's do; until then, or if that fails, the key shows the generic ACP mark.
- **Git keys** act on the selected thread's checkout. Pushing to the default branch always needs a hold, and a pull request from it is refused, where T3 Code would offer a new branch first. Servers from before T3 Code's source control access treat git as plain thread access; the deck still asks for source control access there.
- **Pull request handoffs** are sent straight away: T3 Code puts them in the composer for you to read first, but the composer lives in the app. That's why Fix Findings needs a hold by default, and why **Ask about PR** only opens the thread. The **Review Guide** opens the thread, since there is no link to the guide itself.
- **Open in Editor** uses T3 Code's first available editor as the default; T3 Code also remembers the last one you picked, per browser, which the deck can't see.
- **Usage links**: T3 Code's desktop app has no link to its Usage page yet, so **Open Usage in T3 Code** only brings the app forward.
- **Skills** come from the thread's provider for its checkout. T3 Code's server config leaves a checkout's skills out, so the deck asks for them when a skill key or dial shows the thread, and again after five minutes, as T3 Code's composer does. Skill names T3 Code can't read as a mention (such as `pdf.tools`) aren't offered.
- **Stop Workflow, Fork and Merge Back** read one snapshot of the thread when pressed, for its workflows and runs; their faces use the thread list only.
- **Previews and devices** are read and started, not driven: the deck can't open a new preview tab (that takes T3 Code's preview access), and a device started from the deck runs in the thread's Device panel, which T3 Code shows once you open the panel there.
- **T3 Code updates**: T3 Code doesn't tell clients that a newer T3 Code exists; its own clients update a server to their own version. Update T3 asks npm for the newest release on the server's channel when you hold it, so its face can only show the current version.
- **Script results**: T3 Code runs a script by typing it into a terminal's shell and reports whether something runs there, not how it ended. Run Script shows **Finished** after a run, not its exit code; it has one only when the shell itself exits.
- **Guest links** are shown once, when they are made, so the deck can copy again only a link it made since it started. Pressing a thread shared elsewhere says **Hold to stop sharing**, since a new link would end the current one.
- **Moving a thread to another machine** isn't possible: T3 Code has no way to export a thread or move it between environments yet.
- **Queues**: T3 Code's thread list doesn't count queued messages, so the deck reads a shown thread's queue from one snapshot of that thread when its runs change (while it is queued, stopped, or had messages waiting), and after its own queue presses. A message removed or reordered in T3 Code while the thread's runs stay the same shows on the deck after the next change.
- **Selection** follows the open time T3 Code records, which it keeps for 10 minutes: switching back to a thread you opened in the app a few minutes ago may not move the deck. A read-only pairing selects on the deck only.

## Development

Requires Node 24+ and the Stream Deck app 7.6+ (the first with plugin info bar actions on Stream Deck Neo).

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

## Languages

T3 Deck shows keys, strips, settings pages and its action list in Stream Deck's language: English, German, Spanish, French, Japanese, Korean, Simplified Chinese and Traditional Chinese. Labels from T3 Code itself, such as **Settings → Sharing & access**, stay in English because T3 Code is in English. Thread titles, project and branch names, models, providers and T3 Code's own messages show as T3 Code sends them, and prompts the deck sends to agents stay in English.

The translations are machine-translated. Corrections are welcome: open an issue or a pull request against the language's file.

Every string lives in `com.alejandrom2.t3deck.sdPlugin/en.json`, with one file per language beside it (`de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `zh_CN.json`, `zh_TW.json`). The top-level `Name`, `Description`, `Category` and per-action entries translate the manifest for the Stream Deck app, and `Localization` holds everything drawn on keys, strips and settings pages. Keep keys and `{placeholders}` as they are.

`npm run i18n:check` makes sure every key the code uses exists in `en.json`, none is left unused, the manifest overrides match `manifest.json`, and every language file has exactly English's keys, the same placeholders per key and no empty strings. After changing settings-page copy, run `node scripts/ui.ts`.
