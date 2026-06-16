# Project Dashboard — working memory & conventions

This file is auto-loaded into every Claude Code session in this repo. It is the
project's **second brain**: read it at the start of a session, and update the
memory files at the end.

## What this project is
A read-only-first **command center** for builders using LLMs. Two delivery
modes: a local Python dashboard (`dashboard/`) and a cloud Vercel app
(`api/` + `lib/` + static files) that reads the project from GitHub behind a
login. The board can also write task changes back to `TASKS.md`.

## The memory convention (the dashboard reads these)
- `memory/sessions/YYYY-MM-DD-slug.md` — one file per working session. Start with
  a `# Title`, then sections: **Did**, **Decisions**, **Next**. Newest shows as
  "Last session" on the dashboard Overview.
- `memory/handoffs/next.md` — the current handoff: what the next session should
  pick up first. Keep it short and current.
- `memory/decisions/NNNN-slug.md` — one architectural decision per file (ADR
  style): context, decision, consequences.
- `memory/agents.json` — status of any autonomous loops/agents (name, last
  wakeup, current task, healthy/stale). Commit updates so the cloud can see them.
- `RISK.json` — the risk register (id, title, severity, status, notes).
- `Plans/*.md`, `PRDs/*.md` — specs the dashboard's Memory tab renders.

## Session-end checklist (do this before you stop)
1. Append a `memory/sessions/<today>-<slug>.md` with Did / Decisions / Next.
2. Update `memory/handoffs/next.md` so the next session knows where to start.
3. If you made an architectural call, add a `memory/decisions/NNNN-*.md`.
4. Update `TASKS.md` statuses (or move cards on the board, which commits for you).

## Source of truth for progress
`TASKS.md` — a header-driven markdown table
(`id | title | phase | status | priority | due | assignee | labels | est | done_on | notes`).
The dashboard computes the big % and the board from it.
