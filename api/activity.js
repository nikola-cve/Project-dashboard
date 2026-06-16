// GET /api/activity[?project=N] — a unified, reverse-chronological feed of
// commits, task moves, open PRs, and deployments. Auth-gated, read-only.

const { isAuthed } = require("../lib/auth");
const gh = require("../lib/github");

module.exports = async (req, res) => {
  if (!isAuthed(req)) { res.statusCode = 401; return res.json({ error: "unauthorized" }); }
  const ctx = gh.cfg((req.query && req.query.project) || 0);

  const items = [];
  let softError = null;

  try {
    const commits = await gh.fetchCommits(ctx, 25, 0);
    for (const c of commits) {
      const isMove = /^chore\(board\)/.test(c.message);
      items.push({
        type: isMove ? "move" : "commit",
        text: c.message, iso_utc: c.iso_utc, who: c.author,
        url: `https://github.com/${ctx.owner}/${ctx.repo}/commit/${c.sha}`,
      });
    }
  } catch (e) { if (e.rateLimited) softError = "GitHub rate limit — add a token."; }

  try {
    const prs = await gh.fetchOpenPRs(ctx);
    for (const p of prs) items.push({ type: "pr", text: `PR #${p.number}: ${p.title}`, iso_utc: p.iso_utc, who: p.author, url: p.url, ci: p.ci });
  } catch (_) {}

  try {
    const deps = await gh.fetchDeployments(ctx);
    for (const d of deps) items.push({ type: "deploy", text: `Deploy to ${d.environment} (${d.state})`, iso_utc: d.iso_utc, who: "", url: null });
  } catch (_) {}

  items.sort((a, b) => (b.iso_utc || "").localeCompare(a.iso_utc || ""));

  res.statusCode = 200;
  res.setHeader("Cache-Control", "no-store");
  return res.json({ items: items.slice(0, 40), error_soft: softError });
};
