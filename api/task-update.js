// POST /api/task-update  { id, status?, priority?, due?, assignee?, labels? }
// The dashboard's write action: update a task's fields in TASKS.md and commit it
// to GitHub. Requires a write-scoped GITHUB_TOKEN. Auth-gated.

const { isAuthed } = require("../lib/auth");
const gh = require("../lib/github");
const { setTaskFields } = require("../lib/tasks");

function todayLocal(tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch (_) { return new Date().toISOString().slice(0, 10); }
}

const FIELDS = ["status", "priority", "due", "assignee", "labels"];

module.exports = async (req, res) => {
  if (!isAuthed(req)) { res.statusCode = 401; return res.json({ error: "unauthorized" }); }
  if (req.method !== "POST") { res.statusCode = 405; return res.json({ error: "method not allowed" }); }

  const ctx = gh.cfg((req.query && req.query.project) || 0);
  if (!ctx.token) { res.statusCode = 400; return res.json({ error: "This needs a GITHUB_TOKEN with write access (Contents: read & write) set in Vercel." }); }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const id = body.id;
  if (!id) { res.statusCode = 400; return res.json({ error: "Provide a task id." }); }
  if (body.status !== undefined && !["done", "in-progress", "not-started"].includes(body.status)) {
    res.statusCode = 400; return res.json({ error: "Invalid status." });
  }
  const fields = {};
  for (const f of FIELDS) if (body[f] !== undefined) fields[f] = body[f];
  if (!Object.keys(fields).length) { res.statusCode = 400; return res.json({ error: "No fields to update." }); }

  const today = todayLocal(process.env.DASH_TZ || "Europe/Belgrade");

  for (let attempt = 0; attempt < 2; attempt++) {
    let file;
    try { file = await gh.fetchFileWithSha(ctx, "TASKS.md"); }
    catch (e) { res.statusCode = 502; return res.json({ error: "Couldn't read TASKS.md: " + e.message }); }

    let updated;
    try { updated = setTaskFields(file.text, id, fields, today); }
    catch (e) { res.statusCode = 404; return res.json({ error: e.message }); }

    if (updated === file.text) { res.statusCode = 200; return res.json({ ok: true, unchanged: true }); }

    try {
      await gh.putFile(ctx, "TASKS.md", updated, file.sha, `chore(board): update ${id} via dashboard`);
      res.statusCode = 200; return res.json({ ok: true });
    } catch (e) {
      if (e.status === 409 && attempt === 0) continue;
      res.statusCode = e.status === 403 ? 403 : 502;
      return res.json({ error: "Couldn't save the change: " + e.message + (e.status === 403 ? " (is the token write-enabled?)" : "") });
    }
  }
  res.statusCode = 409; return res.json({ error: "The file kept changing — try again." });
};
