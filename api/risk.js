// GET /api/risk[?project=N] — risk register, blockers, and CI/test status.
// Auth-gated, read-only.

const { isAuthed } = require("../lib/auth");
const gh = require("../lib/github");
const { parseTasks, buildPhases } = require("../lib/tasks");

module.exports = async (req, res) => {
  if (!isAuthed(req)) { res.statusCode = 401; return res.json({ error: "unauthorized" }); }
  const ctx = gh.cfg((req.query && req.query.project) || 0);
  const paths = gh.memPaths();

  // Risk register (RISK.json, else risks.md as raw lines).
  let risks = [];
  try {
    const raw = await gh.fetchFileRaw(ctx, paths.risk);
    if (raw) {
      const data = JSON.parse(raw);
      risks = Array.isArray(data) ? data : (data.risks || []);
    }
  } catch (_) { /* no register or unparseable */ }

  // Blockers: tasks marked blocked, or labelled "blocked".
  let blockers = [];
  try {
    const text = await gh.fetchFileRaw(ctx, "TASKS.md");
    if (text) {
      const ph = buildPhases(parseTasks(text), []);
      blockers = (ph.tasks || []).filter(t => t.status === "blocked" || (t.labels || []).includes("blocked"))
        .map(t => ({ id: t.id, title: t.title, phase: t.phase_id }));
    }
  } catch (_) {}

  // CI / test status from GitHub Actions.
  let ci = [];
  try { ci = await gh.fetchActionsRuns(ctx, 8); } catch (_) {}

  // Code review docs present in the repo.
  let reviews = [];
  try { reviews = await gh.fetchReviewDocs(ctx); } catch (_) {}

  res.statusCode = 200;
  res.setHeader("Cache-Control", "no-store");
  return res.json({ risks, blockers, ci, reviews });
};
