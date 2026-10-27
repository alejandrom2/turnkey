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
			/* What broader access an action needs, said plainly. */
			.hint.access { color: var(--t3-warning); }
			.link { width: 100%; box-sizing: border-box; padding: 4px 6px; font: 9pt var(--t3-font); color: #d8d8d8; background: #2d2d2d; border: 1px solid #3d3d3d; border-radius: 3px; }
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
			/* Broader access a machine holds or asks for at its next pairing. */
			.machine .optins { grid-column: 2 / 4; display: grid; gap: 3px; margin: 6px 0 0; }
			.machine .optin { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--t3-muted); }
			.machine .optin .scope { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--t3-foreground); }
			.machine .optin.pending .scope { color: var(--t3-warning); }

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
			<section class="t3" id="t3" aria-live="polite">
				<p class="eyebrow">T3 Code</p>
				<h2 id="t3-title"${text("inspector.card.choose")}</h2>
				<p class="lede" id="t3-lede"${text("inspector.card.looking")}</p>
				<div class="machines" id="t3-machines" role="radiogroup" ${attr("aria-label", "inspector.card.machineGroup")}></div>
				<div class="add">
					<p class="label"${text("inspector.card.addMachine")}</p>
					<div class="controls">
						<input id="t3-link" type="url" autocomplete="off" spellcheck="false" ${attr("placeholder", "inspector.card.linkPlaceholder")} />
						<button class="primary" id="t3-pair" type="button" disabled${text("inspector.card.connect")}</button>
					</div>
					<p class="access-help"${text("inspector.card.accessHelp")}</p>
					<p class="result" id="t3-result" hidden></p>
				</div>
				<p class="note"${text("inspector.card.shared")}</p>
			</section>
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

			function tile({ url, icon, name, where, checked, actions = [], detail, detailTone, optIn }) {
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
				if (optIn?.length) node.append(optIns(url, optIn));
				return node;
			}

			const SCOPE_NAMES = {
				"providers:manage": "inspector.card.scopeProviders",
				"environment:maintain": "inspector.card.scopeMaintain",
				"terminal:operate": "inspector.card.scopeTerminal",
				"terminal:read": "inspector.card.scopeTerminalRead",
				"access:write": "inspector.card.scopeShare",
			};
			/** Each opt-in scope: held by the pairing, or flagged for the next one with a way to take it back. */
			function optIns(url, optIn) {
				const list = el("div", "optins");
				list.setAttribute("aria-label", s("inspector.card.optInTitle"));
				for (const { scope, state } of optIn) {
					const row = el("div", "optin " + state);
					row.append(el("span", "scope", SCOPE_NAMES[scope] ? s(SCOPE_NAMES[scope]) : scope));
					row.append(el("span", state === "held" ? "pill ready" : "pill wait", s(state === "held" ? "inspector.card.optInHeld" : "inspector.card.optInPending")));
					if (state === "pending") {
						const drop = el("button", "ghost", s("inspector.card.optInDrop"));
						drop.type = "button";
						drop.addEventListener("click", (click) => {
							click.stopPropagation();
							send("unflagScope", { url, scope });
						});
						row.append(drop);
					}
					list.append(row);
				}
				return list;
			}

			const focusLink = () => {
				$("t3-link").focus();
				$("t3-link").select();
			};

			function machineActions(env) {
				const actions = [];
				if (env.state === "ready") {
					actions.push(el("span", env.access === "Can act" ? "pill ready" : "pill muted", s(env.access === "Can act" ? "inspector.card.connected" : "inspector.card.readOnly")));
					actions.push(button(s("inspector.card.signOut"), "ghost", "signOut", env.url));
				} else if (env.state === "connecting") {
					actions.push(el("span", "pill muted", s("inspector.card.connecting")));
				} else if (env.state === "error") {
					actions.push(button(s("inspector.card.tryAgain"), "primary", "retry", env.url));
				} else {
					const pill = el("button", "pill wait", s("inspector.card.needsPairing"));
					pill.type = "button";
					pill.addEventListener("click", (click) => {
						click.stopPropagation();
						focusLink();
					});
					actions.push(pill);
				}
				if (!env.local) actions.push(button(s("inspector.card.remove"), "ghost", "remove", env.url));
				return actions;
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

				$("t3").dataset.tone = failed ? "error" : "pairing";
				$("t3-title").textContent = s(environments.length === 0 ? "inspector.card.connectTitle" : ready.length === 0 ? "inspector.card.pairTitle" : "inspector.card.choose");
				$("t3-lede").textContent = s(
					environments.length === 0 ? "inspector.card.notRunning" : ready.length === 0 ? "inspector.card.howToPair" : "inspector.card.picked",
				);

				const tiles = [];
				if (environments.length > 1 || selected === "") {
					tiles.push(tile({
						url: "",
						icon: "all",
						name: s("inspector.card.allMachines"),
						where: environments.length === 0 ? s("inspector.card.noneYet") : s("inspector.card.connectedCount", { ready: ready.length, total: environments.length }),
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
						detail: env.state === "error" ? env.message : env.state === "signed-out" ? (env.message ?? s("inspector.card.pasteFromMachine")) : undefined,
						detailTone: env.state === "signed-out" ? "muted" : undefined,
						optIn: env.optIn,
					}));
				}
				$("t3-machines").replaceChildren(...tiles);

				const result = $("t3-result");
				const pairing = payload.pairing ?? { state: "idle" };
				result.hidden = pairing.state === "idle";
				result.className = "result " + pairing.state;
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
			$("t3-export").addEventListener("click", () => send("exportDiagnostics"));

			let pairedOnce = false;
			const syncPairButton = (working = false) => {
				$("t3-pair").disabled = working || !/[#?&]token=./.test($("t3-link").value);
				$("t3-pair").textContent = s(working ? "inspector.card.connecting" : "inspector.card.connect");
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
