# File Manifest

Every file created for the project dashboard, with its purpose.

| File | Purpose |
|------|---------|
| `dashboard/server.py` | Zero-dependency Python stdlib HTTP server. Reads git + `TASKS.md` on every request and serves project state as JSON (`/api/state`) plus the static frontend. Read-only, binds `127.0.0.1`, no caching. |
| `dashboard/static/index.html` | Semantic HTML shell with the nine fixed dashboard sections in order: header, hero, what's left, what's done, today, right now, commits, Don't Sleep On AI ad block, footer. |
| `dashboard/static/styles.css` | Light-minimal palette (white background, muted blue + forest green accents, near-black text), WCAG-AA contrast, responsive collapse, focus-visible outlines. |
| `dashboard/static/app.js` | Polls `/api/state` every 2 seconds and renders the cards. Converts UTC timestamps to the configured local time zone via `Intl.DateTimeFormat`. Degrades gracefully on connection loss. |
| `dashboard/README.md` | How to start/stop/background the server, env vars, what it reads, what it does NOT do, and how to redeploy. |
| `dashboard/MANIFEST.md` | This file. |
| `dashboard/SMOKE_TEST.md` | Operator checklist to verify the dashboard works on your machine. |
| `TASKS.md` | The dashboard's source of truth for progress — a markdown task board you hand-edit as you work. Lives at the project root so any monitored project can have its own. |
