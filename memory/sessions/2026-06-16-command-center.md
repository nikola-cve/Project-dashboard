# Command Center (v4) — tabbed mission control

Building the dashboard into a full command center with a tabbed layout and a
"second brain" memory system, inspired by an Obsidian-vault-for-Claude workflow.

## Did
- Restructured the UI into tabs: **Overview · Board · Memory · Activity · Risk · Fleet**.
- Added a dependency-free Markdown renderer (`lib/md.js`) used to render session
  notes, handoffs, decisions, and specs safely (HTML escaped first).
- New cloud endpoints: `overview`, `memory`, `activity`, `risk`, `ops`, `fleet`.
- New GitHub helpers: directory listing, Actions runs, deployments, releases.
- Seeded this `memory/` convention + `CLAUDE.md` so future sessions auto-log.

## Decisions
- Only the **active tab** fetches/polls its endpoint, to stay within GitHub API
  rate limits on the cloud version.
- Memory lives as plain markdown in the repo so it's editable anywhere and the
  cloud (phone) can read it via the GitHub API.

## Next
- Verify each tab on the phone after deploy; confirm alerts fire only when opted in.
- Wire a tiny CI workflow so the Risk tab shows a real green/red check.
