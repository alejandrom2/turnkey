// Builds the bundled Stream Deck profiles into the plugin: `node scripts/profiles.ts`.
// Format follows Stream Deck 7.5+ exports: package.json beside Profiles/<id>.sdProfile, zipped.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const pluginDir = join(root, "com.alejandrom2.t3deck.sdPlugin");
const manifest = JSON.parse(readFileSync(join(pluginDir, "manifest.json"), "utf8")) as { UUID: string; Name: string; Version: string };

/** Stable ids keep regenerated profiles diff-free. */
const uuid = (seed: string) => {
	const hex = createHash("sha256").update(`t3-deck:${seed}`).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

type Placed = { action: string; name: string; settings?: Record<string, string> };

const state = { FontFamily: "", FontSize: 12, FontStyle: "", FontUnderline: false, OutlineThickness: 2, ShowTitle: false, TitleAlignment: "bottom", TitleColor: "#ffffff" };

const entry = (seed: string, placed: Placed) => ({
	ActionID: uuid(seed),
	LinkedTitle: false,
	Name: placed.name,
	Plugin: { Name: manifest.Name, UUID: manifest.UUID, Version: manifest.Version },
	Resources: null,
	Settings: placed.settings ?? {},
	State: 0,
	States: [state],
	UUID: `${manifest.UUID}.${placed.action}`,
});

/** Without a number a Thread key fills by its position; the second page continues the board from slot 5. */
const slot = (n?: number): Placed => ({ action: "slot", name: "Thread", ...(n === undefined ? {} : { settings: { slot: String(n) } }) });

const power = (control: string): Placed => ({ action: "dial.model", name: "Power Dial", settings: { dialControls: control } });

const DIALS: Placed[] = [
	{ action: "dial.threads", name: "Threads Dial", settings: { filter: "attention" } },
	power("model"),
	{ action: "dial.prompts", name: "Prompts Dial", settings: { prompts: ["Review your changes for bugs", "Summarize what you changed"].join("\n") } },
	{ action: "dial.answer", name: "Answer Dial" },
];

const limits = (provider: string, window: string): Placed => ({ action: "limits", name: "Limits", settings: { provider, window } });
const usage = (period: string): Placed => ({ action: "usage", name: "Usage", settings: { period } });

/** Run Skill keys start unpicked: skills come from each thread's provider and checkout. */
const skill = (): Placed => ({ action: "skill", name: "Run Skill" });

/** Run Script keys start unpicked, so the bundled profile never asks a machine for terminal access by itself. */
const script = (): Placed => ({ action: "script", name: "Run Script" });

/** Run Task keys start unpicked: tasks are the user's own. */
const task = (): Placed => ({ action: "task", name: "Run Task" });

const quick = (template: string): Placed => ({ action: "quick", name: "Quick Prompt", settings: { template } });
const organize = (which: string): Placed => ({ action: "organize", name: "Organize", settings: { organize: which } });

const key = (action: string, name: string, settings?: Record<string, string>): Placed => ({ action, name, ...(settings ? { settings } : {}) });
const activity = key("activity", "Activity");
const newThread = key("new", "New Thread");
const sendContinue = key("send", "Send Prompt", { prompt: "Continue", title: "Continue" });
const steer = key("steer", "Steer", { title: "Keep it small", prompt: "Keep the change small and focused." });
const stop = key("stop", "Stop");
const approve = key("approve", "Approve");
const deny = key("deny", "Deny");
const model = key("model", "Model");
const effort = key("effort", "Effort");
const speed = key("speed", "Speed");
const health = key("health", "Health");
const editor = key("editor", "Open in Editor");
const branch = key("branch", "Branch");
const createPr = key("git.pr", "Create PR");
const threadsDial = (filter: string): Placed => ({ action: "dial.threads", name: "Threads Dial", settings: { filter } });
const queueDial: Placed = { action: "dial.queue", name: "Queue Dial" };
const usageDial: Placed = { action: "dial.usage", name: "Usage Dial", settings: { period: "7" } };
const skillsDial: Placed = { action: "dial.skills", name: "Skills Dial" };
const prDial: Placed = { action: "dial.pr", name: "PR Dial" };

/**
 * Pages are lists in reading order, so one definition fits any keypad: a device takes them row by row. `dials`
 * replace the shared ones on a dial device; `infobar` is the Neo's info bar.
 */
type Page = { name: string; keys: Placed[]; dials?: Placed[]; infobar?: Placed };

/** The 8-key pages shared by Stream Deck + and Neo. */
const PAGES_8: Page[] = [
	{ name: "T3 DECK", keys: [slot(), slot(), slot(), slot(), activity, newThread, sendContinue, stop] },
	{
		name: "THREADS",
		keys: [slot(5), slot(6), slot(7), slot(8), slot(9), slot(10), slot(11), slot(12)],
		dials: [threadsDial("all"), threadsDial("active"), threadsDial("unread"), DIALS[3]!],
	},
	{ name: "CONTROLS", keys: [model, effort, speed, key("permissions", "Permissions"), key("plan", "Plan"), steer, approve, deny], dials: [power("model"), power("effort"), power("permissions"), DIALS[3]!] },
	{
		name: "PROMPTS",
		keys: [quick("continue"), quick("test"), quick("fix"), quick("explain"), quick("commit"), organize("settle"), organize("pin"), organize("snooze")],
		dials: [DIALS[0]!, DIALS[2]!, queueDial, DIALS[3]!],
	},
	{
		name: "SKILLS",
		keys: [skill(), skill(), skill(), skill(), key("fork", "Fork"), key("merge", "Merge Back"), key("workflow.stop", "Stop Workflow"), branch],
		dials: [skillsDial, DIALS[0]!, queueDial, DIALS[3]!],
	},
	{
		name: "GIT",
		keys: [key("git.commit", "Commit"), key("git.push", "Push"), createPr, key("git.pull", "Pull"), branch, editor, organize("archive"), health],
		dials: [DIALS[0]!, prDial, power("model"), DIALS[3]!],
	},
	{
		name: "PULL REQUESTS",
		keys: [key("pr", "Pull Request"), key("pr.fix", "Fix Findings"), key("pr.explain", "Explain PR"), key("pr.ask", "Ask about PR"), key("pr.guide", "Review Guide"), createPr, editor, stop],
		dials: [prDial, DIALS[0]!, DIALS[2]!, DIALS[3]!],
	},
	{
		name: "DEVICES",
		keys: [key("preview", "Open Preview"), editor, quick("test"), stop, organize("snooze"), organize("wake"), approve, health],
		dials: [{ action: "dial.devices", name: "Devices Dial" }, DIALS[0]!, queueDial, DIALS[3]!],
	},
	{ name: "TASKS", keys: [task(), task(), task(), task(), quick("continue"), stop, approve, health], dials: [{ action: "dial.tasks", name: "Tasks Dial" }, queueDial, DIALS[0]!, DIALS[3]!] },
	{ name: "ADMIN", keys: [key("update", "Update T3"), script(), script(), script(), key("share", "Share Thread"), health, editor, stop] },
	{
		name: "USAGE",
		keys: [limits("codex", "session"), limits("codex", "weekly"), limits("claudeAgent", "session"), limits("claudeAgent", "weekly"), usage("1"), usage("7"), usage("30"), health],
		dials: [{ action: "dial.limits", name: "Limits Dial" }, usageDial, DIALS[0]!, DIALS[3]!],
		infobar: key("usage", "Usage", { period: "7" }),
	},
];

/** The everyday set, after Elgato's bundled Stream Deck + profile. */
const CURATED_8: Page = {
	name: "T3 DECK",
	keys: [activity, steer, speed, model, sendContinue, newThread, stop, effort],
	dials: [threadsDial("attention"), usageDial, power("model"), skillsDial],
};

/** 15 keys: a home page with everything a running turn needs. */
const HOME_15: Placed[] = [slot(), slot(), slot(), slot(), activity, newThread, sendContinue, steer, stop, approve, deny, model, effort, speed, health];

/** Pages for keypads without page buttons; `nav` keys take the bottom corners. */
const PAGES_15: Page[] = [
	{ name: "T3 DECK", keys: HOME_15.slice(0, 14) },
	{ name: "THREADS", keys: [slot(5), slot(6), slot(7), slot(8), slot(9), slot(10), slot(11), slot(12), slot(13), slot(14), organize("settle"), organize("pin"), organize("snooze")] },
	{
		name: "CONTROLS",
		keys: [key("permissions", "Permissions"), key("plan", "Plan"), quick("continue"), quick("test"), quick("fix"), quick("explain"), quick("commit"), key("workflow.stop", "Stop Workflow"), key("fork", "Fork"), key("merge", "Merge Back"), organize("wake"), organize("archive"), health],
	},
	{ name: "SKILLS", keys: [skill(), skill(), skill(), skill(), task(), task(), task(), task(), editor, key("preview", "Open Preview"), key("update", "Update T3"), key("share", "Share Thread"), stop] },
	{
		name: "GIT",
		keys: [key("git.commit", "Commit"), key("git.push", "Push"), createPr, key("git.pull", "Pull"), branch, key("pr", "Pull Request"), key("pr.fix", "Fix Findings"), key("pr.explain", "Explain PR"), key("pr.ask", "Ask about PR"), key("pr.guide", "Review Guide"), editor, stop, health],
	},
	{ name: "USAGE", keys: [limits("codex", "session"), limits("codex", "weekly"), limits("claudeAgent", "session"), limits("claudeAgent", "weekly"), usage("1"), usage("7"), usage("30"), script(), script(), script(), health, stop, approve, deny] },
];

const XL_HOME: Placed[] = [
	...Array.from({ length: 8 }, () => slot()),
	activity,
	newThread,
	sendContinue,
	steer,
	stop,
	approve,
	deny,
	quick("continue"),
	model,
	effort,
	speed,
	key("permissions", "Permissions"),
	key("plan", "Plan"),
	health,
	editor,
	key("preview", "Open Preview"),
	key("git.commit", "Commit"),
	key("git.push", "Push"),
	createPr,
	key("git.pull", "Pull"),
	branch,
	key("pr", "Pull Request"),
	usage("7"),
	limits("codex", "weekly"),
];

const XL_MORE: Placed[] = [
	slot(9),
	slot(10),
	slot(11),
	slot(12),
	slot(13),
	slot(14),
	slot(15),
	quick("test"),
	quick("fix"),
	quick("explain"),
	quick("commit"),
	organize("settle"),
	organize("pin"),
	organize("snooze"),
	organize("wake"),
	organize("archive"),
	skill(),
	skill(),
	task(),
	task(),
	key("fork", "Fork"),
	key("merge", "Merge Back"),
	key("workflow.stop", "Stop Workflow"),
	key("pr.fix", "Fix Findings"),
	key("pr.explain", "Explain PR"),
	key("pr.ask", "Ask about PR"),
	key("pr.guide", "Review Guide"),
	key("update", "Update T3"),
	script(),
	key("share", "Share Thread"),
	limits("claudeAgent", "weekly"),
];

type Device = {
	model: string;
	type: number;
	columns: number;
	rows: number;
	/** Stream Deck +: four dials under the keys. */
	dials?: boolean;
	/** Stream Deck Neo: the info bar between its page buttons. */
	infobar?: boolean;
	/** Keypads without page buttons get Stream Deck's own Previous and Next Page keys in the bottom corners. */
	nav?: boolean;
};

// Device models from Stream Deck's own default profiles.
const PLUS: Device = { model: "20GBD9901", type: 7, columns: 4, rows: 2, dials: true };
const NEO: Device = { model: "20GBJ9901", type: 9, columns: 4, rows: 2, infobar: true };
const MK2: Device = { model: "20GAA9902", type: 0, columns: 5, rows: 3, nav: true };
const XL: Device = { model: "20GAT9902", type: 2, columns: 8, rows: 4, nav: true };
const MINI: Device = { model: "20GAI9901", type: 1, columns: 3, rows: 2 };

/** `seed` keeps action and page ids stable when a file is renamed. */
type Profile = { file: string; seed: string; name: string; device: Device; pages: Page[] };

const CURATED = "T3 Deck";
const ALL = "T3 Deck (All actions)";

/** Every action appears at least once in an All actions profile, so it doubles as a tour of what the deck can do. */
const PROFILES: Profile[] = [
	{ file: "t3-deck-plus", seed: "t3-deck-plus-curated", name: CURATED, device: PLUS, pages: [CURATED_8] },
	{ file: "t3-deck-plus-all", seed: "t3-deck-plus", name: ALL, device: PLUS, pages: PAGES_8 },
	{ file: "t3-deck-neo", seed: "t3-deck-neo", name: CURATED, device: NEO, pages: [{ ...CURATED_8, infobar: activity }] },
	{ file: "t3-deck-neo-all", seed: "t3-deck-neo-all", name: ALL, device: NEO, pages: PAGES_8.map((page) => ({ ...page, infobar: page.infobar ?? activity })) },
	{ file: "t3-deck-15", seed: "t3-deck-15", name: CURATED, device: { ...MK2, nav: false }, pages: [{ name: "T3 DECK", keys: HOME_15 }] },
	{ file: "t3-deck-15-all", seed: "t3-deck-15-all", name: ALL, device: MK2, pages: PAGES_15 },
	{ file: "t3-deck-xl", seed: "t3-deck-xl", name: CURATED, device: { ...XL, nav: false }, pages: [{ name: "T3 DECK", keys: XL_HOME }] },
	{ file: "t3-deck-xl-all", seed: "t3-deck-xl-all", name: ALL, device: XL, pages: [{ name: "T3 DECK", keys: XL_HOME.slice(0, 31) }, { name: "MORE", keys: XL_MORE }] },
	{ file: "t3-deck-mini", seed: "t3-deck-mini", name: CURATED, device: MINI, pages: [{ name: "T3 DECK", keys: [slot(), slot(), activity, sendContinue, stop, approve] }] },
];

const NAV = { previous: { uuid: "com.elgato.streamdeck.page.previous", name: "Previous Page" }, next: { uuid: "com.elgato.streamdeck.page.next", name: "Next Page" } } as const;

/** Stream Deck's own page key: no plugin, no image of ours. */
const navEntry = (seed: string, which: keyof typeof NAV) => ({
	ActionID: uuid(seed),
	LinkedTitle: true,
	Name: NAV[which].name,
	Settings: {},
	State: 0,
	States: [{}],
	UUID: NAV[which].uuid,
});

/** Lays a page's keys out row by row, around Previous (bottom left, after the first page) and Next (bottom right, before the last). */
function keypad(profile: Profile, index: number): Record<string, unknown> {
	const { device, pages, seed } = profile;
	const page = pages[index]!;
	const bottom = device.rows - 1;
	const reserved = new Map<string, keyof typeof NAV>();
	if (device.nav && index > 0) reserved.set(`0,${bottom}`, "previous");
	if (device.nav && index < pages.length - 1) reserved.set(`${device.columns - 1},${bottom}`, "next");
	const actions: Record<string, unknown> = {};
	const queue = [...page.keys];
	for (let y = 0; y < device.rows; y++) {
		for (let x = 0; x < device.columns; x++) {
			const at = `${x},${y}`;
			const nav = reserved.get(at);
			if (nav !== undefined) actions[at] = navEntry(`${seed}:${page.name}:${nav}`, nav);
			else {
				const placed = queue.shift();
				if (placed !== undefined) actions[at] = entry(`${seed}:${page.name}:key:${at}`, placed);
			}
		}
	}
	if (queue.length > 0) throw new Error(`${profile.file}: page ${page.name} has ${queue.length} keys too many`);
	return actions;
}

function pageManifest(profile: Profile, index: number | undefined) {
	const { device, seed } = profile;
	const page = index === undefined ? undefined : profile.pages[index]!;
	const controllers: { Actions: Record<string, unknown> | null; Type: string }[] = [{ Actions: index === undefined ? null : keypad(profile, index), Type: "Keypad" }];
	if (device.dials) {
		const dials = Object.fromEntries((page?.dials ?? DIALS).map((placed, x) => [`${x},0`, entry(`${seed}:${page?.name}:dial:${x}`, placed)]));
		controllers.push({ Actions: page ? dials : null, Type: "Encoder" });
	}
	if (device.infobar) controllers.push({ Actions: page?.infobar ? { "1,0": entry(`${seed}:${page.name}:infobar`, page.infobar) } : null, Type: "Neo" });
	return { Controllers: controllers, Icon: "", Name: page?.name ?? "" };
}

for (const profile of PROFILES) {
	const staging = mkdtempSync(join(tmpdir(), "t3-deck-profile-"));
	try {
		const profileId = uuid(`${profile.seed}:profile`).toUpperCase();
		const profileDir = join(staging, "Profiles", `${profileId}.sdProfile`);
		const pageIds = profile.pages.map((page) => uuid(`${profile.seed}:page:${page.name}`));
		const defaultId = uuid(`${profile.seed}:page:default`);

		const writeJson = (path: string, value: unknown) => {
			mkdirSync(join(path, ".."), { recursive: true });
			writeFileSync(path, JSON.stringify(value, null, "\t"));
		};
		writeJson(join(staging, "package.json"), {
			AppVersion: "7.5.0.22885",
			DeviceModel: profile.device.model,
			DeviceSettings: null,
			FormatVersion: 1,
			OSType: "macOS",
			OSVersion: "26.0",
			RequiredPlugins: [manifest.UUID],
		});
		writeJson(join(profileDir, "manifest.json"), {
			Device: { Model: profile.device.model, UUID: "" },
			Name: profile.name,
			Pages: { Current: pageIds[0], Default: defaultId, Pages: pageIds },
			Version: "3.0",
		});
		writeJson(join(profileDir, "Profiles", defaultId.toUpperCase(), "manifest.json"), pageManifest(profile, undefined));
		profile.pages.forEach((_page, index) => writeJson(join(profileDir, "Profiles", pageIds[index]!.toUpperCase(), "manifest.json"), pageManifest(profile, index)));

		const output = join(pluginDir, "profiles", `${profile.file}.streamDeckProfile`);
		mkdirSync(join(output, ".."), { recursive: true });
		rmSync(output, { force: true });
		execFileSync("/usr/bin/zip", ["-X", "-q", "-r", output, "package.json", "Profiles"], { cwd: staging });
		console.log(`wrote ${output}`);
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}
