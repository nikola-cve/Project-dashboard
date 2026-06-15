# Cloud dashboard (Vercel) — setup

This is the **cloud variant** of the project dashboard. It runs on Vercel, reads
your project state from **GitHub** at request time, and is protected by a
**login page**. Use it to check your project from your phone — no computer or
server of your own required.

This cloud version shows everything that lives on GitHub: completion %, phases,
a **mission-control board** — task cards with priority, due date, assignee, and
labels that you **edit right from the dashboard** (tap a card, or drag to change
status; changes commit to `TASKS.md`), with **stat tiles**, **search/filter**,
and **group-by-phase** — plus a **burndown** chart, **open pull requests with CI
status**, today's work, recent commits, and an optional **multi-project
switcher**. On a phone the board's columns **swipe** left/right. The local Python dashboard in `dashboard/`
additionally shows live "right now" activity and uncommitted changes, which a
cloud app cannot see.

## What's in this deployment

| Path | Purpose |
|------|---------|
| `api/login.js` | Checks your password, sets a signed login cookie. |
| `api/logout.js` | Clears the login cookie. |
| `api/state.js` | Auth-gated. Reads GitHub and returns the project state JSON (incl. board tasks + open PRs). |
| `api/task-update.js` | Auth-gated. The board's write action: commits a task's field changes (status/priority/due/assignee/labels) to `TASKS.md`. |
| `api/history.js` | Auth-gated. Returns the completion-%-over-time series for the burndown chart. |
| `lib/tasks.js` | Parses `TASKS.md` and computes the completion view (JS port of the local server). |
| `lib/github.js` | Reads `TASKS.md`, commits, and review docs from the GitHub API. |
| `lib/auth.js` | Signed-cookie login (Node crypto, no dependencies). |
| `index.html`, `login.html`, `styles.css`, `app.js` | The frontend (login page + dashboard). |
| `vercel.json`, `package.json` | Vercel config. No npm dependencies. |
| `.vercelignore` | Keeps `dashboard/`, `TASKS.md`, and all markdown OUT of the public deploy. |

## Required environment variables (set these in Vercel)

| Variable | Required | What to put |
|----------|----------|-------------|
| `DASH_PASSWORD` | ✅ | The password you'll type on the login page. Choose anything. |
| `DASH_SECRET` | ✅ | A random string used to sign the login cookie. Use the value Claude gave you in chat (or any long random string). |
| `GITHUB_TOKEN` | required for the board | A GitHub personal access token. Two things depend on it: (1) **rate limits** — un-authenticated reads are capped at 60/hour, a token raises that to 5,000/hour; (2) the **interactive Kanban** — dragging a card commits a change to `TASKS.md`, which needs **write** access. Use a classic token with the **`public_repo`** scope (or a fine-grained token with **Contents: read & write** on this repo). Without a write-scoped token the board is read-only and everything else still works. |
| `DASH_PROJECTS` | optional | JSON array to monitor several repos with a project switcher, e.g. `[{"owner":"nikola-cve","repo":"Project-dashboard","branch":"main","label":"Dashboard"},{"owner":"nikola-cve","repo":"other","branch":"main","label":"Other"}]`. Unset = the single repo below. |
| `GH_OWNER` | optional | Defaults to `nikola-cve`. |
| `GH_REPO` | optional | Defaults to `Project-dashboard`. |
| `GH_BRANCH` | optional | Defaults to `main`. Set to your working branch if you want to track that instead. |
| `DASH_TZ` | optional | Defaults to `Europe/Belgrade`. |
| `DASH_DAY_RESET` | optional | `local` (default) or `utc`. |

> Without a token the dashboard still reads the repo, but after ~60 requests in
> an hour it shows a "rate limit reached" notice, and the board can't save moves.
> Add a write-scoped token to get both higher limits and the drag-drop board.

## Set it up from your phone

1. **Create a GitHub token** (one time — for higher rate limits AND the board):
   - github.com → your avatar → **Settings** → **Developer settings** →
     **Personal access tokens** → **Tokens (classic)** → **Generate new token**.
   - Tick the **`public_repo`** scope (this lets the drag-drop board commit task
     changes to `TASKS.md`). If you'd rather keep it read-only, leave all scopes
     unticked — the board will then be view-only.
   - Generate, then **copy the token** (`ghp_...`).
2. **Add the env vars in Vercel:**
   - Open your project on vercel.com → **Settings** → **Environment Variables**.
   - Add `DASH_PASSWORD`, `DASH_SECRET`, and `GITHUB_TOKEN` (paste the values).
   - Apply to **Production** (and Preview if you like).
3. **Redeploy** so the new env vars take effect:
   - Vercel → **Deployments** → latest → **⋯** → **Redeploy**.
4. **Open the site** Vercel gives you (e.g. `https://your-app.vercel.app`),
   type your password, and you're in. Tap **Remember me** so you stay logged in.

## Security notes

- The login cookie is HttpOnly + Secure + signed; only someone with your
  password can read the dashboard.
- The GitHub token lives only as a Vercel secret — it is **never** committed to
  the repo. The only write the dashboard ever makes is a task-status change
  committed to `TASKS.md` (commit message `chore(board): move …`); it never
  deletes or touches anything else.
- No analytics or telemetry. The only outbound request the page makes (besides
  to its own API) is loading the one course thumbnail image.
- `.vercelignore` ensures `TASKS.md` and the markdown docs are not served as
  public static files — project data is only reachable through the logged-in API.

## How updates appear

The cloud dashboard reflects what's on GitHub. **Push your work**, and within a
refresh the new commits, today's-work count, and `TASKS.md` percentage update.
There's no build-on-push needed — `api/state.js` reads GitHub live on each poll.
