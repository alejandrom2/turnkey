/**
 * The page the browser lands on after T3 Code's approval screen. It continues that screen's look
 * (StandalonePage + ConnectAgentSurface in T3 Code's apps/web), so the hand-off feels like one flow.
 */

const escapeHtml = (value: string) =>
	value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

const STYLES = `
	:root {
		color-scheme: light dark;
		--background: #fcfcfd; --foreground: #18181b; --card: rgb(255 255 255 / 90%); --muted: #71717a;
		--border: #e4e4e7; --primary: oklch(0.488 0.217 264); --glow: rgb(16 185 129 / 14%); --side-glow: rgb(14 165 233 / 10%);
		--success: #047857; --success-surface: rgb(16 185 129 / 12%); --error: #dc2626; --error-surface: rgb(239 68 68 / 12%);
		font-family: -apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif;
	}
	@media (prefers-color-scheme: dark) {
		:root {
			--background: #0a0a0a; --foreground: #f5f5f5; --card: rgb(18 18 18 / 90%); --muted: #a3a3a3;
			--border: rgb(255 255 255 / 8%); --primary: oklch(0.571 0.21 264);
			--success: #34d399; --error: #f87171;
		}
	}
	[data-tone="error"] { --glow: rgb(239 68 68 / 16%); --side-glow: transparent; }
	* { box-sizing: border-box; }
	html, body { height: 100%; }
	body {
		margin: 0; display: grid; place-items: center; padding: 40px 16px; overflow: hidden;
		background: linear-gradient(145deg, color-mix(in srgb, var(--background) 90%, black) 0%, var(--background) 55%);
		color: var(--foreground);
	}
	body::before, body::after { content: ""; position: fixed; pointer-events: none; }
	body::before { inset: 0 0 auto 0; height: 26rem; background: radial-gradient(44rem 16rem at top, var(--glow), transparent); }
	body::after { inset: 0 auto 0 0; width: 40rem; background: radial-gradient(28rem 18rem at left, var(--side-glow), transparent); }
	section {
		position: relative; z-index: 1; width: 100%; max-width: 36rem; padding: 32px;
		border: 1px solid var(--border); border-radius: 16px; background: var(--card);
		box-shadow: 0 25px 50px -12px rgb(0 0 0 / 20%); backdrop-filter: blur(12px);
	}
	.badge {
		display: inline-grid; place-items: center; width: 40px; height: 40px; margin-bottom: 20px; border-radius: 12px;
		background: var(--success-surface); color: var(--success);
	}
	[data-tone="error"] .badge { background: var(--error-surface); color: var(--error); }
	.badge svg { width: 20px; height: 20px; }
	.eyebrow { margin: 0; font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--primary); }
	h1 { margin: 8px 0 0; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; }
	p.lede { margin: 8px 0 0; font-size: 14px; line-height: 1.6; color: var(--muted); }
	p.note { margin: 16px 0 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
	@media (max-width: 480px) { section { padding: 24px; } h1 { font-size: 24px; } }
`;

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const ALERT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>`;

const DESCRIBED_ERRORS: Record<string, string> = {
	access_denied: "The sign-in was denied in T3 Code.",
	invalid_request: "T3 Code rejected the sign-in request.",
	server_error: "T3 Code could not finish the sign-in.",
};

export function describeAuthorizationError(error: string | null): string {
	return (error !== null && DESCRIBED_ERRORS[error]) || "The sign-in response was missing or did not match this request.";
}

export function renderCallbackPage(result: { ok: true } | { ok: false; message: string }): string {
	const [title, lede, note, icon] = result.ok
		? [
				"T3 Deck is connected",
				"Your keys and dials now follow your threads. You can close this tab and go back to Stream Deck.",
				"Change what T3 Deck may do any time by signing out from its settings and signing in again.",
				CHECK,
			]
		: [
				"This sign-in cannot continue",
				result.message,
				"Close this page and start the sign-in again from T3 Deck's settings in Stream Deck.",
				ALERT,
			];
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="color-scheme" content="light dark" />
		<title>${result.ok ? "T3 Deck connected" : "Sign-in failed"}</title>
		<style>${STYLES}</style>
	</head>
	<body data-tone="${result.ok ? "pairing" : "error"}">
		<section role="status">
			<span class="badge" aria-hidden="true">${icon}</span>
			<p class="eyebrow">Agent sign-in</p>
			<h1>${escapeHtml(title)}</h1>
			<p class="lede">${escapeHtml(lede)}</p>
			<p class="note">${escapeHtml(note)}</p>
		</section>
	</body>
</html>`;
}
