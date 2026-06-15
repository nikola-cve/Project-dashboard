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
| `DASH_PASSWORD` | ✅ | The password you'll type on the login page. Choose anything. |
| `DASH_SECRET` | ✅ | A random string used to sign the login cookie. Use the value Claude gave you in chat (or any long random string). |
| `GITHUB_TOKEN` | strongly recommended | A GitHub personal access token. The repo is **public**, so a token isn't strictly required to read it — but GitHub limits **un-authenticated** requests to **60/hour**, which the dashboard burns through quickly. A token raises that to **5,000/hour**. For a public repo the token needs **no special permissions** (a classic token with no scopes ticked, or a fine-grained token with public read, is enough). |
| `GH_OWNER` | optional | Defaults to `nikola-cve`. |
| `GH_REPO` | optional | Defaults to `Project-dashboard`. |
| `GH_BRANCH` | optional | Defaults to `main`. Set to your working branch if you want to track that instead. |
| `DASH_TZ` | optional | Defaults to `Europe/Belgrade`. |
| `DASH_DAY_RESET` | optional | `local` (default) or `utc`. |

> Without a token the dashboard still works, but after ~60 requests in an hour
> it will show a "rate limit reached" notice until the hour resets. Add the
> token to avoid that.

## Set it up from your phone

1. **Create a GitHub token** (recommended, one time — for higher rate limits):
   - github.com → your avatar → **Settings** → **Developer settings** →
     **Personal access tokens** → **Tokens (classic)** → **Generate new token**.
   - Since the repo is public, you can leave **all scopes unticked** — that's
     enough to read public data at 5,000 requests/hour.
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
- The GitHub token (if used) only reads public data and carries no scopes. It
  lives only as a Vercel secret — it is **never** committed to the repo.
- No analytics or telemetry. The only outbound request the page makes (besides
  to its own API) is loading the one course thumbnail image.
- `.vercelignore` ensures `TASKS.md` and the markdown docs are not served as
  public static files — project data is only reachable through the logged-in API.

## How updates appear

The cloud dashboard reflects what's on GitHub. **Push your work**, and within a
refresh the new commits, today's-work count, and `TASKS.md` percentage update.
There's no build-on-push needed — `api/state.js` reads GitHub live on each poll.
