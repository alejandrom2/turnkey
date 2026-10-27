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

/** A page's dials replace the shared ones when set. */
type Page = { name: string; keys: Placed[][]; dials?: Placed[] };

type Profile = { file: string; name: string; deviceModel: string; deviceType: number; columns: number; pages: Page[]; dials: boolean };

/** Every action appears at least once, so the profile doubles as a tour of what the deck can do. */
const PROFILES: Profile[] = [
	{
		file: "t3-deck-plus",
		name: "T3 Deck",
		deviceModel: "20GBD9901",
		deviceType: 7,
		columns: 4,
		dials: true,
		pages: [
			{
				name: "T3 DECK",
				keys: [
					[slot(), slot(), slot(), slot()],
					[
						{ action: "activity", name: "Activity" },
						{ action: "new", name: "New Thread" },
						{ action: "send", name: "Send Prompt", settings: { prompt: "Continue", title: "Continue" } },
						{ action: "stop", name: "Stop" },
					],
				],
			},
			{
				name: "THREADS",
				keys: [
					[slot(5), slot(6), slot(7), slot(8)],
					[slot(9), slot(10), slot(11), slot(12)],
				],
				dials: [{ action: "dial.threads", name: "Threads Dial", settings: { filter: "all" } }, { action: "dial.threads", name: "Threads Dial", settings: { filter: "active" } }, { action: "dial.threads", name: "Threads Dial", settings: { filter: "unread" } }, DIALS[3]!],
			},
			{
				name: "CONTROLS",
				keys: [
					[
						{ action: "model", name: "Model" },
						{ action: "effort", name: "Effort" },
						{ action: "speed", name: "Speed" },
						{ action: "permissions", name: "Permissions" },
					],
					[
						{ action: "plan", name: "Plan" },
						{ action: "steer", name: "Steer", settings: { title: "Keep it small", prompt: "Keep the change small and focused." } },
						{ action: "approve", name: "Approve" },
						{ action: "deny", name: "Deny" },
					],
				],
				dials: [power("model"), power("effort"), power("permissions"), DIALS[3]!],
			},
			{
				name: "PROMPTS",
				keys: [
					[quick("continue"), quick("test"), quick("fix"), quick("explain")],
					[quick("commit"), organize("settle"), organize("pin"), organize("snooze")],
				],
				dials: [DIALS[0]!, DIALS[2]!, { action: "dial.queue", name: "Queue Dial" }, DIALS[3]!],
			},
			{
				name: "SKILLS",
				keys: [
					[skill(), skill(), skill(), skill()],
					[
						{ action: "fork", name: "Fork" },
						{ action: "merge", name: "Merge Back" },
						{ action: "workflow.stop", name: "Stop Workflow" },
						{ action: "branch", name: "Branch" },
					],
				],
				dials: [{ action: "dial.skills", name: "Skills Dial" }, DIALS[0]!, { action: "dial.queue", name: "Queue Dial" }, DIALS[3]!],
			},
			{
				name: "GIT",
				keys: [
					[
						{ action: "git.commit", name: "Commit" },
						{ action: "git.push", name: "Push" },
						{ action: "git.pr", name: "Create PR" },
						{ action: "git.pull", name: "Pull" },
					],
					[
						{ action: "branch", name: "Branch" },
						{ action: "editor", name: "Open in Editor" },
						organize("archive"),
						{ action: "health", name: "Health" },
					],
				],
				dials: [DIALS[0]!, { action: "dial.pr", name: "PR Dial" }, power("model"), DIALS[3]!],
			},
			{
				name: "PULL REQUESTS",
				keys: [
					[
						{ action: "pr", name: "Pull Request" },
						{ action: "pr.fix", name: "Fix Findings" },
						{ action: "pr.explain", name: "Explain PR" },
						{ action: "pr.ask", name: "Ask about PR" },
					],
					[
						{ action: "pr.guide", name: "Review Guide" },
						{ action: "git.pr", name: "Create PR" },
						{ action: "editor", name: "Open in Editor" },
						{ action: "stop", name: "Stop" },
					],
				],
				dials: [{ action: "dial.pr", name: "PR Dial" }, DIALS[0]!, DIALS[2]!, DIALS[3]!],
			},
			{
				name: "DEVICES",
				keys: [
					[{ action: "preview", name: "Open Preview" }, { action: "editor", name: "Open in Editor" }, quick("test"), { action: "stop", name: "Stop" }],
					[organize("snooze"), organize("wake"), { action: "approve", name: "Approve" }, { action: "health", name: "Health" }],
				],
				dials: [{ action: "dial.devices", name: "Devices Dial" }, DIALS[0]!, { action: "dial.queue", name: "Queue Dial" }, DIALS[3]!],
			},
			{
				name: "TASKS",
				keys: [
					[task(), task(), task(), task()],
					[quick("continue"), { action: "stop", name: "Stop" }, { action: "approve", name: "Approve" }, { action: "health", name: "Health" }],
				],
				dials: [{ action: "dial.tasks", name: "Tasks Dial" }, { action: "dial.queue", name: "Queue Dial" }, DIALS[0]!, DIALS[3]!],
			},
			{
				name: "ADMIN",
				keys: [
					[{ action: "update", name: "Update T3" }, script(), script(), script()],
					[{ action: "share", name: "Share Thread" }, { action: "health", name: "Health" }, { action: "editor", name: "Open in Editor" }, { action: "stop", name: "Stop" }],
				],
			},
			{
				name: "USAGE",
				keys: [
					[limits("codex", "session"), limits("codex", "weekly"), limits("claudeAgent", "session"), limits("claudeAgent", "weekly")],
					[usage("1"), usage("7"), usage("30"), { action: "health", name: "Health" }],
				],
				dials: [{ action: "dial.limits", name: "Limits Dial" }, { action: "dial.usage", name: "Usage Dial", settings: { period: "7" } }, DIALS[0]!, DIALS[3]!],
			},
		],
	},
];

function pageManifest(profile: Profile, page: Page | undefined) {
	const keys = Object.fromEntries(
		(page?.keys ?? []).flatMap((row, y) => row.map((placed, x) => [`${x},${y}`, entry(`${profile.file}:${page!.name}:key:${x},${y}`, placed)])),
	);
	const controllers: { Actions: Record<string, unknown> | null; Type: string }[] = [{ Actions: page ? keys : null, Type: "Keypad" }];
	if (profile.dials) {
		const dials = Object.fromEntries((page?.dials ?? DIALS).map((placed, x) => [`${x},0`, entry(`${profile.file}:${page?.name}:dial:${x}`, placed)]));
		controllers.push({ Actions: page ? dials : null, Type: "Encoder" });
	}
	return { Controllers: controllers, Icon: "", Name: page?.name ?? "" };
}

for (const profile of PROFILES) {
	const staging = mkdtempSync(join(tmpdir(), "t3-deck-profile-"));
	try {
		const profileId = uuid(`${profile.file}:profile`).toUpperCase();
		const profileDir = join(staging, "Profiles", `${profileId}.sdProfile`);
		const pageIds = profile.pages.map((page) => uuid(`${profile.file}:page:${page.name}`));
		const defaultId = uuid(`${profile.file}:page:default`);

		const writeJson = (path: string, value: unknown) => {
			mkdirSync(join(path, ".."), { recursive: true });
			writeFileSync(path, JSON.stringify(value, null, "\t"));
		};
		writeJson(join(staging, "package.json"), {
			AppVersion: "7.5.0.22885",
			DeviceModel: profile.deviceModel,
			DeviceSettings: null,
			FormatVersion: 1,
			OSType: "macOS",
			OSVersion: "26.0",
			RequiredPlugins: [manifest.UUID],
		});
		writeJson(join(profileDir, "manifest.json"), {
			Device: { Model: profile.deviceModel, UUID: "" },
			Name: profile.name,
			Pages: { Current: pageIds[0], Default: defaultId, Pages: pageIds },
			Version: "3.0",
		});
		writeJson(join(profileDir, "Profiles", defaultId.toUpperCase(), "manifest.json"), pageManifest(profile, undefined));
		profile.pages.forEach((page, index) => writeJson(join(profileDir, "Profiles", pageIds[index].toUpperCase(), "manifest.json"), pageManifest(profile, page)));

		const output = join(pluginDir, "profiles", `${profile.file}.streamDeckProfile`);
		mkdirSync(join(output, ".."), { recursive: true });
		rmSync(output, { force: true });
		execFileSync("/usr/bin/zip", ["-X", "-q", "-r", output, "package.json", "Profiles"], { cwd: staging });
		console.log(`wrote ${output}`);
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}
