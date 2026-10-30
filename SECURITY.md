# Security

## Reporting a problem

Please don't open a public issue. Report it privately on GitHub: **Security → Report a
vulnerability** ([new advisory](https://github.com/H4kken/vitryne/security/advisories/new)).
Say what an attacker could do, and how to reproduce it. You'll get an answer there, and credit
in the advisory if you'd like it.

In scope: the editor, the web image and its Caddy configuration
(`packages/vitryne-cloud/deploy/`), and the backend's schema and row-level security
(`packages/vitryne-cloud/supabase/`): one person reaching another's projects, files or account
is the most serious kind of problem. [Cloud backend](packages/vitryne-docs/content/docs/developers/cloud.md#security) describes what the
backend guarantees. A problem in Supabase itself goes to
[Supabase](https://supabase.com/.well-known/security.txt).

## Supported versions

The latest release, and vitryne.app. Self-hosted instances get fixes by updating to a new
release (packages/vitryne-docs/content/docs/developers/cloud.md, Running the editor).
