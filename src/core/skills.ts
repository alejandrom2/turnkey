/**
 * Provider skills as T3 Code's composer offers and sends them. A picked skill is plain text in the message, `$name`,
 * which each provider's adapter rewrites (Claude to `/name`); nothing else goes with it
 * (apps/web/src/components/chat/ChatComposer.tsx, packages/client-runtime/src/providerSkills.ts). Pure.
 */

/** `ServerProviderSkill` (packages/contracts/src/server.ts), the fields the deck reads. */
export type ProviderSkill = {
	name: string;
	description?: string;
	shortDescription?: string;
	displayName?: string;
	enabled: boolean;
	userInvocable?: boolean;
};

/** `ServerProviderWorkspaceSnapshot`: one checkout's skills, which include the repo's own. */
export type WorkspaceSnapshot = { cwd: string; skills?: ProviderSkill[]; slashCommandsPending?: boolean };

/** How long T3 Code trusts a checkout's snapshot (`PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS`). */
export const WORKSPACE_SNAPSHOT_TTL_MS = 5 * 60_000;

/** T3 Code's `SKILL_MENTION_PATTERN` (packages/shared/src/composerInlineTokens.ts): what its adapters read as a skill. */
const MENTION_SOURCE = /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)/u.source;
const MENTION = new RegExp(`${MENTION_SOURCE}(?=\\s|$)`, "u");

/** Whether T3 Code's adapters would read `$name` as this skill; other names can't be run from text. */
export function mentionable(name: string): boolean {
	const match = MENTION.exec(`$${name}`);
	return match !== null && match.index === 0 && match[2] === name;
}

/**
 * The skills a thread's composer offers: its checkout's snapshot, else the provider's own list; enabled ones a user
 * may start (`isProviderSkillUserInvocable`, which Claude's adapter also requires), once per name.
 */
export function threadSkills(provider: { skills?: ProviderSkill[] } | undefined, snapshot: WorkspaceSnapshot | undefined): ProviderSkill[] {
	const seen = new Set<string>();
	return (snapshot?.skills ?? provider?.skills ?? []).filter((skill) => {
		const key = skill.name.trim().toLowerCase();
		if (!skill.enabled || skill.userInvocable === false || !mentionable(skill.name) || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** The message that runs `skill`: T3 Code's composer inserts `$name `, then trims the prompt it sends. */
export function skillMessage(name: string, extra?: string): string {
	return `$${name} ${extra?.trim() ?? ""}`.trim();
}

export const skillLabel = (skill: ProviderSkill): string => skill.displayName?.trim() || skill.name;

export const skillDescription = (skill: ProviderSkill): string | undefined => skill.shortDescription?.trim() || skill.description?.trim() || undefined;

/** The skill a setting names, matched as T3 Code dedupes names: ignoring case. */
export const findSkill = (skills: readonly ProviderSkill[], name: string): ProviderSkill | undefined =>
	skills.find((skill) => skill.name.toLowerCase() === name.trim().toLowerCase());
