// Fails when a commit subject isn't a conventional commit, so release notes and versions come out right:
// `node scripts/commits.ts <from>..<to>` (CI), or `node scripts/commits.ts --message <file>` (the commit-msg hook).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TYPES = ["feat", "fix", "docs", "build", "chore", "test", "refactor", "perf", "ci", "style", "revert"];
const CONVENTIONAL = new RegExp(`^(${TYPES.join("|")})(\\([\\w./-]+\\))?!?: \\S`);
// Merges and release-please's own commits are exempt.
const EXEMPT = /^(Merge |Revert ")/;

export const conventional = (subject: string): boolean => EXEMPT.test(subject) || CONVENTIONAL.test(subject);

const [flag, value] = process.argv.slice(2);
const subjects =
	flag === "--message"
		? [readFileSync(value!, "utf8").split("\n")[0]!]
		: execFileSync("git", ["log", "--format=%s", flag ?? "HEAD~1..HEAD"], { encoding: "utf8" }).split("\n").filter(Boolean);
const bad = subjects.filter((subject) => !conventional(subject));
if (bad.length > 0) {
	console.error(`Not conventional commits (type(scope): subject, types: ${TYPES.join(", ")}):\n${bad.map((subject) => `  ${subject}`).join("\n")}`);
	process.exit(1);
}
console.log(`${subjects.length} commit message(s) OK`);
