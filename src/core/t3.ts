/**
 * The slice of T3 Code's MCP tool contracts the deck uses.
 * Source of truth: packages/contracts/src/orchestratorMcp.ts in the T3 Code repo.
 */

export type RunStatus =
	| "preparing"
	| "queued"
	| "starting"
	| "running"
	| "waiting"
	| "completed"
	| "interrupted"
	| "failed"
	| "cancelled"
	| "rolled_back";
export type ThreadStatus = "idle" | RunStatus;

export type OptionValue = string | boolean;
export type ModelSelection = {
	instanceId: string;
	model: string;
	options?: { id: string; value: OptionValue }[];
};

export type Project = { id: string; title: string };

export type ThreadListItem = {
	threadId: string;
	title: string;
	status: ThreadStatus;
	latestRunId: string | null;
	providerInstanceId: string;
	model: string;
	parentThreadId: string | null;
	updatedAt: string;
};

export type ThreadDetail = ThreadListItem & {
	projectId: string;
	activeRunId: string | null;
	pendingRequestCount: number;
};

export type Question = {
	id: string;
	header: string;
	question: string;
	options: { label: string; description: string; value?: string }[];
	multiSelect?: boolean;
};

export type ModelOption = { id: string; values: OptionValue[]; default?: OptionValue };
export type ProviderCapability = {
	providerInstanceId: string;
	displayName: string | null;
	models: { id: string; label?: string; options?: ModelOption[] }[];
};

export type ThreadConfiguration = { threadId: string; modelSelection: ModelSelection };

export interface ToolCaller {
	call<T>(name: string, args: Record<string, unknown>): Promise<T>;
}

export class ToolError extends Error {
	constructor(
		readonly tool: string,
		readonly code: string,
		message: string,
	) {
		super(`${tool}: ${message}`);
	}
}

/** Active means the agent's turn is not over yet. A finished turn stays `waiting` while post-turn work drains. */
export const isActive = (status: ThreadStatus): boolean =>
	status === "preparing" || status === "queued" || status === "starting" || status === "running";

export const answerValue = (option: Question["options"][number]): string => option.value ?? option.label;
