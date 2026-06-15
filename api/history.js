// GET /api/history[?project=N] — completion % over time for the burndown chart.
// Walks the commits that touched TASKS.md, parses each version, and returns a
// chronological [{date, percent}] series. Auth-gated. Heavier than /state, so
// the client polls it infrequently.

const { isAuthed } = require("../lib/auth");
const gh = require("../lib/github");
const { parseTasks, buildPhases } = require("../lib/tasks");

module.exports = async (req, res) => {
  if (!isAuthed(req)) { res.statusCode = 401; return res.json({ error: "unauthorized" }); }

  const ctx = gh.cfg((req.query && req.query.project) || 0);
  let commits = [];
  try { commits = await gh.listCommitsForPath(ctx, "TASKS.md", 30); }
  catch (e) {
    res.statusCode = 200;
    return res.json({ series: [], error_soft: e.rateLimited
      ? "GitHub rate limit reached — add a GITHUB_TOKEN for history."
      : "Couldn't read history: " + e.message });
  }

  const series = [];
  // Oldest first so the chart reads left-to-right.
  for (const c of commits.slice().reverse()) {
    try {
      const text = await gh.fetchFileRawRef(ctx, "TASKS.md", c.sha);
      if (text == null) continue;
      const ph = buildPhases(parseTasks(text), []);
      if (ph.overall_percent != null) {
        series.push({ date: c.commit.author?.date || c.commit.committer?.date, percent: ph.overall_percent });
      }
    } catch (_) { /* skip unparseable snapshots */ }
  }

  res.statusCode = 200;
  res.setHeader("Cache-Control", "no-store");
  return res.json({ series });
};
