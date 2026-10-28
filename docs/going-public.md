# Going public

Steps for the day the repository becomes public. Until then everything stays private.

1. Make the repository public (Settings → General → Danger zone).
2. Protect main with the saved ruleset (pull requests, squash only, passing `check`, no force-push or deletion; repository admins bypass for now):
   `gh api -X POST repos/alejandrom2/turnkey/rulesets --input .github/ruleset-main.json`
   To remove the admin bypass later, edit the ruleset in Settings → Rules and clear its bypass list.
3. Allow auto-merge: `gh api -X PATCH repos/alejandrom2/turnkey -F allow_auto_merge=true`
4. Security (Settings → Code security): turn on private vulnerability reporting, secret scanning with push protection, and Dependabot alerts.
5. Discussions: make sure an **Ideas** category exists; the issue form links to it.
6. Add `"URL": "https://github.com/alejandrom2/turnkey"` to the manifest (validation checks it answers) and set the repository's homepage.
7. Upload `docs/social-preview.png` (from `scripts/marketplace/logo.ts`) as the social preview (Settings → General → Social preview; there's no API for it).
8. Share the repository with the T3 Code team and wait for their reply before listing anything. Turnkey carries T3 Code's name and mark.
9. Once they're fine with it, submit to the Marketplace from Maker Console, as a free product, with the latest release's `.streamDeckPlugin` and `docs/listing.md`. Leave the EULA empty. Keep any donation link to the GitHub README, never the listing or the plugin.
