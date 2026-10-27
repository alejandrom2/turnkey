import { describe, expect, it } from "vitest";

import { findSkill, mentionable, type ProviderSkill, skillMessage, threadSkills } from "./skills.js";

/** T3 Code's adapters find skills in the text with this global pattern (packages/shared/src/composerInlineTokens.ts). */
const T3_SKILL_MENTIONS =
	/(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/gu;
const mentionsIn = (text: string) => [...text.matchAll(T3_SKILL_MENTIONS)].map((match) => match[2]);

const skill = (name: string, extra: Partial<ProviderSkill> = {}): ProviderSkill => ({ name, enabled: true, ...extra });

describe("skillMessage", () => {
	it("sends what T3 Code's composer sends for a picked skill: `$name`, trimmed", () => {
		expect(skillMessage("review")).toBe("$review");
		expect(skillMessage("review", "  focus on auth ")).toBe("$review focus on auth");
	});

	it("is read by T3 Code's adapters as that skill, also behind the Ultrathink prefix", () => {
		expect(mentionsIn(skillMessage("frontend-design:review"))).toEqual(["frontend-design:review"]);
		expect(mentionsIn(`Ultrathink: ${skillMessage("review", "then commit")}`)).toEqual(["review"]);
	});
});

describe("mentionable", () => {
	it("accepts names T3 Code's pattern reads whole, and refuses the rest", () => {
		expect(mentionable("review")).toBe(true);
		expect(mentionable("v2-check")).toBe(true);
		expect(mentionable("pdf.tools")).toBe(false);
		expect(mentionable("10k")).toBe(false);
		expect(mentionable("123")).toBe(false);
	});
});

describe("threadSkills", () => {
	it("prefers the checkout's snapshot over the provider's list", () => {
		const provider = { skills: [skill("global")] };
		expect(threadSkills(provider, { cwd: "/repo", skills: [skill("repo-only")] }).map((entry) => entry.name)).toEqual(["repo-only"]);
		expect(threadSkills(provider, undefined).map((entry) => entry.name)).toEqual(["global"]);
	});

	it("keeps what a user may start, once per name ignoring case", () => {
		const skills = [skill("Review"), skill("review"), skill("off", { enabled: false }), skill("agent-only", { userInvocable: false }), skill("pdf.tools"), skill("ship")];
		expect(threadSkills({ skills }, undefined).map((entry) => entry.name)).toEqual(["Review", "ship"]);
		expect(threadSkills(undefined, undefined)).toEqual([]);
	});

	it("finds a saved name whatever its case", () => {
		expect(findSkill([skill("Review")], " review ")?.name).toBe("Review");
	});
});
