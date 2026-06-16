// GET /api/ops[?project=N] — deployments, releases/tags, and agent/loop status.
// Auth-gated, read-only.

const { isAuthed } = require("../lib/auth");
const gh = require("../lib/github");

module.exports = async (req, res) => {
  if (!isAuthed(req)) { res.statusCode = 401; return res.json({ error: "unauthorized" }); }
  const ctx = gh.cfg((req.query && req.query.project) || 0);
  const paths = gh.memPaths();

  let deployments = [], releases = [], agents = [];
  try { deployments = await gh.fetchDeployments(ctx); } catch (_) {}
  try { releases = await gh.listReleasesTags(ctx); } catch (_) {}
  try {
    const raw = await gh.fetchFileRaw(ctx, paths.agents);
    if (raw) { const data = JSON.parse(raw); agents = Array.isArray(data) ? data : (data.agents || []); }
  } catch (_) {}

  // Flag stale agents: no wakeup in 24h.
  const now = Date.now();
  agents = agents.map(a => {
    const last = a.last_wakeup ? Date.parse(a.last_wakeup) : null;
    const stale = last == null || (now - last) > 24 * 3600 * 1000;
    return { ...a, state: a.state || (stale ? "stale" : "healthy"), stale };
  });

  res.statusCode = 200;
  res.setHeader("Cache-Control", "no-store");
  return res.json({ deployments, releases, agents });
};
