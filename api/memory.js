// GET /api/memory?kind=sessions|handoffs|decisions|plans|prds[&path=...][&project=N]
// Lists a memory folder's markdown files (newest first), or renders one file.
// Auth-gated, read-only.

const { isAuthed } = require("../lib/auth");
const gh = require("../lib/github");
const { mdToHtml, firstLine } = require("../lib/md");

module.exports = async (req, res) => {
  if (!isAuthed(req)) { res.statusCode = 401; return res.json({ error: "unauthorized" }); }
  const ctx = gh.cfg((req.query && req.query.project) || 0);
  const paths = gh.memPaths();
  const kind = (req.query && req.query.kind) || "sessions";
  const folder = paths[kind];
  if (!folder) { res.statusCode = 400; return res.json({ error: "unknown kind" }); }

  res.setHeader("Cache-Control", "no-store");

  // Render a single file.
  if (req.query && req.query.path) {
    const p = String(req.query.path);
    if (!p.startsWith(folder.replace(/\/$/, ""))) { res.statusCode = 400; return res.json({ error: "path outside folder" }); }
    try {
      const text = await gh.fetchFileRaw(ctx, p);
      if (text == null) { res.statusCode = 404; return res.json({ error: "not found" }); }
      res.statusCode = 200;
      return res.json({ path: p, html: mdToHtml(text), url: `https://github.com/${ctx.owner}/${ctx.repo}/blob/${ctx.branch}/${p}` });
    } catch (e) {
      res.statusCode = e.rateLimited ? 200 : 502;
      return res.json({ error_soft: e.rateLimited ? "GitHub rate limit — add a token." : null, error: e.rateLimited ? null : e.message });
    }
  }

  // List the folder (markdown files, newest-by-name first).
  let entries = [];
  try { entries = await gh.listDir(ctx, folder); }
  catch (e) {
    res.statusCode = 200;
    return res.json({ kind, folder, items: [], error_soft: e.rateLimited ? "GitHub rate limit — add a token." : "Couldn't read " + folder });
  }
  const files = entries.filter(e => e.type === "file" && /\.(md|markdown)$/i.test(e.name))
    .sort((a, b) => b.name.localeCompare(a.name));

  // Pull a one-line preview for the newest few (kept small to limit API calls).
  const withPreview = await Promise.all(files.slice(0, 12).map(async f => {
    let preview = "";
    try { const t = await gh.fetchFileRaw(ctx, f.path); preview = firstLine(t); } catch (_) {}
    return { name: f.name, path: f.path, preview };
  }));

  res.statusCode = 200;
  return res.json({ kind, folder, count: files.length, items: withPreview });
};
