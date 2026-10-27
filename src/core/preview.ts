/**
 * A thread's preview, as T3 Code's preview panel and HTML renders expose it (packages/contracts/src/preview.ts,
 * packages/shared/src/htmlRender.ts). The deck only reads: opening a preview needs `preview:operate`.
 */

/** A `PreviewSessionSnapshot`, the parts the deck reads. */
export type PreviewSession = {
	threadId: string;
	tabId: string;
	navStatus: { _tag: string; url?: string; title?: string };
	updatedAt: string;
};

/** A `subscribePreviewEvents` value, the parts the deck reads. */
export type PreviewEvent = { type: string; threadId: string; tabId: string; revision: number; snapshot?: PreviewSession };

/** The page a thread's preview shows: its newest tab with a web page loaded or loading. */
export function currentPreview(sessions: readonly PreviewSession[]): { url: string; title: string } | undefined {
	let best: PreviewSession | undefined;
	for (const session of sessions) {
		if (webUrl(session.navStatus.url) === undefined) continue;
		if (best === undefined || session.updatedAt > best.updatedAt) best = session;
	}
	if (best === undefined) return undefined;
	const url = best.navStatus.url!;
	return { url, title: best.navStatus.title?.trim() || new URL(url).host };
}

const webUrl = (url: string | undefined): URL | undefined => {
	if (url === undefined || !URL.canParse(url)) return undefined;
	const parsed = new URL(url);
	return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
};

/** A thread's sessions after one event: opened or moved tabs replace their old snapshot, closed ones leave. */
export function applyPreviewEvent(sessions: readonly PreviewSession[], event: PreviewEvent): PreviewSession[] {
	const others = sessions.filter((session) => session.tabId !== event.tabId);
	if (event.type === "closed") return others;
	return event.snapshot === undefined ? [...sessions] : [...others, event.snapshot];
}

/** Hosts that mean "this computer": a preview there on another machine can't be reached from here. */
export function isLoopbackHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	return host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0" || host.startsWith("127.");
}

/** Whether `url` opens here: a loopback address on another machine only means that machine. */
export const reachableHere = (url: string, machineIsHere: boolean): boolean => machineIsHere || !isLoopbackHost(new URL(url).hostname);

/** An `html_render` tool call's page: what the web's `htmlRenderFromToolItem` reads. */
export type HtmlRender = { itemId: string; attachmentId: string; title: string };

/** A turn item, the parts an HTML render is found in. */
export type RenderItem = { id: string; type: string; status?: string; toolName?: string | null; output?: unknown; outputOmitted?: boolean };

/** T3 Code's own tool, by any of the names providers give it (`mcp__t3-code__html_render`, `t3_code.html_render`, …). */
export function isHtmlRenderTool(toolName: string | null | undefined): boolean {
	const label = toolName?.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
	if (label === undefined) return false;
	return label === "html_render" || /^(?:mcp(?:__|[-_]{1,2}))?t3[-_ ]?code.*[_.:/ ·]html_render$/i.test(label);
}

/** The newest finished `html_render` call; `attachmentId` is empty when its output was withheld and must be read by id. */
export function latestHtmlRender(items: readonly RenderItem[]): HtmlRender | { itemId: string; omitted: true } | undefined {
	for (let index = items.length - 1; index >= 0; index--) {
		const item = items[index]!;
		if (item.type !== "dynamic_tool" || item.status !== "completed" || !isHtmlRenderTool(item.toolName)) continue;
		if (item.output === undefined && item.outputOmitted === true) return { itemId: item.id, omitted: true };
		const found = htmlRenderOutput(item.output);
		if (found !== undefined) return { itemId: item.id, ...found };
	}
	return undefined;
}

/** Digs `htmlRender` out of an MCP result: JSON text, `structuredContent`, or content blocks (shared/toolOutput.ts). */
export function htmlRenderOutput(value: unknown, depth = 0): { attachmentId: string; title: string } | undefined {
	if (depth > 4 || value == null) return undefined;
	if (typeof value === "string") {
		try {
			return htmlRenderOutput(JSON.parse(value), depth + 1);
		} catch {
			return undefined;
		}
	}
	if (Array.isArray(value)) {
		for (const block of value) {
			const text = (block as { text?: unknown } | null)?.text;
			const found = htmlRenderOutput(typeof text === "object" && text !== null ? ((text as { text?: unknown }).text ?? text) : text, depth + 1);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	if (typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (record.isError === true || record.is_error === true) return undefined;
	const content = record.structuredContent ?? record.content;
	if (content !== undefined) return htmlRenderOutput(content, depth + 1);
	const render = record.htmlRender as { attachmentId?: unknown; title?: unknown } | undefined;
	if (typeof render?.attachmentId !== "string" || render.attachmentId === "" || render.attachmentId.length > 256) return undefined;
	return { attachmentId: render.attachmentId, title: (typeof render.title === "string" ? render.title.trim() : "") || "HTML" };
}

/** The file name T3 Code gives a render's page (`htmlRenderFileName`). */
export function htmlRenderFileName(title: string): string {
	const name = title
		.replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120)
		.trim();
	return `${name || "Page"}.html`;
}
