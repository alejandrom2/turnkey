# Security policy

Please report security problems privately through [GitHub's private vulnerability reporting](../../security/advisories/new) for this repository, not in a public issue. You'll get a reply as soon as possible, and a fix before the details are made public.

Turnkey holds T3 Code access tokens in Stream Deck's global settings, or for Logitech in an owner-only file in the plugin's data folder; it pairs through T3 Code pair links, serves the Logitech settings page on this computer only (127.0.0.1), and can be granted extra access per machine (provider accounts, terminals, guest links, updates). Reports about any of these, or about anything that lets a page, a profile or another plugin reach them, are especially welcome.

Problems in T3 Code itself belong to T3 Code: see its [security policy](https://github.com/pingdotgg/t3code/blob/main/.github/SECURITY.md).
