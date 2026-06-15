# Project Tasks

This is the dashboard's source of truth for "what's done" vs "what's not done."
Hand-edit it as you work, or edit cards right from the dashboard. The dashboard
re-reads this file on every refresh.

## How to use it

- Keep the table below. One row per task. **Columns are matched by their header
  name**, so you can reorder them or add your own.
- **status**: `done`, `in-progress`, or `not-started`
  (aliases also accepted: `todo`, `wip`, `complete`, `blocked`).
- **priority**: `high`, `medium`, or `low` (optional).
- **due**: a date `YYYY-MM-DD` (optional). Shows red when overdue, amber when due
  within 7 days — unless the task is done.
- **assignee**: who's on it (optional). Shown as initials on the card.
- **labels**: comma-separated tags (optional), e.g. `frontend, api`.
- **est**: optional time estimate (`2h`, `1d`). Blank → `—`.
- **done_on**: optional completion date for finished tasks.
- **phase** groups tasks into the phases shown on the dashboard.
- Lines starting with `#` outside the table are ignored.

## Phases

Each phase can have a one-line intent after `### Phase N — Name` using a
`> intent:` line.

### Phase 1 — Dashboard server
> intent: A zero-dependency Python server that reads the project's git history and task files and serves the live state as JSON.

| id  | title                                            | phase | status | priority | due        | assignee | labels            | est | done_on    | notes |
|-----|--------------------------------------------------|-------|--------|----------|------------|----------|-------------------|-----|------------|-------|
| 1.1 | Stdlib HTTP server bound to 127.0.0.1            | 1     | done   | high     | 2026-06-15 | claude   | backend, server   | 2h  | 2026-06-15 | Read-only, no caching |
| 1.2 | Git helpers (log, status, branches, file counts) | 1     | done   | high     | 2026-06-15 | claude   | backend, git      | 2h  | 2026-06-15 | Degrades when git is absent |
| 1.3 | TASKS.md parser with last-good-snapshot fallback | 1     | done   | medium   | 2026-06-15 | claude   | backend, parser   | 2h  | 2026-06-15 | Tolerates mid-write reads |
| 1.4 | Phase aggregation + overall percentage           | 1     | done   | medium   | 2026-06-15 | claude   | backend           | 1h  | 2026-06-15 | done / in-progress / not-started |
| 1.5 | Commit-hygiene + "tackle this next" heuristics   | 1     | done   | low      | 2026-06-15 | claude   | backend           | 2h  | 2026-06-15 | From the real diff |

### Phase 2 — Frontend cards
> intent: A plain-English, light-minimal web UI that renders the dashboard sections and polls live.

| id  | title                                          | phase | status | priority | due        | assignee | labels             | est | done_on    | notes |
|-----|------------------------------------------------|-------|--------|----------|------------|----------|--------------------|-----|------------|-------|
| 2.1 | Header, hero big-% and remaining-work bar      | 2     | done   | high     | 2026-06-15 | claude   | frontend           | 2h  | 2026-06-15 | State badge always visible |
| 2.2 | What's-left / what's-done phase lists          | 2     | done   | medium   | 2026-06-15 | claude   | frontend           | 2h  | 2026-06-15 | Intent vs reality |
| 2.3 | Today / Right-now / Commits + hygiene cards    | 2     | done   | medium   | 2026-06-15 | claude   | frontend           | 2h  | 2026-06-15 | Local-zone time |
| 2.4 | Light-minimal theme + accessibility            | 2     | done   | low      | 2026-06-15 | claude   | frontend, a11y     | 1h  | 2026-06-15 | AA contrast, keyboard nav |

### Phase 3 — Cloud + login
> intent: A Vercel variant that reads the project from GitHub behind a login, so it works from a phone.

| id  | title                              | phase | status | priority | due        | assignee | labels          | est | done_on    | notes |
|-----|------------------------------------|-------|--------|----------|------------|----------|-----------------|-----|------------|-------|
| 3.1 | Serverless GitHub-reading API      | 3     | done   | high     | 2026-06-15 | claude   | cloud, api      | 3h  | 2026-06-15 | Reads TASKS.md + commits |
| 3.2 | Login page + signed-cookie auth    | 3     | done   | high     | 2026-06-15 | claude   | cloud, auth     | 2h  | 2026-06-15 | No dependencies |
| 3.3 | Interactive Kanban + write-back     | 3     | done   | medium   | 2026-06-15 | claude   | cloud, board    | 3h  | 2026-06-15 | Commits status changes |

### Phase 4 — Mission Control upgrade
> intent: Turn the dashboard into a command center — richer editable task cards, filters, and a phone-first swipe board.

| id  | title                                      | phase | status      | priority | due        | assignee | labels             | est | done_on    | notes |
|-----|--------------------------------------------|-------|-------------|----------|------------|----------|--------------------|-----|------------|-------|
| 4.1 | Header-driven schema + task detail fields  | 4     | done        | high     | 2026-06-16 | claude   | board, parser      | 2h  | 2026-06-15 | priority/due/assignee/labels |
| 4.2 | Richer cards + tap-to-edit sheet           | 4     | in-progress | high     | 2026-06-16 | claude   | frontend, board    | 3h  |            | Edit fields from the UI |
| 4.3 | Filter / search / group-by-phase toolbar   | 4     | not-started | medium   | 2026-06-18 | claude   | frontend, board    | 2h  |            | Client-side over tasks |
| 4.4 | Command-center stat tiles                  | 4     | not-started | medium   | 2026-06-19 | claude   | frontend           | 1h  |            | In-progress/blocked/due/overdue |
| 4.5 | Phone-first swipe board + polish           | 4     | not-started | high     | 2026-06-20 | me       | frontend, mobile   | 2h  |            | Swipeable columns |
