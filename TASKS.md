# Project Tasks

This is the dashboard's source of truth for "what's done" vs "what's not done."
Hand-edit it as you work. The dashboard re-reads this file on every refresh.

## How to use it

- Keep the table below. One row per task.
- **status** must be one of: `done`, `in-progress`, `not-started`
  (aliases also accepted: `todo`, `wip`, `complete`, `blocked`).
- **phase** groups tasks into the phases shown on the dashboard. Use
  `id`-style numbering inside the phase if you like (e.g. `1.1`, `1.2`).
- **est** is an optional time estimate (e.g. `2h`, `1d`). Leave blank for `—`.
- **done_on** is an optional completion date (`YYYY-MM-DD`) for finished tasks.
- Lines starting with `#` outside the table are ignored.

## Phases

Each phase can have a one-line intent after `### Phase N — Name` using a
`> intent:` line. The dashboard shows that as "what it's meant to build."

### Phase 1 — Dashboard server
> intent: A zero-dependency Python server that reads the project's git history and task files and serves the live state as JSON.

| id  | title                                            | phase | status      | est | done_on    | notes |
|-----|--------------------------------------------------|-------|-------------|-----|------------|-------|
| 1.1 | Stdlib HTTP server bound to 127.0.0.1 | 1 | in-progress | 2h |  | Read-only, no caching, serves /api/state + static files |
| 1.2 | Git helpers (log, status, branches, file counts) | 1     | done        | 2h  | 2026-06-15 | All wrapped to degrade gracefully when git is absent |
| 1.3 | TASKS.md parser with last-good-snapshot fallback | 1     | done        | 2h  | 2026-06-15 | Tolerates mid-write reads |
| 1.4 | Phase aggregation + overall percentage           | 1     | done        | 1h  | 2026-06-15 | Computes done / in-progress / not-started buckets |
| 1.5 | Commit-hygiene + "tackle this next" heuristics   | 1     | done        | 2h  | 2026-06-15 | Suggestions derived from the real diff |

### Phase 2 — Frontend cards
> intent: A plain-English, light-minimal web UI that renders the nine fixed dashboard sections top to bottom and polls every 2 seconds.

| id  | title                                          | phase | status      | est | done_on    | notes |
|-----|------------------------------------------------|-------|-------------|-----|------------|-------|
| 2.1 | Header, hero big-% and remaining-work bar      | 2     | done        | 2h  | 2026-06-15 | State badge always visible |
| 2.2 | What's-left / what's-done phase lists          | 2     | done        | 2h  | 2026-06-15 | Intent vs reality, review badge, one "tackle next" |
| 2.3 | Today / Right-now / Commits + hygiene cards    | 2     | done        | 2h  | 2026-06-15 | Local-zone time via Intl |
| 2.4 | Don't Sleep On AI ad block + footer            | 2     | done        | 1h  | 2026-06-15 | Three UTM links, exact reference markup |
| 2.5 | Accessibility + graceful "no data yet" states  | 2     | done        | 1h  | 2026-06-15 | Semantic HTML, AA contrast, keyboard nav |

### Phase 3 — Docs & smoke test
> intent: Everything the operator needs to run, stop, redeploy, and verify the dashboard on their own machine.

| id  | title                              | phase | status      | est | done_on | notes |
|-----|------------------------------------|-------|-------------|-----|---------|-------|
| 3.1 | README (start/stop/background/env) | 3     | done        | 1h  | 2026-06-15 | Platform-appropriate background instructions |
| 3.2 | File manifest                      | 3     | done        | 30m | 2026-06-15 | One line per created file |
| 3.3 | Smoke-test checklist               | 3     | done        | 30m | 2026-06-15 | Operator verification steps |
