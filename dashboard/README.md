# Project Dashboard

A read-only, local-only web dashboard that tells you the truth about a project's
state in plain English: overall completion %, what's left, what's done, today's
work, what's happening right now, and commit hygiene.

Zero dependencies — pure Python 3 standard library. No build step, no npm/pip.

---

## Start it

```bash
# From the project root (the dashboard monitors PROJECT_ROOT, default = repo root):
python3 dashboard/server.py
```

Then open **http://127.0.0.1:4747** in your browser.

To monitor a *different* project, point `PROJECT_ROOT` at it:

```bash
PROJECT_ROOT=/absolute/path/to/other-project python3 dashboard/server.py
```

## Stop it

Press **Ctrl-C** in the terminal running it. If it's in the background:

```bash
pkill -f dashboard/server.py
```

## Run it in the background

**Linux / macOS (nohup):**

```bash
nohup python3 dashboard/server.py > /tmp/project-dashboard.log 2>&1 &
# stop later with: pkill -f dashboard/server.py
```

**macOS (launchd)** or **Linux (systemd --user)** also work — point the unit at
`python3 /absolute/path/dashboard/server.py` with `PROJECT_ROOT` in the
environment. The server is a plain long-running process; any supervisor works.

---

## Configuration (environment variables)

| Variable         | Default                       | Meaning |
|------------------|-------------------------------|---------|
| `PROJECT_ROOT`   | parent dir of `dashboard/`    | Absolute path of the project to monitor. |
| `DASH_PORT`      | `4747`                        | TCP port. |
| `DASH_HOST`      | `127.0.0.1`                   | Loopback host. Non-loopback values are refused. |
| `DASH_TZ`        | `Europe/Belgrade`             | IANA time zone for display + day boundary. |
| `DASH_DAY_RESET` | `local`                       | `local` or `utc` — when "today" resets. |

Port + URL: **http://127.0.0.1:4747** by default.

---

## What it reads

All reads happen on **every request** (no caching), inside `PROJECT_ROOT`:

- **`TASKS.md`** — the task board (markdown table). Source of the completion %,
  phases, "what's left / what's done", and the "Tackle this next" pick.
- **git** (`git log`, `git status`, `git rev-parse`) — recent commits, today's
  commits, the current branch, and uncommitted changes for the hygiene panel.
- **Review docs** — `REVIEW.md`, `SECURITY.md`, `VERIFICATION.md`, `AUDIT.md`
  (if present) drive the per-phase review badge.
- **`README.md` / `package.json`** — only to pick a human-readable project name.

If a source is missing, that card shows "no data yet" — the page never breaks.

---

## What it explicitly does NOT do

- **No writes.** It never creates, edits, deletes, moves, commits, or pushes
  anything. Observation only — there are no action buttons.
- **No network**, except your browser loading the one Obsidian course thumbnail
  in the promo card. The server itself makes no outbound requests.
- **No analytics, telemetry, or tracking pixels.** The UTM parameters in the
  promo links are the only attribution mechanism.
- **No auth.** It binds to `127.0.0.1` only, so it's reachable only from your
  machine. Do not expose it on `0.0.0.0` — for remote access use SSH tunnel or
  Tailscale.
- **No mock data.** Every number comes from a real file, real git output, or
  real process state. If something can't be computed, it shows `—` or "unknown".

---

## How to redeploy after changes

The server reads files fresh on every request, so:

- **Edited `TASKS.md` or your project?** Nothing to do — just refresh the page.
- **Edited `server.py`?** Restart the process (Ctrl-C, then start again).
- **Edited `static/*.html|css|js`?** Hard-refresh the browser (no server
  restart needed — static files are read from disk per request).

### Deploy outside the project tree (optional)

If you switch git branches often, keep the dashboard source in git but run a
copy from outside the tree so branch switches don't disturb it:

```bash
cp -r dashboard ~/.project-dashboard
PROJECT_ROOT=/absolute/path/to/project python3 ~/.project-dashboard/server.py
```
