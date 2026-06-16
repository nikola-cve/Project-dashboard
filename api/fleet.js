// GET /api/fleet — a one-line summary of every configured project.
// Auth-gated, read-only.

const { isAuthed } = require("../lib/auth");
const gh = require("../lib/github");
const { parseTasks, buildPhases } = require("../lib/tasks");

module.exports = async (req, res) => {
  if (!isAuthed(req)) { res.statusCode = 401; return res.json({ error: "unauthorized" }); }

  const count = gh.projectCount();
  const out = [];
  for (let i = 0; i < count; i++) {
    const ctx = gh.cfg(i);
    const row = { index: i, label: ctx.label, repo: `${ctx.owner}/${ctx.repo}`, branch: ctx.branch,
      percent: null, blockers: 0, open_prs: 0, last_iso: null, error: null };
    try {
      const text = await gh.fetchFileRaw(ctx, "TASKS.md");
      if (text) {
        const ph = buildPhases(parseTasks(text), []);
        row.percent = ph.overall_percent;
        row.blockers = (ph.tasks || []).filter(t => t.status === "blocked" || (t.labels || []).includes("blocked")).length;
      }
    } catch (e) { row.error = e.rateLimited ? "rate limit" : "read error"; }
    try { const commits = await gh.fetchCommits(ctx, 1, 0); row.last_iso = commits[0] ? commits[0].iso_utc : null; } catch (_) {}
    try { const prs = await gh.fetchOpenPRs(ctx); row.open_prs = prs.length; } catch (_) {}
    out.push(row);
  }

  res.statusCode = 200;
  res.setHeader("Cache-Control", "no-store");
  return res.json({ projects: out });
};
