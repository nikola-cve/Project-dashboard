# Plan — Command Center (v4)

Turn the dashboard into a tabbed mission control with persistent project memory.

## Goals
- A one-glance **Overview** (status, alerts, last session, next handoff, deploy).
- **Memory**: sessions, handoffs, decisions, and specs rendered from the repo.
- **Activity**: a unified feed of commits, PRs, task moves, sessions, deploys.
- **Risk**: register + blockers + CI/test status.
- **Fleet**: every configured project on one screen.

## Non-goals (for now)
- No live local process monitoring in the cloud (only committed status files).
- No new write paths beyond the existing task editor.

## Notes
Data lives in the repo (markdown/JSON) so the phone/cloud can read it via the
GitHub API, and it doubles as durable memory.
