// Writes the property inspectors; every one ends with the shared T3 Code machine card: `node scripts/ui.ts`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const plugin = join(import.meta.dirname, "..", "com.alejandrom2.t3deck.sdPlugin");
const dir = join(plugin, "ui");

/**
 * Copy comes from en.json's "Localization", written in as English. Elements name their key in `data-i18n` (text) or
 * `data-i18n-<attribute>`; on load the inspector asks the plugin for the current language's table and swaps them.
 */
const messages: { inspector: { card: Record<string, string> } } = JSON.parse(readFileSync(join(plugin, "en.json"), "utf8")).Localization;

const msg = (key: string): string => {
	const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
	if (typeof value !== "string") throw new Error(`en.json has no Localization.${key}`);
	return value;
};

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Closes an opening tag with the key's text as its content: `<p class="hint"${text(key)}</p>`. */
const text = (key: string) => ` data-i18n="${key}">${escape(msg(key))}`;

/** A localized attribute: `label`, `placeholder`, `loading` or `aria-label`. */
const attr = (name: string, key: string) => `${name}="${escape(msg(key))}" data-i18n-${name}="${key}"`;

/** The card's script builds its copy at runtime, so it carries the English table to fall back on. */
const cardStrings = Object.fromEntries(Object.keys(messages.inspector.card).map((name) => [`inspector.card.${name}`, msg(`inspector.card.${name}`)]));

const style = `
		<style>
			:root { color-scheme: dark; --t3-warning: #fcd34d; }
			/* sdpi-components' own font, so plain text matches the fields Stream Deck draws. */
			body { font-family: "Segoe UI", Arial, Roboto, Helvetica, sans-serif; font-size: 9pt; }
			main { display: grid; gap: 2px; }
			.hint { color: #a8a8a8; line-height: 1.4; margin: -2px 0 8px 106px; font-size: 9pt; }
			/* What broader access an action needs, said plainly. */
			.hint.access { color: var(--t3-warning); }
			.hint.error { color: #f87171; }
			[hidden] { display: none !important; }

			/* The machine card in Stream Deck's own idiom: sdpi rows, its field and button grays, its font. */
			.native { width: 100%; box-sizing: border-box; height: 24px; padding: 0 6px; font: inherit; color: #d8d8d8; background: #3d3d3d; border: 0; border-radius: 3px; }
			.native::placeholder { color: #8f8f8f; }
			.link { width: 100%; box-sizing: border-box; padding: 4px 6px; font: inherit; color: #d8d8d8; background: #2d2d2d; border: 1px solid #3d3d3d; border-radius: 3px; }
			button.sd { height: 22px; padding: 0 9px; font: inherit; color: #d8d8d8; background: #3d3d3d; border: 0; border-radius: 3px; cursor: pointer; }
			button.sd:hover { background: #474747; }
			button.sd:disabled { opacity: .45; cursor: default; }
			button.text { padding: 0; font: inherit; color: #8fb3ff; background: none; border: 0; cursor: pointer; }
			.rows { display: grid; gap: 4px; }
			.row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 6px; align-items: center; padding: 5px 6px; background: #353535; border-radius: 3px; }
			.row .name { color: #e8e8e8; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.row .where { color: #8f8f8f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.state { font-size: 8pt; white-space: nowrap; }
			.state::before { content: "●"; margin-right: 4px; }
			.state.ok { color: #40c977; }
			.state.wait { color: var(--t3-warning); }
			.state.muted { color: #8f8f8f; }
			.state.error { color: #f87171; }
			.row .detail { grid-column: 1 / -1; color: #9a9a9a; line-height: 1.35; }
			.row .detail.error { color: #f87171; }
			.row .buttons { grid-column: 1 / -1; display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
			.row > * { min-width: 0; }
			.access { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; margin: 4px 0 2px; padding-top: 5px; border-top: 1px solid #424242; }
			.access .heading { color: #9a9a9a; font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; }
			.access .line { display: flex; justify-content: space-between; gap: 6px; color: #d8d8d8; }
			.access .line .scope { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.access .line .state { flex: none; }
			.access .line.sub { justify-content: flex-end; margin-top: -2px; }
			.pair { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px; }

			details.group { border-top: 1px solid #555; margin-top: 10px; padding-top: 8px; }
			.switch { display: flex; align-items: center; gap: 6px; font-size: 9pt; }
			details.group > summary {
				cursor: pointer; margin: 0 0 8px; font-size: 8.5pt; font-weight: 600;
				letter-spacing: .06em; text-transform: uppercase; color: #a8a8a8;
			}
		</style>`;

const confirmOptions = `
						<option value="review"${text("inspector.confirm.review")}</option>
						<option value="hold"${text("inspector.confirm.hold")}</option>
						<option value="off"${text("inspector.confirm.off")}</option>`;

/** An action's own Confirm before sending, over the global one in Advanced. */
const confirmField = `
			<sdpi-item ${attr("label", "inspector.field.confirm")}>
				<sdpi-select setting="confirmSend" default="">
					<option value=""${text("inspector.background.global")}</option>${confirmOptions.replace(/\t\t\t\t\t\t</g, "\t\t\t\t\t<")}
				</sdpi-select>
			</sdpi-item>`;

/** Elgato's "What this action needs": each condition met (✓), not met (✗) or being checked (⋯), with its fixes. */
const needsStyle = `
		<style>
			details.needs > summary .unmet { color: #f87171; text-transform: none; letter-spacing: 0; }
			.needs ul { list-style: none; margin: 0 0 6px; padding: 0; display: grid; gap: 6px; }
			.needs li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 2px 6px; font-size: 9pt; line-height: 1.35; color: #d8d8d8; }
			.needs li .mark { font-weight: 700; text-align: center; }
			.needs li[data-state="met"] .mark { color: #34d399; }
			.needs li[data-state="unmet"] .mark { color: #f87171; }
			.needs li[data-state="checking"] .mark { color: #a8a8a8; }
			.needs li .fix { grid-column: 2; color: #a8a8a8; }
		</style>`;

const needs = `
			<details class="group needs" id="needs" hidden>
				<summary><span${text("inspector.card.needsTitle")}</span><span class="unmet" id="needs-unmet"></span></summary>
				<ul id="needs-list"></ul>
			</details>`;

const card = `
			<sdpi-item ${attr("label", "inspector.card.machine")}>
				<select class="native" id="t3-machine" ${attr("aria-label", "inspector.card.machineGroup")}></select>
			</sdpi-item>
			<p class="hint" id="t3-lede" aria-live="polite"${text("inspector.card.looking")}</p>
			<sdpi-item ${attr("label", "inspector.card.machines")} id="t3-machines-item" hidden>
				<div class="rows" id="t3-machines" aria-live="polite"></div>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.card.addMachine")}>
				<div class="pair">
					<input class="native" id="t3-link" type="url" autocomplete="off" spellcheck="false" ${attr("placeholder", "inspector.card.linkPlaceholder")} />
					<button class="sd" id="t3-pair" type="button" disabled${text("inspector.card.connect")}</button>
				</div>
			</sdpi-item>
			<p class="hint error" id="t3-result" hidden></p>
			<sdpi-item>
				<button class="sd" id="t3-get-link" type="button"${text("inspector.card.getLink")}</button>
			</sdpi-item>
			<p class="hint"${text("inspector.card.accessHelp")}</p>
			<p class="hint"${text("inspector.card.shared")}</p>
			<details class="group">
				<summary${text("inspector.advanced.title")}</summary>
				<sdpi-item ${attr("label", "inspector.advanced.appLink")}>
					<sdpi-textfield setting="scheme" global placeholder="t3code"></sdpi-textfield>
				</sdpi-item>
				<p class="hint"${text("inspector.advanced.appLinkHint")}</p>
				<sdpi-item ${attr("label", "inspector.advanced.dialStrips")}>
					<sdpi-select setting="stripBackground" global default="t3">
						<option value="t3"${text("inspector.background.t3")}</option>
						<option value="flow"${text("inspector.background.flow")}</option>
						<option value="state"${text("inspector.background.state")}</option>
						<option value="custom"${text("inspector.background.custom")}</option>
					</sdpi-select>
				</sdpi-item>
				<sdpi-item ${attr("label", "inspector.field.stripColor")} id="strip-color" hidden>
					<sdpi-color setting="stripColor" global default="#121212"></sdpi-color>
				</sdpi-item>
				<sdpi-item ${attr("label", "inspector.advanced.stateLine")}>
					<sdpi-checkbox setting="stripHairline" global default="true" ${attr("label", "inspector.advanced.stateLineLabel")}></sdpi-checkbox>
				</sdpi-item>
				<p class="hint"${text("inspector.advanced.stateHint")}</p>
				<sdpi-item ${attr("label", "inspector.advanced.stripStyle")}>
					<sdpi-select setting="stripStyle" global default="">
						<option value=""${text("inspector.style.perDial")}</option>
						<option value="classic"${text("inspector.style.classic")}</option>
						<option value="list"${text("inspector.style.list")}</option>
						<option value="carousel"${text("inspector.style.carousel")}</option>
					</sdpi-select>
				</sdpi-item>
				<sdpi-item ${attr("label", "inspector.field.longText")}>
					<sdpi-select setting="textScroll" global default="horizontal">
						<option value="horizontal"${text("inspector.scroll.horizontal")}</option>
						<option value="vertical"${text("inspector.scroll.vertical")}</option>
						<option value="off"${text("inspector.scroll.off")}</option>
					</sdpi-select>
				</sdpi-item>
				<p class="hint"${text("inspector.advanced.styleHint")}</p>
				<sdpi-item ${attr("label", "inspector.advanced.motion")}>
					<sdpi-select setting="motion" global default="full">
						<option value="full"${text("inspector.motion.full")}</option>
						<option value="reduced"${text("inspector.motion.reduced")}</option>
						<option value="off"${text("inspector.motion.off")}</option>
					</sdpi-select>
				</sdpi-item>
				<p class="hint"${text("inspector.advanced.motionHint")}</p>
				<sdpi-item ${attr("label", "inspector.advanced.idlePet")}>
					<sdpi-select setting="idlePet" global default="off">
						<option value="off"${text("inspector.idlePet.off")}</option>
						<option value="on"${text("inspector.idlePet.on")}</option>
					</sdpi-select>
				</sdpi-item>
				<sdpi-item>
					<sdpi-button id="t3-preview-pet"><span${text("inspector.advanced.previewPet")}</span></sdpi-button>
				</sdpi-item>
				<p class="hint"${text("inspector.advanced.idlePetHint")}</p>
				<sdpi-item ${attr("label", "inspector.advanced.maxEffort")}>
					<sdpi-select setting="maxEffort" global default="gradient">
						<option value="gradient"${text("inspector.maxEffort.gradient")}</option>
						<option value="solid"${text("inspector.maxEffort.solid")}</option>
						<option value="model"${text("inspector.maxEffort.model")}</option>
						<option value="off"${text("inspector.maxEffort.off")}</option>
					</sdpi-select>
				</sdpi-item>
				<p class="hint"${text("inspector.advanced.maxEffortHint")}</p>
				<sdpi-item ${attr("label", "inspector.advanced.confirm")}>
					<sdpi-select setting="confirmSend" global default="review">${confirmOptions}
					</sdpi-select>
				</sdpi-item>
				<p class="hint"${text("inspector.advanced.confirmHint")}</p>
			</details>
			<details class="group">
				<summary${text("inspector.diagnostics.title")}</summary>
				<sdpi-item ${attr("label", "inspector.diagnostics.verbose")}>
					<label class="switch"><input type="checkbox" id="t3-verbose" /><span${text("inspector.diagnostics.verboseLabel")}</span></label>
				</sdpi-item>
				<p class="hint" id="t3-verbose-state"${text("inspector.card.verboseOff")}</p>
				<sdpi-item ${attr("label", "inspector.diagnostics.logs")}>
					<sdpi-button id="t3-open-logs"><span${text("inspector.diagnostics.openLogs")}</span></sdpi-button>
				</sdpi-item>
				<sdpi-item ${attr("label", "inspector.diagnostics.report")}>
					<sdpi-button id="t3-export"><span${text("inspector.diagnostics.export")}</span></sdpi-button>
				</sdpi-item>
				<p class="hint"${text("inspector.diagnostics.exportHint")}</p>
				<p class="hint" id="t3-diagnostics-result" hidden${text("inspector.card.diagnosticsFailed")}</p>
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
			<sdpi-item ${attr("label", "inspector.field.strip")}>
				<sdpi-select setting="background" default="">
					<option value=""${text("inspector.background.global")}</option>
					<option value="t3"${text("inspector.background.t3")}</option>
					<option value="flow"${text("inspector.background.flow")}</option>
					<option value="state"${text("inspector.background.state")}</option>
					<option value="custom"${text("inspector.background.custom")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.stripColor")} id="background-color" hidden>
				<sdpi-color setting="backgroundColor" default="#121212"></sdpi-color>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.style")}>
				<sdpi-select setting="stripStyle" default="">
					<option value=""${text("inspector.background.global")}</option>
					<option value="classic"${text("inspector.style.classic")}</option>
					<option value="list"${text("inspector.style.list")}</option>
					<option value="carousel"${text("inspector.style.carousel")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.longText")}>
				<sdpi-select setting="textScroll" default="">
					<option value=""${text("inspector.background.global")}</option>
					<option value="horizontal"${text("inspector.scroll.horizontal")}</option>
					<option value="vertical"${text("inspector.scroll.vertical")}</option>
					<option value="off"${text("inspector.scroll.off")}</option>
				</sdpi-select>
			</sdpi-item>`;
const dialAppearanceScript = showWhen("background", "background-color", `value === "custom"`);

const script = (extra = "") => `
		<script>
			const client = SDPIComponents.streamDeckClient;
			const send = (event, extra) => client.send("sendToPlugin", { event, ...extra });
			const strings = ${JSON.stringify(cardStrings)};
			const s = (key, params = {}) => (strings[key] ?? key).replace(/\\{(\\w+)\\}/g, (match, name) => (name in params ? String(params[name]) : match));
			const $ = (id) => document.getElementById(id);
			const el = (tag, className, text) => {
				const node = document.createElement(tag);
				if (className) node.className = className;
				if (text !== undefined) node.textContent = text;
				return node;
			};
			const button = (label, kind, event, url, extra = {}) => {
				const node = el("button", kind, label);
				node.type = "button";
				node.addEventListener("click", () => send(event, { url, ...extra }));
				return node;
			};

			const SCOPE_NAMES = {
				"providers:manage": "inspector.card.scopeProviders",
				"environment:maintain": "inspector.card.scopeMaintain",
				"terminal:operate": "inspector.card.scopeTerminal",
				"terminal:read": "inspector.card.scopeTerminalRead",
				"access:write": "inspector.card.scopeShare",
			};
			/** Each opt-in scope on its own line: held by the pairing, or asked for at the next one, with a way to take that back. */
			function optIns(url, optIn) {
				const block = el("div", "access");
				block.append(el("div", "heading", s("inspector.card.optInTitle")));
				for (const { scope, state } of optIn) {
					const line = el("div", "line");
					line.append(el("span", "scope", SCOPE_NAMES[scope] ? s(SCOPE_NAMES[scope]) : scope));
					line.append(el("span", state === "held" ? "state ok" : "state wait", s(state === "held" ? "inspector.card.optInHeld" : "inspector.card.optInPending")));
					block.append(line);
					if (state === "pending") {
						const sub = el("div", "line sub");
						sub.append(button(s("inspector.card.optInDrop"), "text", "unflagScope", url, { scope }));
						block.append(sub);
					}
				}
				return block;
			}

			const focusLink = () => {
				$("t3-link").focus();
				$("t3-link").select();
			};

			const STATE = {
				ready: (env) => (env.access === "Can act" ? ["ok", "inspector.card.connected"] : ["muted", "inspector.card.readOnly"]),
				connecting: () => ["muted", "inspector.card.connecting"],
				error: () => ["error", "inspector.card.tryAgain"],
				"signed-out": () => ["wait", "inspector.card.needsPairing"],
			};

			/** One machine: name, address and state, what went wrong or how to pair, its extra access, then its buttons. */
			function row(env) {
				const node = el("div", "row");
				const text = el("div");
				text.append(el("div", "name", env.name), el("div", "where", env.where));
				const [tone, label] = (STATE[env.state] ?? STATE.connecting)(env);
				node.append(text, el("span", "state " + tone, s(label)));
				if (env.state === "error" && env.message) node.append(el("div", "detail error", env.message));
				if (env.state === "signed-out") node.append(el("div", "detail", env.message ?? s("inspector.card.pasteFromMachine")));
				if (env.optIn?.length) node.append(optIns(env.url, env.optIn));
				const buttons = el("div", "buttons");
				if (env.state === "ready") buttons.append(button(s("inspector.card.signOut"), "sd", "signOut", env.url));
				if (env.state === "error") buttons.append(button(s("inspector.card.tryAgain"), "sd", "retry", env.url));
				if (env.state === "signed-out") {
					buttons.append(button(s("inspector.card.getLinkRow"), "sd", "getPairLink", env.url));
					const paste = el("button", "sd", s("inspector.card.pasteLink"));
					paste.type = "button";
					paste.addEventListener("click", focusLink);
					buttons.append(paste);
				}
				if (!env.local) buttons.append(button(s("inspector.card.remove"), "sd", "remove", env.url));
				if (buttons.childElementCount > 0) node.append(buttons);
				return node;
			}

			const MARKS = { met: "✓", unmet: "✗", checking: "⋯" };
			const STATES = { met: "inspector.card.needsMet", unmet: "inspector.card.needsUnmet", checking: "inspector.card.needsChecking" };
			function renderNeeds(checklist) {
				const items = checklist?.items ?? [];
				$("needs").hidden = items.length === 0;
				$("needs-unmet").textContent = checklist?.unmet > 0 ? s("inspector.card.needsNotMet", { count: checklist.unmet }) : "";
				$("needs-list").replaceChildren(...items.map((item) => {
					const row = el("li");
					row.dataset.state = item.state;
					const mark = el("span", "mark", MARKS[item.state] ?? "");
					mark.setAttribute("aria-hidden", "true");
					row.append(mark, el("span", "label", item.label));
					for (const fix of item.fixes ?? []) row.append(el("span", "fix", fix));
					row.setAttribute("aria-label", [item.label + ": " + s(STATES[item.state] ?? ""), ...(item.fixes ?? [])].join(". "));
					return row;
				}));
			}

			let lastStatus;
			function renderStatus(payload) {
				renderNeeds(payload.requirements);
				const until = typeof payload.verboseUntil === "number" ? new Date(payload.verboseUntil) : undefined;
				$("t3-verbose").checked = until !== undefined;
				$("t3-verbose-state").textContent = until
					? s("inspector.card.verboseUntil", { time: until.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) })
					: s("inspector.card.verboseOff");
				const environments = payload.environments ?? [];
				const selected = environments.some((env) => env.url === payload.selected) ? payload.selected : "";
				const ready = environments.filter((env) => env.state === "ready");
				const failed = environments.some((env) => env.state === "error") || payload.pairing?.state === "error";

				$("t3-lede").textContent = s(
					environments.length === 0 ? "inspector.card.notRunning" : ready.length === 0 ? "inspector.card.howToPair" : "inspector.card.picked",
				);

				// The machine this action follows: all of them, or one, each with its state in the option.
				const picker = $("t3-machine");
				const options = [];
				if (environments.length !== 1 || selected === "") {
					const all = el("option", "", s("inspector.card.allMachines") + " (" + (environments.length === 0 ? s("inspector.card.noneYet") : s("inspector.card.connectedCount", { ready: ready.length, total: environments.length })) + ")");
					all.value = "";
					options.push(all);
				}
				for (const env of environments) {
					const [, label] = (STATE[env.state] ?? STATE.connecting)(env);
					const option = el("option", "", env.name + " — " + s(label));
					option.value = env.url;
					options.push(option);
				}
				picker.replaceChildren(...options);
				picker.value = selected;
				picker.disabled = environments.length === 0;

				$("t3-machines-item").hidden = environments.length === 0;
				$("t3-machines").replaceChildren(...environments.map(row));

				const result = $("t3-result");
				const pairing = payload.pairing ?? { state: "idle" };
				result.hidden = pairing.state === "idle";
				result.className = pairing.state === "error" ? "hint error" : "hint";
				result.textContent = pairing.state === "error" ? pairing.message : s("inspector.card.pairing");
				if (pairing.state === "idle" && pairedOnce) {
					$("t3-link").value = "";
					pairedOnce = false;
				}
				syncPairButton(pairing.state === "working");
			}

			/** Swaps the English copy for the plugin's current-language table; sdpi selects re-read their options on refresh. */
			function applyStrings(table, lang) {
				if (lang) document.documentElement.lang = lang;
				Object.assign(strings, table);
				for (const node of document.querySelectorAll("[data-i18n]")) if (table[node.dataset.i18n]) node.textContent = table[node.dataset.i18n];
				for (const name of ["label", "placeholder", "loading", "aria-label"]) {
					for (const node of document.querySelectorAll("[data-i18n-" + name + "]")) {
						const value = table[node.getAttribute("data-i18n-" + name)];
						if (value) node.setAttribute(name, value);
					}
				}
				for (const select of document.querySelectorAll("sdpi-select")) if (select.querySelector("option")) select.refresh?.();
				if (lastStatus) renderStatus(lastStatus);
				else syncPairButton();
			}

			client.sendToPropertyInspector.subscribe(({ payload }) => {
				if (payload?.event === "strings") return applyStrings(payload.strings ?? {}, payload.lang);
				if (payload?.event === "diagnostics") {
					$("t3-diagnostics-result").hidden = payload.ok === true;
					return;
				}
				if (payload?.event !== "status") return;
				lastStatus = payload;
				renderStatus(payload);
			});

			$("t3-verbose").addEventListener("change", () => send("verbose", { on: $("t3-verbose").checked }));
			$("t3-open-logs").addEventListener("click", () => send("openLogs"));
			$("t3-preview-pet").addEventListener("click", () => send("previewPet"));
			$("t3-export").addEventListener("click", () => send("exportDiagnostics"));

			let pairedOnce = false;
			const syncPairButton = (working = false) => {
				$("t3-pair").disabled = working || !/[#?&]token=./.test($("t3-link").value);
				$("t3-pair").textContent = s(working ? "inspector.card.connecting" : "inspector.card.connect");
			};
			$("t3-machine").addEventListener("change", () => send("selectMachine", { url: $("t3-machine").value }));
			$("t3-get-link").addEventListener("click", () => send("getPairLink", {}));
			$("t3-link").addEventListener("input", () => syncPairButton());
			$("t3-pair").addEventListener("click", () => {
				pairedOnce = true;
				send("pair", { link: $("t3-link").value.trim() });
				syncPairButton(true);
			});
			$("t3-link").addEventListener("keydown", (key) => {
				if (key.key === "Enter" && !$("t3-pair").disabled) $("t3-pair").click();
			});
			send("strings");
			send("status");${showWhen("stripBackground", "strip-color", `value === "custom"`, true)}${extra}
		</script>`;

const page = (title: string, fields = "", extra = "") => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${title}</title>
		<script src="sdpi-components.js"></script>${style}${needsStyle}
	</head>
	<body>
		<main>${fields}${needs}${card}
		</main>${script(extra)}
	</body>
</html>
`;

const filterOptions = `
				<sdpi-select setting="filter" default="all">
					<option value="all"${text("inspector.filter.all")}</option>
					<option value="attention"${text("inspector.filter.attention")}</option>
					<option value="active"${text("inspector.filter.active")}</option>
					<option value="unread"${text("inspector.filter.unread")}</option>
				</sdpi-select>`;

const authorityOptions = `
				<sdpi-select setting="approvalAuthority" default="open">
					<option value="open"${text("inspector.authority.open")}</option>
					<option value="once"${text("inspector.authority.once")}</option>
					<option value="session"${text("inspector.authority.session")}</option>
					<option value="always"${text("inspector.authority.always")}</option>
				</sdpi-select>`;

/** Hold or tap for git keys; by default only actions that push need a hold. */
const gitConfirm = `
			<sdpi-item ${attr("label", "inspector.git.confirm")}>
				<sdpi-select setting="confirm" default="">
					<option value=""${text("inspector.git.confirmDefault")}</option>
					<option value="tap"${text("inspector.git.tap")}</option>
					<option value="hold"${text("inspector.git.hold")}</option>
				</sdpi-select>
			</sdpi-item>`;

/** What the Limits key and dial show, and what holding them does. */
const limitsFields = `
			<sdpi-item ${attr("label", "inspector.limits.show")}>
				<sdpi-select setting="show" default="left">
					<option value="left"${text("inspector.limits.left")}</option>
					<option value="used"${text("inspector.limits.used")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.limits.resetAction")}>
				<sdpi-select setting="resetAction" default="open">
					<option value="open"${text("inspector.limits.open")}</option>
					<option value="spend"${text("inspector.limits.spend")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint" id="spend-hint" hidden${text("inspector.limits.spendHint")}</p>`;
const limitsScript = showWhen("resetAction", "spend-hint", `value === "spend"`);

/** T3 Code's Usage periods; its page opens on 30 days. */
const periodField = `
			<sdpi-item ${attr("label", "inspector.usage.period")}>
				<sdpi-select setting="period" default="30">
					<option value="1"${text("inspector.usage.day")}</option>
					<option value="7"${text("inspector.usage.week")}</option>
					<option value="30"${text("inspector.usage.month")}</option>
					<option value="90"${text("inspector.usage.quarter")}</option>
				</sdpi-select>
			</sdpi-item>`;

const usageProviderField = `
			<sdpi-item ${attr("label", "inspector.usage.provider")}>
				<sdpi-select setting="provider" datasource="getUsageProviders" hot-reload ${attr("loading", "inspector.loading.providers")} default=""></sdpi-select>
			</sdpi-item>`;

/** Which thread the action acts on: the selection, or one thread picked from the machine's threads. */
const targetField = `
			<sdpi-item ${attr("label", "inspector.target.label")}>
				<sdpi-select setting="target" default="selected">
					<option value="selected"${text("inspector.target.selected")}</option>
					<option value="thread"${text("inspector.target.thread")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.target.pick")} id="target-thread" hidden>
				<sdpi-select setting="thread" datasource="getThreads" hot-reload ${attr("loading", "inspector.loading.threads")}></sdpi-select>
			</sdpi-item>
			<p class="hint" id="target-hint" hidden${text("inspector.target.hint")}</p>`;
const targetScript = showWhen("target", "target-thread", `value === "thread"`) + showWhen("target", "target-hint", `value === "thread"`);

const pages: Record<string, string> = {
	"environments.html": page("T3 Deck"),
	"slot.html": page(
		"Thread",
		`
			<sdpi-item ${attr("label", "inspector.slot.label")}>
				<sdpi-select setting="slot" default="">
					<option value=""${text("inspector.slot.byPosition")}</option>
					<option value="0"${text("inspector.slot.selected")}</option>
					${Array.from({ length: 12 }, (_, i) => (i === 0 ? `<option value="1"${text("inspector.slot.first")}</option>` : `<option value="${i + 1}">${i + 1}</option>`)).join("\n\t\t\t\t\t")}
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.slot.hint")}</p>`,
	),
	"activity.html": page(
		"Activity",
		`
			<sdpi-item ${attr("label", "inspector.field.show")}>${filterOptions}
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.project")}>
				<sdpi-select setting="project" datasource="getProjects" hot-reload ${attr("loading", "inspector.loading.projects")} default=""></sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.activity.hint")}</p>`,
	),
	"answer.html": page(
		"Answer Dial",
		`
			<sdpi-item ${attr("label", "inspector.field.approvals")}>${authorityOptions}
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.toAnswer")}>
				<sdpi-select setting="approvalConfirm" default="hold">
					<option value="hold"${text("inspector.answer.hold")}</option>
					<option value="tap"${text("inspector.answer.press")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.answer.hint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"send.html": page(
		"Send Prompt",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.keyTitle")}>
				<sdpi-textfield setting="title" ${attr("placeholder", "inspector.send.titlePlaceholder")}></sdpi-textfield>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.prompt")}>
				<sdpi-textarea setting="prompt" rows="4" ${attr("placeholder", "inspector.send.promptPlaceholder")}></sdpi-textarea>
			</sdpi-item>
			<p class="hint"${text("inspector.send.hint")}</p>${confirmField}`,
		targetScript,
	),
	"steer.html": page(
		"Steer",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.keyTitle")}>
				<sdpi-textfield setting="title" ${attr("placeholder", "inspector.steer.titlePlaceholder")}></sdpi-textfield>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.prompt")}>
				<sdpi-textarea setting="prompt" rows="4" ${attr("placeholder", "inspector.steer.promptPlaceholder")}></sdpi-textarea>
			</sdpi-item>
			<p class="hint"${text("inspector.steer.hint")}</p>${confirmField}`,
		targetScript,
	),
	"quick.html": page(
		"Quick Prompt",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.keyTitle")}>
				<sdpi-textfield setting="title" ${attr("placeholder", "inspector.quick.titlePlaceholder")}></sdpi-textfield>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.quick.type")}>
				<sdpi-select setting="template" default="continue">
					<option value="continue"${text("inspector.quick.continue")}</option>
					<option value="test"${text("inspector.quick.test")}</option>
					<option value="fix"${text("inspector.quick.fix")}</option>
					<option value="explain"${text("inspector.quick.explain")}</option>
					<option value="commit"${text("inspector.quick.commit")}</option>
					<option value="custom"${text("inspector.quick.custom")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.quick.custom")} id="custom" hidden>
				<sdpi-textarea setting="prompt" rows="4" ${attr("placeholder", "inspector.quick.customPlaceholder")}></sdpi-textarea>
			</sdpi-item>
			<p class="hint"${text("inspector.quick.hint")}</p>${confirmField}`,
		showWhen("template", "custom", `value === "custom"`) + targetScript,
	),
	"new.html": page(
		"New Thread",
		`
			<sdpi-item ${attr("label", "inspector.new.createIn")}>
				<sdpi-select setting="destination" default="selected">
					<option value="selected"${text("inspector.new.selected")}</option>
					<option value="scratch"${text("inspector.new.scratch")}</option>
					<option value="project"${text("inspector.new.project")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.project")} id="project" hidden>
				<sdpi-select setting="project" datasource="getLaunchProjects" hot-reload ${attr("loading", "inspector.loading.projects")}></sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.new.startIn")}>
				<sdpi-select setting="startIn" default="folder">
					<option value="folder"${text("inspector.new.folder")}</option>
					<option value="worktree"${text("inspector.new.worktree")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint" id="worktree-hint" hidden${text("inspector.new.worktreeHint")}</p>
			<sdpi-item ${attr("label", "inspector.field.prompt")}>
				<sdpi-textarea setting="prompt" rows="4" ${attr("placeholder", "inspector.new.promptPlaceholder")}></sdpi-textarea>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.new.title")}>
				<sdpi-textfield setting="title" ${attr("placeholder", "inspector.new.titlePlaceholder")}></sdpi-textfield>
			</sdpi-item>
			<p class="hint"${text("inspector.new.hint")}</p>`,
		showWhen("destination", "project", `value === "project"`) + showWhen("startIn", "worktree-hint", `value === "worktree"`),
	),
	"model.html": page(
		"Model",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.model")}>
				<sdpi-select setting="model" datasource="getModels" hot-reload ${attr("loading", "inspector.loading.models")} default=""></sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.model.nameColor")}>
				<sdpi-select setting="nameColor" default="model">
					<option value="model"${text("inspector.model.nameModel")}</option>
					<option value="white"${text("inspector.model.nameWhite")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.model.hint")}</p>`,
		targetScript,
	),
	"effort.html": page(
		"Effort",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.effort")}>
				<sdpi-select setting="effort" datasource="getEfforts" hot-reload ${attr("loading", "inspector.loading.efforts")} default=""></sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.effort.hint")}</p>`,
		targetScript,
	),
	"permissions.html": page(
		"Permissions",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.access")}>
				<sdpi-select setting="mode" default="">
					<option value=""${text("inspector.permissions.cycle")}</option>
					<option value="approval-required"${text("inspector.permissions.approvalRequired")}</option>
					<option value="auto-accept-edits"${text("inspector.permissions.autoAcceptEdits")}</option>
					<option value="auto"${text("inspector.permissions.auto")}</option>
					<option value="full-access"${text("inspector.permissions.fullAccess")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.permissions.hint")}</p>`,
		targetScript,
	),
	"approve.html": page(
		"Approve",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.approvals")}>${authorityOptions}
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.toAnswer")}>
				<sdpi-select setting="approvalConfirm" default="hold">
					<option value="hold"${text("inspector.approve.hold")}</option>
					<option value="tap"${text("inspector.approve.tap")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.approve.hint")}</p>`,
		targetScript,
	),
	"speed.html": page("Speed", targetField, targetScript),
	"target.html": page("Target", targetField, targetScript),
	"organize.html": page(
		"Organize",
		`
			<div id="organize-target">${targetField}
			</div>
			<sdpi-item ${attr("label", "inspector.organize.action")}>
				<sdpi-select setting="organize" default="settle">
					<option value="settle"${text("inspector.organize.settle")}</option>
					<option value="pin"${text("inspector.organize.pin")}</option>
					<option value="snooze"${text("inspector.organize.snooze")}</option>
					<option value="archive"${text("inspector.organize.archive")}</option>
					<option value="mark_unread"${text("inspector.organize.markUnread")}</option>
					<option value="wake"${text("inspector.organize.wake")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.organize.snoozeFor")} id="snooze-for">
				<sdpi-select setting="snoozeMinutes" default="60">
					<option value="15"${text("inspector.organize.minutes15")}</option>
					<option value="30"${text("inspector.organize.minutes30")}</option>
					<option value="60"${text("inspector.organize.hour1")}</option>
					<option value="120"${text("inspector.organize.hours2")}</option>
					<option value="240"${text("inspector.organize.hours4")}</option>
					<option value="480"${text("inspector.organize.hours8")}</option>
					<option value="1440"${text("inspector.organize.day1")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.organize.confirm")} id="confirm-first">
				<sdpi-select setting="confirm" default="review">
					<option value="review"${text("inspector.organize.confirmReview")}</option>
					<option value="hold"${text("inspector.organize.confirmHold")}</option>
					<option value="off"${text("inspector.organize.confirmOff")}</option>
				</sdpi-select>
			</sdpi-item>`,
		showWhen("organize", "snooze-for", `value === "snooze"`) + showWhen("organize", "confirm-first", `value === "" || value === "settle" || value === "snooze"`) +
			showWhen("organize", "organize-target", `value !== "wake"`) +
			targetScript,
	),
	"task.html": page(
		"Run Task",
		`
			<sdpi-item ${attr("label", "inspector.task.label")}>
				<sdpi-select setting="task" datasource="getTasks" hot-reload ${attr("loading", "inspector.loading.tasks")}></sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.task.hint")}</p>`,
	),
	"skill.html": page(
		"Run Skill",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.skill.label")}>
				<sdpi-select setting="skill" datasource="getSkills" hot-reload ${attr("loading", "inspector.loading.skills")}></sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.skill.extra")}>
				<sdpi-textarea setting="prompt" rows="3" ${attr("placeholder", "inspector.skill.extraPlaceholder")}></sdpi-textarea>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.keyTitle")}>
				<sdpi-textfield setting="title" ${attr("placeholder", "inspector.skill.titlePlaceholder")}></sdpi-textfield>
			</sdpi-item>
			<p class="hint"${text("inspector.skill.hint")}</p>${confirmField}`,
		targetScript,
	),
	"skills-dial.html": page(
		"Skills Dial",
		`${targetField}
			<p class="hint"${text("inspector.skill.dialHint")}</p>${confirmField}${dialAppearance}`,
		targetScript + dialAppearanceScript,
	),
	"workflow.html": page(
		"Stop Workflow",
		`${targetField}
			<p class="hint"${text("inspector.workflow.hint")}</p>`,
		targetScript,
	),
	"fork.html": page(
		"Fork",
		`${targetField}
			<p class="hint"${text("inspector.lineage.forkHint")}</p>`,
		targetScript,
	),
	"merge.html": page(
		"Merge Back",
		`${targetField}
			<p class="hint"${text("inspector.lineage.mergeHint")}</p>`,
		targetScript,
	),
	"tasks-dial.html": page(
		"Tasks Dial",
		`
			<p class="hint"${text("inspector.task.dialHint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"queue-dial.html": page(
		"Queue Dial",
		`
			<p class="hint"${text("inspector.queue.hint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"prompts.html": page(
		"Prompts Dial",
		`
			<sdpi-item ${attr("label", "inspector.prompts.label")}>
				<sdpi-textarea setting="prompts" rows="6" ${attr("placeholder", "inspector.prompts.placeholder")}></sdpi-textarea>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.prompts.templates")}>
				<sdpi-checkbox setting="templates" default="true" ${attr("label", "inspector.prompts.templatesLabel")}></sdpi-checkbox>
			</sdpi-item>
			<p class="hint"${text("inspector.prompts.hint")}</p>${confirmField}${dialAppearance}`,
		dialAppearanceScript,
	),
	"threads-dial.html": page(
		"Threads Dial",
		`
			<sdpi-item ${attr("label", "inspector.field.show")}>${filterOptions}
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.project")}>
				<sdpi-select setting="project" datasource="getProjects" hot-reload ${attr("loading", "inspector.loading.projects")} default=""></sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.threads.recency")}>
				<sdpi-select setting="recency" default="all">
					<option value="all"${text("inspector.threads.noLimit")}</option>
					<option value="24h"${text("inspector.threads.day")}</option>
					<option value="48h"${text("inspector.threads.twoDays")}</option>
					<option value="3d"${text("inspector.threads.threeDays")}</option>
					<option value="7d"${text("inspector.threads.week")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.threads.hint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"power.html": page(
		"Power Dial",
		`
			<sdpi-item ${attr("label", "inspector.power.controls")}>
				<sdpi-select setting="dialControls" default="model">
					<option value="model"${text("inspector.field.model")}</option>
					<option value="effort"${text("inspector.field.effort")}</option>
					<option value="permissions"${text("inspector.field.access")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.power.bottomRow")} id="model-row">
				<sdpi-checkbox setting="showSpeed" default="true" ${attr("label", "inspector.power.showSpeed")}></sdpi-checkbox>
				<sdpi-checkbox setting="showEffort" default="true" ${attr("label", "inspector.power.showEffort")}></sdpi-checkbox>
			</sdpi-item>
			<p class="hint"${text("inspector.power.hint")}</p>${dialAppearance}`,
		dialAppearanceScript + showWhen("dialControls", "model-row", `value === "" || value === "model"`),
	),
	"git-commit.html": page(
		"Commit",
		`
			<sdpi-item ${attr("label", "inspector.git.action")}>
				<sdpi-select setting="gitAction" default="commit">
					<option value="commit"${text("inspector.git.commit")}</option>
					<option value="commit_push"${text("inspector.git.commitPush")}</option>
					<option value="commit_push_pr"${text("inspector.git.commitPushPr")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.git.message")}>
				<sdpi-textfield setting="commitMessage" ${attr("placeholder", "inspector.git.messagePlaceholder")}></sdpi-textfield>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.keyTitle")}>
				<sdpi-textfield setting="title"></sdpi-textfield>
			</sdpi-item>${gitConfirm}
			<p class="hint"${text("inspector.git.hint")}</p>`,
	),
	"git.html": page(
		"Git",
		`${gitConfirm}
			<p class="hint"${text("inspector.git.hint")}</p>`,
	),
	"git-pull.html": page(
		"Pull",
		`${gitConfirm}
			<p class="hint"${text("inspector.git.pullHint")}</p>`,
	),
	"pr-fix.html": page(
		"Fix Findings",
		`
			<sdpi-item ${attr("label", "inspector.pr.confirm")}>
				<sdpi-select setting="confirm" default="hold">
					<option value="hold"${text("inspector.pr.hold")}</option>
					<option value="tap"${text("inspector.pr.tap")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.pr.fixHint")}</p>`,
	),
	"pr-dial.html": page(
		"PR Dial",
		`
			<sdpi-item ${attr("label", "inspector.pr.confirm")}>
				<sdpi-select setting="confirm" default="hold">
					<option value="hold"${text("inspector.pr.hold")}</option>
					<option value="tap"${text("inspector.pr.tap")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.pr.dialHint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"limits.html": page(
		"Limits",
		`
			<sdpi-item ${attr("label", "inspector.limits.provider")}>
				<sdpi-select setting="provider" datasource="getLimitProviders" hot-reload ${attr("loading", "inspector.loading.providers")} default=""></sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.limits.window")}>
				<sdpi-select setting="window" datasource="getLimitWindows" hot-reload ${attr("loading", "inspector.loading.windows")} default=""></sdpi-select>
			</sdpi-item>${limitsFields}
			<p class="hint"${text("inspector.limits.hint")}</p>`,
		limitsScript,
	),
	"limits-dial.html": page(
		"Limits Dial",
		`${limitsFields}
			<p class="hint"${text("inspector.limits.hint")}</p>${dialAppearance}`,
		dialAppearanceScript + limitsScript,
	),
	"usage.html": page(
		"Usage",
		`${periodField}${usageProviderField}
			<p class="hint"${text("inspector.usage.hint")}</p>`,
	),
	"usage-dial.html": page(
		"Usage Dial",
		`${periodField}${usageProviderField}
			<p class="hint"${text("inspector.usage.dialHint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"devices-dial.html": page(
		"Devices Dial",
		`${targetField}
			<p class="hint"${text("inspector.devices.hint")}</p>${dialAppearance}`,
		targetScript + dialAppearanceScript,
	),
	"preview.html": page(
		"Open Preview",
		`${targetField}
			<p class="hint"${text("inspector.preview.hint")}</p>`,
		targetScript,
	),
	"update.html": page(
		"Update T3",
		`
			<p class="hint"${text("inspector.update.hint")}</p>
			<p class="hint access"${text("inspector.update.access")}</p>`,
	),
	"script.html": page(
		"Run Script",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.script.label")}>
				<sdpi-select setting="script" datasource="getScripts" hot-reload ${attr("loading", "inspector.loading.scripts")}></sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.script.hint")}</p>
			<p class="hint access"${text("inspector.script.access")}</p>`,
		targetScript,
	),
	"share.html": page(
		"Share Thread",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.share.link")} id="share-link" hidden>
				<input class="link" id="share-url" type="text" readonly spellcheck="false" />
			</sdpi-item>
			<p class="hint" id="share-link-hint" hidden${text("inspector.share.linkHint")}</p>
			<p class="hint"${text("inspector.share.hint")}</p>
			<p class="hint access"${text("inspector.share.access")}</p>`,
		`${targetScript}
			{
				// The link is a credential: it lives only in this page and the running plugin, never in settings.
				const showLink = (url) => {
					$("share-url").value = url ?? "";
					$("share-link").hidden = !url;
					$("share-link-hint").hidden = !url;
				};
				$("share-url").addEventListener("focus", () => $("share-url").select());
				client.sendToPropertyInspector.subscribe(({ payload }) => {
					if (payload?.event === "shareLink") showLink(payload.url);
				});
				client.didReceiveSettings.subscribe(() => send("getShareLink"));
				send("getShareLink");
			}`,
	),
	"editor.html": page(
		"Open in Editor",
		`
			<sdpi-item ${attr("label", "inspector.editor.label")}>
				<sdpi-select setting="editor" datasource="getEditors" hot-reload ${attr("loading", "inspector.editor.loading")} default=""></sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.editor.hint")}</p>`,
	),
};

for (const [name, html] of Object.entries(pages)) writeFileSync(join(dir, name), html);
