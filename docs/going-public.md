# Going public

Steps for the day the repository becomes public. Until then everything stays private.

1. Ask GitHub Support to purge `scripts/marketplace` from the repository's cached views and pull request refs. It was removed from the history with a force-push, but GitHub still serves old commits by SHA and through every PR's refs until it garbage-collects them.
2. Make the repository public (Settings → General → Danger zone).
3. Protect main with the saved ruleset (pull requests, squash only, passing `check`, no force-push or deletion; repository admins bypass for now):
   `gh api -X POST repos/alejandrom2/turnkey/rulesets --input .github/ruleset-main.json`
   To remove the admin bypass later, edit the ruleset in Settings → Rules and clear its bypass list.
4. Allow auto-merge: `gh api -X PATCH repos/alejandrom2/turnkey -F allow_auto_merge=true`
5. Security (Settings → Code security): turn on private vulnerability reporting, secret scanning with push protection, and Dependabot alerts.
6. Discussions: make sure an **Ideas** category exists; the issue form links to it.
7. Add `"URL": "https://github.com/alejandrom2/turnkey"` to the manifest (validation checks it answers) and set the repository's homepage.
8. Upload `docs/social-preview.png` (rendered by the private turnkey-marketing repository) as the social preview (Settings → General → Social preview; there's no API for it).
9. Share the repository with the T3 Code team and wait for their reply before listing anything. Turnkey carries T3 Code's name and mark.
10. Once they're fine with it, submit to the Marketplace from Maker Console, as a free product, with the latest release's `.streamDeckPlugin` and `docs/listing.md`. Leave the EULA empty. Keep any donation link to the GitHub README, never the listing or the plugin.
