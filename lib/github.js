// Reads project state from the GitHub API at runtime for the cloud dashboard.
// Uses the built-in fetch (Node 18+ on Vercel). No external dependencies.

const REVIEW_DOCS = ["REVIEW.md", "SECURITY.md", "VERIFICATION.md", "AUDIT.md"];

function cfg() {
  return {
    token: process.env.GITHUB_TOKEN || "",
    owner: process.env.GH_OWNER || "nikola-cve",
    repo: process.env.GH_REPO || "Project-dashboard",
    branch: process.env.GH_BRANCH || "main",
  };
}

function headers(token, raw = false) {
  const h = {
    "User-Agent": "project-dashboard-cloud",
    Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function ghError(res, path) {
  const e = new Error(`GitHub ${res.status} on ${path}`);
  e.status = res.status;
  // 403 with no remaining quota = rate limit (common when no token is set).
  e.rateLimited = res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
  return e;
}

async function ghJson(path) {
  const { token } = cfg();
  const res = await fetch(`https://api.github.com${path}`, { headers: headers(token) });
  if (!res.ok) throw ghError(res, path);
  return res.json();
}

// Fetch a file's raw text, or null if it doesn't exist.
async function fetchFileRaw(path) {
  const { token, owner, repo, branch } = cfg();
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, { headers: headers(token, true) });
  if (res.status === 404) return null;
  if (!res.ok) throw ghError(res, path);
  return res.text();
}

// List recent commits with per-commit file counts (capped to keep API calls low).
async function fetchCommits(limit = 20, withFiles = 10) {
  const { owner, repo, branch } = cfg();
  const list = await ghJson(`/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${limit}`);
  const base = list.map(c => ({
    sha: c.sha,
    short: c.sha.slice(0, 7),
    message: (c.commit.message || "").split("\n")[0],
    author: c.commit.author?.name || c.author?.login || "",
    iso_utc: c.commit.author?.date || c.commit.committer?.date || null,
    epoch: c.commit.author?.date ? Date.parse(c.commit.author.date) / 1000 : null,
    file_count: null,
  }));
  // Fill file counts for the most recent few in parallel.
  const head = base.slice(0, withFiles);
  await Promise.all(head.map(async c => {
    try {
      const detail = await ghJson(`/repos/${owner}/${repo}/commits/${c.sha}`);
      c.file_count = Array.isArray(detail.files) ? detail.files.length : null;
    } catch { /* leave null */ }
  }));
  return base;
}

// Which review docs exist in the repo root.
async function fetchReviewDocs() {
  const { owner, repo, branch } = cfg();
  let entries;
  try {
    entries = await ghJson(`/repos/${owner}/${repo}/contents/?ref=${branch}`);
  } catch {
    return [];
  }
  const names = new Set((entries || []).map(e => e.name));
  return REVIEW_DOCS.filter(d => names.has(d));
}

async function fetchProjectName(fallback) {
  try {
    const readme = await fetchFileRaw("README.md");
    if (readme) {
      for (const line of readme.split("\n")) {
        if (line.startsWith("# ")) return line.slice(2).trim();
      }
    }
  } catch { /* ignore */ }
  return fallback;
}

module.exports = { cfg, fetchFileRaw, fetchCommits, fetchReviewDocs, fetchProjectName };
