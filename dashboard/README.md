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

## Remote access from your phone (Tailscale)

The dashboard stays bound to `127.0.0.1` — it is never exposed to the public
internet. To reach it from your phone or another device, put both devices on
your private Tailscale network and proxy the local port over HTTPS within that
network. No code changes; nothing leaves your machine to the public internet.

1. Install Tailscale on the computer running the dashboard and on your phone
   (https://tailscale.com/download), and sign in with the **same account** on
   both — now they share a private network.
2. Start the dashboard normally: `python3 dashboard/server.py`
   (it stays on `127.0.0.1:4747`).
3. Expose it to your own tailnet only:

   ```bash
   tailscale serve --bg 4747
   ```

4. Get the private HTTPS URL and open it on your phone (the phone must be
   connected to Tailscale):

   ```bash
   tailscale serve status
   # e.g. https://your-computer.your-tailnet.ts.net/
   ```

> ⚠️ Do **not** use `tailscale funnel` — that publishes the dashboard to the
> public internet. Stay on `tailscale serve`, which keeps it private to your
> devices. Because only your own tailnet can reach it, no login is needed.

**Alternative — SSH tunnel** (handier from another laptop than from a phone):

```bash
ssh -L 4747:127.0.0.1:4747 user@your-computer
# then open http://127.0.0.1:4747 locally
```

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

## The one write action (the Kanban board)

The dashboard is read-only with a single exception: the **Board** lets you
manage tasks. Drag a card between **Not started / In progress / Done**, or tap a
card to edit its status, priority, due date, assignee, and labels. Saving writes
those cells into that task's row in `TASKS.md` (and, for Done, today's date) —
written atomically (temp file + rename), one row at a time, nothing else. It
never commits, pushes, deletes, or touches any other file. To keep it fully
read-only, don't edit cards (or remove the `do_POST` handler in `server.py`).

## What it explicitly does NOT do

- **No writes other than the task-status change above.** It never creates,
  deletes, moves, commits, or pushes anything.
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
