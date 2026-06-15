# Cloud dashboard (Vercel) — setup

This is the **cloud variant** of the project dashboard. It runs on Vercel, reads
your project state from **GitHub** at request time, and is protected by a
**login page**. Use it to check your project from your phone — no computer or
server of your own required.

The local Python dashboard in `dashboard/` is unchanged and still the fuller
view (it also shows live "right now" activity and uncommitted changes, which a
cloud app cannot see). This cloud version shows everything that lives on GitHub:
completion %, phases, what's done, today's work, and recent commits.

## What's in this deployment

| Path | Purpose |
|------|---------|
| `api/login.js` | Checks your password, sets a signed login cookie. |
| `api/logout.js` | Clears the login cookie. |
| `api/state.js` | Auth-gated. Reads GitHub and returns the project state JSON. |
| `lib/tasks.js` | Parses `TASKS.md` and computes the completion view (JS port of the local server). |
| `lib/github.js` | Reads `TASKS.md`, commits, and review docs from the GitHub API. |
| `lib/auth.js` | Signed-cookie login (Node crypto, no dependencies). |
| `index.html`, `login.html`, `styles.css`, `app.js` | The frontend (login page + dashboard). |
| `vercel.json`, `package.json` | Vercel config. No npm dependencies. |
| `.vercelignore` | Keeps `dashboard/`, `TASKS.md`, and all markdown OUT of the public deploy. |

## Required environment variables (set these in Vercel)

| Variable | Required | What to put |
|----------|----------|-------------|
| `GITHUB_TOKEN` | ✅ | A GitHub **fine-grained personal access token** with **read-only** access to `nikola-cve/Project-dashboard` (Repository permissions → **Contents: Read-only**). Needed because the repo is private. |
| `DASH_PASSWORD` | ✅ | The password you'll type on the login page. Choose anything. |
| `DASH_SECRET` | ✅ | A random string used to sign the login cookie. Use the value Claude gave you in chat (or any long random string). |
| `GH_OWNER` | optional | Defaults to `nikola-cve`. |
| `GH_REPO` | optional | Defaults to `Project-dashboard`. |
| `GH_BRANCH` | optional | Defaults to `main`. Set to your working branch if you want to track that instead. |
| `DASH_TZ` | optional | Defaults to `Europe/Belgrade`. |
| `DASH_DAY_RESET` | optional | `local` (default) or `utc`. |

## Set it up from your phone

1. **Create the GitHub token** (one time):
   - github.com → your avatar → **Settings** → **Developer settings** →
     **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   - Resource owner: your account. Repository access: **Only select repositories**
     → pick **Project-dashboard**.
   - Permissions → Repository permissions → **Contents: Read-only**.
   - Generate, then **copy the token** (`github_pat_...`).
2. **Add the env vars in Vercel:**
   - Open your project on vercel.com → **Settings** → **Environment Variables**.
   - Add `GITHUB_TOKEN`, `DASH_PASSWORD`, `DASH_SECRET` (paste the values).
   - Apply to **Production** (and Preview if you like).
3. **Redeploy** so the new env vars take effect:
   - Vercel → **Deployments** → latest → **⋯** → **Redeploy**.
4. **Open the site** Vercel gives you (e.g. `https://your-app.vercel.app`),
   type your password, and you're in. Tap **Remember me** so you stay logged in.

## Security notes

- The login cookie is HttpOnly + Secure + signed; only someone with your
  password can read the dashboard.
- The GitHub token is read-only and scoped to this one repo. It lives only as a
  Vercel secret — it is **never** committed to the repo.
- No analytics or telemetry. The only outbound request the page makes (besides
  to its own API) is loading the one course thumbnail image.
- `.vercelignore` ensures `TASKS.md` and the markdown docs are not served as
  public static files — project data is only reachable through the logged-in API.

## How updates appear

The cloud dashboard reflects what's on GitHub. **Push your work**, and within a
refresh the new commits, today's-work count, and `TASKS.md` percentage update.
There's no build-on-push needed — `api/state.js` reads GitHub live on each poll.
