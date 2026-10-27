// Writes the property inspectors; every one ends with the shared T3 Code machine card: `node scripts/ui.ts`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "com.alejandrom2.t3deck.sdPlugin", "ui");

// Tokens from T3 Code's dark theme (apps/web/src/index.css) so the card reads like its pairing pages.
const style = `
		<style>
			:root {
				color-scheme: dark;
				--t3-card: #121212;
				--t3-foreground: #f5f5f5;
				--t3-muted: #a3a3a3;
				--t3-border: rgb(255 255 255 / 8%);
				--t3-input: rgb(255 255 255 / 11%);
				--t3-accent: rgb(255 255 255 / 4%);
				--t3-tile: rgb(255 255 255 / 3.5%);
				--t3-primary: #4a68f0;
				--t3-primary: oklch(0.571 0.21 264);
				--t3-success: #34d399;
				--t3-warning: #fbbf24;
				--t3-error: #f87171;
				--t3-font: -apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif;
			}
			main { display: grid; gap: 2px; }
			.hint { color: #a8a8a8; line-height: 1.4; margin: -2px 0 8px 106px; font-size: 9pt; }
			[hidden] { display: none !important; }

			.t3 {
				position: relative; overflow: hidden; margin: 12px 0 4px; padding: 16px;
				border: 1px solid var(--t3-border); border-radius: 14px;
				background: var(--t3-card); color: var(--t3-foreground); font-family: var(--t3-font);
				box-shadow: 0 12px 32px rgb(0 0 0 / 25%);
			}
			.t3::before {
				content: ""; position: absolute; inset: 0 0 auto 0; height: 110px; pointer-events: none;
				background: radial-gradient(22rem 7rem at top, rgb(16 185 129 / 14%), transparent);
			}
			.t3[data-tone="error"]::before { background: radial-gradient(22rem 7rem at top, rgb(239 68 68 / 16%), transparent); }
			.t3 > * { position: relative; }
			.eyebrow { margin: 0; font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--t3-primary); }
			.t3 h2 { margin: 6px 0 0; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
			.lede { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--t3-muted); }
			.label { margin: 16px 0 6px; font-size: 12px; font-weight: 500; }

			/* Machine tiles follow T3 Code's access options: a ring marks the one this action follows. */
			.machines { display: grid; gap: 6px; margin-top: 14px; }
			.machine {
				display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 2px 10px;
				padding: 9px 11px; border-radius: 9px; background: var(--t3-tile); cursor: pointer;
				box-shadow: inset 0 0 0 1px transparent; transition: background-color .12s, box-shadow .12s;
			}
			.machine:hover { background: rgb(255 255 255 / 6%); }
			.machine:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--t3-primary); }
			.machine[aria-checked="true"] { background: color-mix(in srgb, var(--t3-primary) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--t3-primary) 45%, transparent); }
			.machine svg { width: 16px; height: 16px; color: var(--t3-muted); }
			.machine[aria-checked="true"] svg { color: var(--t3-primary); }
			.machine .name { margin: 0; font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.machine .where { margin: 0; font-size: 11px; color: var(--t3-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.machine .actions { display: flex; align-items: center; gap: 4px; }
			.machine .detail { grid-column: 2 / 4; margin: 4px 0 0; font-size: 11px; line-height: 1.4; color: var(--t3-error); }
			.machine .detail.muted { color: var(--t3-muted); }

			.pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; white-space: nowrap; }
			.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
			.pill.ready { color: var(--t3-success); background: rgb(16 185 129 / 12%); }
			.pill.wait { color: var(--t3-warning); background: rgb(245 158 11 / 12%); }
			.pill.muted { color: var(--t3-muted); background: var(--t3-accent); }
			.t3 button.pill { padding: 2px 8px; border: 0; border-radius: 999px; font: 500 11px var(--t3-font); }

			.t3 button, .t3 select, .t3 input { font: 500 12px var(--t3-font); border-radius: 8px; }
			.t3 button { padding: 5px 11px; cursor: pointer; border: 1px solid transparent; transition: background-color .12s, border-color .12s; }
			.t3 button.primary { background: var(--t3-primary); color: #fff; }
			.t3 button.primary:hover { filter: brightness(1.08); }
			.t3 button.primary:disabled { opacity: .5; cursor: default; filter: none; }
			.t3 button.outline { background: transparent; color: var(--t3-foreground); border-color: var(--t3-input); }
			.t3 button.outline:hover { background: var(--t3-accent); }
			.t3 button.ghost { background: transparent; color: var(--t3-muted); padding: 5px 6px; }
			.t3 button.ghost:hover { color: var(--t3-foreground); }
			.t3 button:focus-visible, .t3 select:focus-visible, .t3 input:focus-visible { outline: 2px solid var(--t3-primary); outline-offset: 1px; }

			.add { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--t3-border); }
			.add .label { margin-top: 0; }
			.add input {
				width: 100%; box-sizing: border-box; padding: 7px 9px; color: var(--t3-foreground);
				background: transparent; border: 1px solid var(--t3-input);
			}
			.add input::placeholder { color: var(--t3-muted); }
			.add .controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; }
			.add .access-help { margin: 6px 0 0; font-size: 11px; line-height: 1.4; color: var(--t3-muted); }
			.add .result { margin: 6px 0 0; font-size: 11px; line-height: 1.4; }
			.add .result.error { color: var(--t3-error); }
			.add .result.working { color: var(--t3-muted); }
			.note { margin: 12px 0 0; font-size: 11px; line-height: 1.5; color: var(--t3-muted); }

			details.group { border-top: 1px solid #555; margin-top: 10px; padding-top: 8px; }
			details.group > summary {
				cursor: pointer; margin: 0 0 8px; font-size: 8.5pt; font-weight: 600;
				letter-spacing: .06em; text-transform: uppercase; color: #a8a8a8;
			}
		</style>`;

const card = `
			<section class="t3" id="t3" aria-live="polite">
				<p class="eyebrow">T3 Code</p>
				<h2 id="t3-title">Choose a machine</h2>
				<p class="lede" id="t3-lede">Looking for T3 Code on this machine…</p>
				<div class="machines" id="t3-machines" role="radiogroup" aria-label="Machine for this action"></div>
				<div class="add">
					<p class="label">Add a machine</p>
					<div class="controls">
						<input id="t3-link" type="url" autocomplete="off" spellcheck="false" placeholder="Paste a pair link from Settings → Sharing &amp; access" />
						<button class="primary" id="t3-pair" type="button" disabled>Connect</button>
					</div>
					<p class="access-help">T3 Deck asks to read threads and act on them, within what the link allows. Revoke it in Settings → Sharing &amp; access.</p>
					<p class="result" id="t3-result" hidden></p>
				</div>
				<p class="note">Every machine you add is shared by all T3 Deck actions. Each action follows the machine picked above.</p>
			</section>
			<details class="group">
				<summary>Advanced</summary>
				<sdpi-item label="App link">
					<sdpi-textfield setting="scheme" global placeholder="t3code"></sdpi-textfield>
				</sdpi-item>
				<p class="hint">Use t3code-dev to open threads in a development build.</p>
				<sdpi-item label="Dial strips">
					<sdpi-select setting="stripBackground" global default="t3">
						<option value="t3">T3 Code</option>
						<option value="elgato">Elgato gradient</option>
						<option value="state">Thread state</option>
						<option value="custom">Custom color</option>
					</sdpi-select>
				</sdpi-item>
				<sdpi-item label="Strip color" id="strip-color" hidden>
					<sdpi-color setting="stripColor" global default="#121212"></sdpi-color>
				</sdpi-item>
				<sdpi-item label="State line">
					<sdpi-checkbox setting="stripHairline" global default="true" label="Show the colored line under each strip"></sdpi-checkbox>
				</sdpi-item>
				<p class="hint">Thread state tints a strip green when done, red when failed and amber when it needs you. Each dial can override this in its own settings.</p>
				<sdpi-item label="Strip style">
					<sdpi-select setting="stripStyle" global default="classic">
						<option value="classic">Classic</option>
						<option value="list">List</option>
						<option value="carousel">Carousel</option>
					</sdpi-select>
				</sdpi-item>
				<sdpi-item label="Long text">
					<sdpi-select setting="textScroll" global default="horizontal">
						<option value="horizontal">Scroll sideways</option>
						<option value="vertical">Roll up line by line</option>
						<option value="off">Don't scroll</option>
					</sdpi-select>
				</sdpi-item>
				<p class="hint">List turns through a dial's items like a wheel, Carousel shows each as a tile between its neighbors. Long text moves once the dial rests, twice, then stops; touch and hold the strip to read it all, and turn to scroll.</p>
			</details>`;

/** Shows the element `id` only while `setting` (a global one with `global`) passes `test`, as it is edited and as settings arrive. */
const showWhen = (setting: string, id: string, test: string, global = false) => `
			{
				const field = document.querySelector('[setting="${setting}"]');
				const apply = (value) => { $("${id}").hidden = !((value) => ${test})(value ?? ""); };
				field.addEventListener("valuechange", () => apply(field.value));
				client.${global ? "getGlobalSettings" : "getSettings"}().then((payload) => apply(payload?.settings?.["${setting}"]));
				client.${global ? "didReceiveGlobalSettings" : "didReceiveSettings"}.subscribe(({ payload }) => apply(payload?.settings?.["${setting}"]));
			}`;

/** A dial's own strip background, style and text scroll, over the global ones in Advanced. */
const dialAppearance = `
			<sdpi-item label="Strip">
				<sdpi-select setting="background" default="">
					<option value="">Use global</option>
					<option value="t3">T3 Code</option>
					<option value="elgato">Elgato gradient</option>
					<option value="state">Thread state</option>
					<option value="custom">Custom color</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item label="Strip color" id="background-color" hidden>
				<sdpi-color setting="backgroundColor" default="#121212"></sdpi-color>
			</sdpi-item>
			<sdpi-item label="Style">
				<sdpi-select setting="stripStyle" default="">
					<option value="">Use global</option>
					<option value="classic">Classic</option>
					<option value="list">List</option>
					<option value="carousel">Carousel</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item label="Long text">
				<sdpi-select setting="textScroll" default="">
					<option value="">Use global</option>
					<option value="horizontal">Scroll sideways</option>
					<option value="vertical">Roll up line by line</option>
					<option value="off">Don't scroll</option>
				</sdpi-select>
			</sdpi-item>`;
const dialAppearanceScript = showWhen("background", "background-color", `value === "custom"`);

const script = (extra = "") => `
		<script>
			const client = SDPIComponents.streamDeckClient;
			const send = (event, extra) => client.send("sendToPlugin", { event, ...extra });
			const icons = {
				all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
				local: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
				remote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
			};
			const $ = (id) => document.getElementById(id);
			const el = (tag, className, text) => {
				const node = document.createElement(tag);
				if (className) node.className = className;
				if (text !== undefined) node.textContent = text;
				return node;
			};
			const button = (label, kind, event, url) => {
				const node = el("button", kind, label);
				node.type = "button";
				node.addEventListener("click", (click) => {
					click.stopPropagation();
					send(event, { url });
				});
				return node;
			};

			function tile({ url, icon, name, where, checked, actions = [], detail, detailTone }) {
				const node = el("div", "machine");
				node.setAttribute("role", "radio");
				node.setAttribute("aria-checked", String(checked));
				node.tabIndex = checked ? 0 : -1;
				const select = () => send("selectMachine", { url });
				node.addEventListener("click", select);
				node.addEventListener("keydown", (key) => {
					if (key.key === " " || key.key === "Enter") {
						key.preventDefault();
						select();
					}
				});
				const glyph = el("span");
				glyph.innerHTML = icons[icon];
				const text = el("div");
				text.style.minWidth = "0";
				text.append(el("p", "name", name), el("p", "where", where));
				const right = el("div", "actions");
				right.append(...actions);
				node.append(glyph, text, right);
				if (detail) node.append(el("p", detailTone === "muted" ? "detail muted" : "detail", detail));
				return node;
			}

			const focusLink = () => {
				$("t3-link").focus();
				$("t3-link").select();
			};

			function machineActions(env) {
				const actions = [];
				if (env.state === "ready") {
					actions.push(el("span", env.access === "Can act" ? "pill ready" : "pill muted", env.access === "Can act" ? "Connected" : "Read only"));
					actions.push(button("Sign out", "ghost", "signOut", env.url));
				} else if (env.state === "connecting") {
					actions.push(el("span", "pill muted", "Connecting…"));
				} else if (env.state === "error") {
					actions.push(button("Try again", "primary", "retry", env.url));
				} else {
					const pill = el("button", "pill wait", "Needs pairing");
					pill.type = "button";
					pill.addEventListener("click", (click) => {
						click.stopPropagation();
						focusLink();
					});
					actions.push(pill);
				}
				if (!env.local) actions.push(button("Remove", "ghost", "remove", env.url));
				return actions;
			}

			client.sendToPropertyInspector.subscribe(({ payload }) => {
				if (payload?.event !== "status") return;
				const environments = payload.environments ?? [];
				const selected = environments.some((env) => env.url === payload.selected) ? payload.selected : "";
				const ready = environments.filter((env) => env.state === "ready");
				const failed = environments.some((env) => env.state === "error") || payload.pairing?.state === "error";

				$("t3").dataset.tone = failed ? "error" : "pairing";
				$("t3-title").textContent = environments.length === 0 ? "Connect T3 Deck" : ready.length === 0 ? "Pair T3 Deck" : "Choose a machine";
				$("t3-lede").textContent =
					environments.length === 0
						? "T3 Code isn't running on this machine. Open it, or paste a pair link from another machine below."
						: ready.length === 0
							? "In T3 Code, open Settings → Sharing & access, create a pair link, and paste it below."
							: "This action shows and acts on threads from the machine you pick.";

				const tiles = [];
				if (environments.length > 1 || selected === "") {
					tiles.push(tile({
						url: "",
						icon: "all",
						name: "All machines",
						where: environments.length === 0 ? "None yet" : ready.length + " of " + environments.length + " connected",
						checked: selected === "",
					}));
				}
				for (const env of environments) {
					tiles.push(tile({
						url: env.url,
						icon: env.local ? "local" : "remote",
						name: env.name,
						where: env.where,
						checked: env.url === selected,
						actions: machineActions(env),
						detail: env.state === "error" ? env.message : env.state === "signed-out" ? (env.message ?? "Paste a pair link from this machine below.") : undefined,
						detailTone: env.state === "signed-out" ? "muted" : undefined,
					}));
				}
				$("t3-machines").replaceChildren(...tiles);

				const result = $("t3-result");
				const pairing = payload.pairing ?? { state: "idle" };
				result.hidden = pairing.state === "idle";
				result.className = "result " + pairing.state;
				result.textContent = pairing.state === "error" ? pairing.message : "Connecting with the pair link…";
				if (pairing.state === "idle" && pairedOnce) {
					$("t3-link").value = "";
					pairedOnce = false;
				}
				syncPairButton(pairing.state === "working");
			});

			let pairedOnce = false;
			const syncPairButton = (working = false) => {
				$("t3-pair").disabled = working || !/[#?&]token=./.test($("t3-link").value);
				$("t3-pair").textContent = working ? "Connecting…" : "Connect";
			};
			$("t3-link").addEventListener("input", () => syncPairButton());
			$("t3-pair").addEventListener("click", () => {
				pairedOnce = true;
				send("pair", { link: $("t3-link").value.trim() });
				syncPairButton(true);
			});
			$("t3-link").addEventListener("keydown", (key) => {
				if (key.key === "Enter" && !$("t3-pair").disabled) $("t3-pair").click();
			});
			send("status");${showWhen("stripBackground", "strip-color", `value === "custom"`, true)}${extra}
		</script>`;

const page = (title: string, fields = "", extra = "") => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${title}</title>
		<script src="sdpi-components.js"></script>${style}
	</head>
	<body>
		<main>${fields}${card}
		</main>${script(extra)}
	</body>
</html>
`;

const pages: Record<string, string> = {
	"environments.html": page("T3 Deck"),
	"slot.html": page(
		"Thread",
		`
			<sdpi-item label="Slot">
				<sdpi-select setting="slot" default="">
					<option value="">By key position</option>
					<option value="0">Selected thread</option>
					${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}${i === 0 ? " (most urgent)" : ""}</option>`).join("\n\t\t\t\t\t")}
				</sdpi-select>
			</sdpi-item>
			<p class="hint">By key position fills Thread keys left to right, top to bottom. Threads are ordered: needs approval, has a question, running, then the rest. Tap opens, hold selects.</p>`,
	),
	"activity.html": page(
		"Activity",
		`
			<sdpi-item label="Show">
				<sdpi-select setting="filter" default="all">
					<option value="all">All threads</option>
					<option value="attention">Needs you: approval, question, failure or unread result</option>
					<option value="active">Working or queued</option>
					<option value="unread">Unread</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item label="Project">
				<sdpi-select setting="project" datasource="getProjects" hot-reload loading="Loading projects…" default=""></sdpi-select>
			</sdpi-item>
			<p class="hint">Shows the most urgent matching thread. More Activity keys with the same settings show the next ones, by key position.</p>`,
	),
	"answer.html": page(
		"Answer Dial",
		`
			<sdpi-item label="Approvals">
				<sdpi-select setting="approvalAuthority" default="open">
					<option value="open">Open in T3 Code</option>
					<option value="once">Allow once</option>
					<option value="session">Allow for the session</option>
					<option value="always">Always allow</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item label="To answer">
				<sdpi-select setting="approvalConfirm" default="hold">
					<option value="hold">Hold the dial</option>
					<option value="tap">Press the dial</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint">Turn between this choice and Deny. A request that doesn't offer the choice opens in T3 Code instead. Touch and hold the strip to read a long request in full.</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"send.html": page(
		"Send Prompt",
		`
			<sdpi-item label="Key title">
				<sdpi-textfield setting="title" placeholder="Fix tests"></sdpi-textfield>
			</sdpi-item>
			<sdpi-item label="Prompt">
				<sdpi-textarea setting="prompt" rows="4" placeholder="Run the tests and fix what fails"></sdpi-textarea>
			</sdpi-item>
			<p class="hint">Goes to the thread selected in T3 Code: it starts a turn, or steers or queues behind a running one. Hold the key to interrupt and restart with it.</p>`,
	),
	"steer.html": page(
		"Steer",
		`
			<sdpi-item label="Key title">
				<sdpi-textfield setting="title" placeholder="Keep it small"></sdpi-textfield>
			</sdpi-item>
			<sdpi-item label="Prompt">
				<sdpi-textarea setting="prompt" rows="4" placeholder="Keep the change small and skip the refactor"></sdpi-textarea>
			</sdpi-item>
			<p class="hint">Adds to the selected thread's running turn. It's dimmed while the thread is idle.</p>`,
	),
	"quick.html": page(
		"Quick Prompt",
		`
			<sdpi-item label="Key title">
				<sdpi-textfield setting="title" placeholder="Optional label for this key"></sdpi-textfield>
			</sdpi-item>
			<sdpi-item label="Prompt type">
				<sdpi-select setting="template" default="continue">
					<option value="continue">Continue</option>
					<option value="test">Run tests and fix failures</option>
					<option value="fix">Diagnose and fix</option>
					<option value="explain">Explain the current state</option>
					<option value="commit">Commit your changes</option>
					<option value="custom">Custom prompt</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item label="Custom prompt" id="custom" hidden>
				<sdpi-textarea setting="prompt" rows="4" placeholder="Type the prompt this key sends"></sdpi-textarea>
			</sdpi-item>
			<p class="hint">Goes to the thread selected in T3 Code. Hold the key to interrupt and restart with it.</p>`,
		showWhen("template", "custom", `value === "custom"`),
	),
	"new.html": page(
		"New Thread",
		`
			<sdpi-item label="Create in">
				<sdpi-select setting="destination" default="selected">
					<option value="selected">Selected thread's project</option>
					<option value="scratch">No project</option>
					<option value="project">Chosen project</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item label="Project" id="project" hidden>
				<sdpi-select setting="project" datasource="getLaunchProjects" hot-reload loading="Loading projects…"></sdpi-select>
			</sdpi-item>
			<sdpi-item label="Prompt">
				<sdpi-textarea setting="prompt" rows="4" placeholder="Optional: Review the open pull request"></sdpi-textarea>
			</sdpi-item>
			<sdpi-item label="Thread title">
				<sdpi-textfield setting="title" placeholder="Review PR"></sdpi-textfield>
			</sdpi-item>
			<p class="hint">With a prompt, the thread starts working and the deck selects it. Without one, it opens empty in T3 Code. With no thread selected, it starts with no project. It uses T3 Code's default model and access.</p>`,
		showWhen("destination", "project", `value === "project"`),
	),
	"model.html": page(
		"Model",
		`
			<sdpi-item label="Model">
				<sdpi-select setting="model" datasource="getModels" hot-reload loading="Loading models…" default=""></sdpi-select>
			</sdpi-item>
			<p class="hint">Cycling steps through T3 Code's favorite models, across providers, or the thread's provider's models when you have none. Picking another provider's model hands the thread over, as T3 Code's model picker does.</p>`,
	),
	"effort.html": page(
		"Effort",
		`
			<sdpi-item label="Effort">
				<sdpi-select setting="effort" datasource="getEfforts" hot-reload loading="Loading efforts…" default=""></sdpi-select>
			</sdpi-item>
			<p class="hint">Cycling steps through the efforts the selected thread's model offers. A set effort its model doesn't offer dims the key. Ultrathink doesn't change the effort: like T3 Code, it prefixes the prompts the deck sends to that thread until you pick another effort.</p>`,
	),
	"permissions.html": page(
		"Permissions",
		`
			<sdpi-item label="Access">
				<sdpi-select setting="mode" default="">
					<option value="">Cycle access modes</option>
					<option value="approval-required">Supervised</option>
					<option value="auto-accept-edits">Auto-accept edits</option>
					<option value="auto">Auto</option>
					<option value="full-access">Full access</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint">Applies to the selected thread from its next step. Only the modes its provider supports are offered.</p>`,
	),
	"approve.html": page(
		"Approve",
		`
			<sdpi-item label="Approvals">
				<sdpi-select setting="approvalAuthority" default="open">
					<option value="open">Open in T3 Code</option>
					<option value="once">Allow once</option>
					<option value="session">Allow for the session</option>
					<option value="always">Always allow</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item label="To answer">
				<sdpi-select setting="approvalConfirm" default="hold">
					<option value="hold">Hold the key</option>
					<option value="tap">Tap the key</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint">Answers the selected thread's approval. A request that doesn't offer this choice, or that the deck can't answer, opens in T3 Code. Deny is its own key.</p>`,
	),
	"organize.html": page(
		"Organize",
		`
			<sdpi-item label="Action">
				<sdpi-select setting="organize" default="settle">
					<option value="settle">Settle</option>
					<option value="pin">Pin</option>
					<option value="unpin">Unpin</option>
					<option value="snooze">Snooze</option>
					<option value="archive">Archive</option>
					<option value="mark_unread">Mark unread</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item label="Snooze minutes">
				<sdpi-textfield setting="snoozeMinutes" pattern="\\d+" placeholder="60"></sdpi-textfield>
			</sdpi-item>`,
	),
	"prompts.html": page(
		"Prompts Dial",
		`
			<sdpi-item label="Prompts">
				<sdpi-textarea setting="prompts" rows="6" placeholder="One prompt per line"></sdpi-textarea>
			</sdpi-item>
			<sdpi-item label="Templates">
				<sdpi-checkbox setting="templates" default="true" label="Add Continue, Fix tests, Diagnose, Explain and Commit"></sdpi-checkbox>
			</sdpi-item>
			<p class="hint">Rotate to choose, press to send to the selected thread, hold to start a new thread.</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"threads-dial.html": page(
		"Threads Dial",
		`
			<sdpi-item label="Show">
				<sdpi-select setting="filter" default="all">
					<option value="all">All threads</option>
					<option value="attention">Needs you: approval, question, failure or unread result</option>
					<option value="active">Working or queued</option>
					<option value="unread">Unread</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item label="Project">
				<sdpi-select setting="project" datasource="getProjects" hot-reload loading="Loading projects…" default=""></sdpi-select>
			</sdpi-item>
			<sdpi-item label="From the last">
				<sdpi-select setting="recency" default="all">
					<option value="all">No limit</option>
					<option value="24h">24 hours</option>
					<option value="48h">48 hours</option>
					<option value="3d">3 days</option>
					<option value="7d">7 days</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint">Rotate through the matching threads, most urgent first; the one the dial rests on becomes T3 Code's selection. Press or tap opens it.</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"power.html": page(
		"Power Dial",
		`
			<sdpi-item label="This dial controls">
				<sdpi-select setting="dialControls" default="model">
					<option value="model">Model</option>
					<option value="effort">Effort</option>
					<option value="permissions">Access</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint">Rotate to preview, press to apply to the selected thread. Model turns through T3 Code's favorite models across providers. Press with nothing to apply, or tap, to switch Speed when the model offers it. Ultrathink, where Claude offers it, prefixes the deck's next prompts to the thread.</p>${dialAppearance}`,
		dialAppearanceScript,
	),
};

for (const [name, html] of Object.entries(pages)) writeFileSync(join(dir, name), html);
