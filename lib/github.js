// Reads (and, for the Kanban write-back, writes) project state via the GitHub
// API. Uses built-in fetch (Node 18+ on Vercel). No external dependencies.
//
// Every function takes a `ctx` (from cfg(projectIndex)) so the cloud dashboard
// can switch between multiple projects per request.

const REVIEW_DOCS = ["REVIEW.md", "SECURITY.md", "VERIFICATION.md", "AUDIT.md"];

// The configured project list. `DASH_PROJECTS` (JSON array) wins; otherwise a
// single project from GH_OWNER/GH_REPO/GH_BRANCH (with sensible defaults).
function projects() {
  try {
    const raw = process.env.DASH_PROJECTS;
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        return arr.map(p => ({
          owner: p.owner, repo: p.repo, branch: p.branch || "main",
          label: p.label || p.repo,
        }));
      }
    }
  } catch (_) { /* fall through to single-project default */ }
  return [{
    owner: process.env.GH_OWNER || "nikola-cve",
    repo: process.env.GH_REPO || "Project-dashboard",
    branch: process.env.GH_BRANCH || "main",
    label: process.env.GH_REPO || "Project-dashboard",
  }];
}

function cfg(idx = 0) {
  const list = projects();
  const i = Math.max(0, Math.min(parseInt(idx, 10) || 0, list.length - 1));
  const p = list[i];
  return {
    token: process.env.GITHUB_TOKEN || "",
    owner: p.owner, repo: p.repo, branch: p.branch, label: p.label,
    index: i,
    projectList: list.map((q, n) => ({ index: n, label: q.label })),
  };
}

function headers(token, mode = "json") {
  const accept = mode === "raw" ? "application/vnd.github.raw+json" : "application/vnd.github+json";
  const h = { "User-Agent": "project-dashboard-cloud", Accept: accept, "X-GitHub-Api-Version": "2022-11-28" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function ghError(res, path) {
  const e = new Error(`GitHub ${res.status} on ${path}`);
  e.status = res.status;
  e.rateLimited = res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
  return e;
}

async function ghJson(ctx, path) {
  const res = await fetch(`https://api.github.com${path}`, { headers: headers(ctx.token) });
  if (!res.ok) throw ghError(res, path);
  return res.json();
}

const repoPath = (ctx, rest) => `/repos/${ctx.owner}/${ctx.repo}${rest}`;

// Raw file text at the project's branch, or null if absent.
async function fetchFileRaw(ctx, path) {
  const res = await fetch(`https://api.github.com${repoPath(ctx, `/contents/${path}?ref=${ctx.branch}`)}`,
    { headers: headers(ctx.token, "raw") });
  if (res.status === 404) return null;
  if (!res.ok) throw ghError(res, path);
  return res.text();
}

// Raw file text at a specific ref (commit SHA) — used for history.
async function fetchFileRawRef(ctx, path, ref) {
  const res = await fetch(`https://api.github.com${repoPath(ctx, `/contents/${path}?ref=${ref}`)}`,
    { headers: headers(ctx.token, "raw") });
  if (res.status === 404) return null;
  if (!res.ok) throw ghError(res, path);
  return res.text();
}

// File text + blob SHA (needed to commit an update).
async function fetchFileWithSha(ctx, path) {
  const data = await ghJson(ctx, repoPath(ctx, `/contents/${path}?ref=${ctx.branch}`));
  const text = Buffer.from(data.content || "", data.encoding || "base64").toString("utf8");
  return { text, sha: data.sha };
}

// Commit an updated file (Contents API PUT). Requires a write-scoped token.
async function putFile(ctx, path, content, sha, message) {
  const res = await fetch(`https://api.github.com${repoPath(ctx, `/contents/${path}`)}`, {
    method: "PUT",
    headers: { ...headers(ctx.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message, sha, branch: ctx.branch,
      content: Buffer.from(content, "utf8").toString("base64"),
    }),
  });
  if (!res.ok) throw ghError(res, path);
  return res.json();
}

async function fetchCommits(ctx, limit = 20, withFiles = 10) {
  const list = await ghJson(ctx, repoPath(ctx, `/commits?sha=${ctx.branch}&per_page=${limit}`));
  const base = list.map(c => ({
    sha: c.sha, short: c.sha.slice(0, 7),
    message: (c.commit.message || "").split("\n")[0],
    author: c.commit.author?.name || c.author?.login || "",
    iso_utc: c.commit.author?.date || c.commit.committer?.date || null,
    epoch: c.commit.author?.date ? Date.parse(c.commit.author.date) / 1000 : null,
    file_count: null,
  }));
  const head = base.slice(0, withFiles);
  await Promise.all(head.map(async c => {
    try {
      const detail = await ghJson(ctx, repoPath(ctx, `/commits/${c.sha}`));
      c.file_count = Array.isArray(detail.files) ? detail.files.length : null;
    } catch (_) { /* leave null */ }
  }));
  return base;
}

// Commits that touched a given path (newest first).
async function listCommitsForPath(ctx, path, cap = 30) {
  return ghJson(ctx, repoPath(ctx, `/commits?sha=${ctx.branch}&path=${encodeURIComponent(path)}&per_page=${cap}`));
}

async function fetchReviewDocs(ctx) {
  let entries;
  try { entries = await ghJson(ctx, repoPath(ctx, `/contents/?ref=${ctx.branch}`)); }
  catch (_) { return []; }
  const names = new Set((entries || []).map(e => e.name));
  return REVIEW_DOCS.filter(d => names.has(d));
}

async function fetchProjectName(ctx, fallback) {
  try {
    const readme = await fetchFileRaw(ctx, "README.md");
    if (readme) for (const line of readme.split("\n")) {
      if (line.startsWith("# ")) return line.slice(2).trim();
    }
  } catch (_) { /* ignore */ }
  return fallback;
}

// Open pull requests with a rolled-up CI state (green/red/pending/none).
async function fetchOpenPRs(ctx) {
  const list = await ghJson(ctx, repoPath(ctx, `/pulls?state=open&per_page=10`));
  const out = [];
  for (const pr of list) {
    let ci = "none";
    try {
      const checks = await ghJson(ctx, repoPath(ctx, `/commits/${pr.head.sha}/check-runs`));
      const runs = checks.check_runs || [];
      if (runs.length) {
        if (runs.some(r => ["failure", "timed_out", "cancelled", "action_required"].includes(r.conclusion))) ci = "red";
        else if (runs.some(r => r.status !== "completed")) ci = "pending";
        else if (runs.every(r => ["success", "neutral", "skipped"].includes(r.conclusion))) ci = "green";
        else ci = "pending";
      } else {
        const st = await ghJson(ctx, repoPath(ctx, `/commits/${pr.head.sha}/status`));
        ci = st.state === "success" ? "green" : st.state === "failure" || st.state === "error" ? "red"
          : st.state === "pending" && st.total_count > 0 ? "pending" : "none";
      }
    } catch (_) { ci = "none"; }
    out.push({
      number: pr.number, title: pr.title, url: pr.html_url,
      author: pr.user?.login || "", draft: !!pr.draft,
      iso_utc: pr.created_at, ci,
    });
  }
  return out;
}

// List a directory's entries (files/subdirs). Empty array if it doesn't exist.
async function listDir(ctx, path) {
  let entries;
  try { entries = await ghJson(ctx, repoPath(ctx, `/contents/${path.replace(/\/$/, "")}?ref=${ctx.branch}`)); }
  catch (e) { if (e.status === 404) return []; throw e; }
  if (!Array.isArray(entries)) return [];
  return entries.map(e => ({ name: e.name, path: e.path, type: e.type, size: e.size }));
}

// Latest GitHub Actions runs, rolled to a simple state per run.
async function fetchActionsRuns(ctx, perPage = 10) {
  let data;
  try { data = await ghJson(ctx, repoPath(ctx, `/actions/runs?per_page=${perPage}`)); }
  catch (e) { if (e.status === 404) return []; throw e; }
  return (data.workflow_runs || []).map(r => ({
    name: r.name || r.display_title || "workflow",
    branch: r.head_branch, event: r.event,
    status: r.status, conclusion: r.conclusion,
    state: r.status !== "completed" ? "pending"
      : r.conclusion === "success" ? "green"
      : ["failure", "timed_out", "startup_failure"].includes(r.conclusion) ? "red"
      : r.conclusion === "cancelled" ? "cancelled" : "neutral",
    url: r.html_url, iso_utc: r.created_at, run_number: r.run_number,
  }));
}

// Recent deployments with the latest status of the newest one.
async function fetchDeployments(ctx) {
  let deps;
  try { deps = await ghJson(ctx, repoPath(ctx, `/deployments?per_page=5`)); }
  catch (e) { if (e.status === 404) return []; throw e; }
  const out = [];
  for (const d of deps || []) {
    let state = "unknown";
    try {
      const st = await ghJson(ctx, repoPath(ctx, `/deployments/${d.id}/statuses?per_page=1`));
      if (st && st[0]) state = st[0].state;
    } catch (_) {}
    out.push({ environment: d.environment, ref: d.ref, iso_utc: d.created_at, state, url: d.url });
  }
  return out;
}

// Releases (fallback to tags) — name/tag/date/url.
async function listReleasesTags(ctx) {
  try {
    const rels = await ghJson(ctx, repoPath(ctx, `/releases?per_page=5`));
    if (Array.isArray(rels) && rels.length) {
      return rels.map(r => ({ name: r.name || r.tag_name, tag: r.tag_name, iso_utc: r.published_at || r.created_at, url: r.html_url, prerelease: r.prerelease }));
    }
  } catch (_) {}
  try {
    const tags = await ghJson(ctx, repoPath(ctx, `/tags?per_page=5`));
    return (tags || []).map(t => ({ name: t.name, tag: t.name, iso_utc: null, url: null }));
  } catch (_) { return []; }
}

// Number of configured projects (for the fleet view).
function projectCount() { return projects().length; }

// Where the command center looks for memory/specs/risk/agents. Overridable via
// DASH_MEMORY (JSON). Defaults are conventional repo folders.
function memPaths() {
  const def = {
    sessions: "memory/sessions", handoffs: "memory/handoffs", decisions: "memory/decisions",
    plans: "Plans", prds: "PRDs", agents: "memory/agents.json", risk: "RISK.json",
  };
  try { const o = JSON.parse(process.env.DASH_MEMORY || "{}"); return { ...def, ...o }; }
  catch (_) { return def; }
}

module.exports = {
  cfg, projectCount, memPaths,
  fetchFileRaw, fetchFileRawRef, fetchFileWithSha, putFile,
  fetchCommits, listCommitsForPath, fetchReviewDocs, fetchProjectName, fetchOpenPRs,
  listDir, fetchActionsRuns, fetchDeployments, listReleasesTags,
};
