// POST /api/task-move  { id, status, project? }
// The dashboard's only write action: change a task's status in TASKS.md and
// commit it to GitHub. Requires a write-scoped GITHUB_TOKEN. Auth-gated.

const { isAuthed } = require("../lib/auth");
const gh = require("../lib/github");
const { setTaskStatus } = require("../lib/tasks");

function todayLocal(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date()); // en-CA => YYYY-MM-DD
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

module.exports = async (req, res) => {
  if (!isAuthed(req)) { res.statusCode = 401; return res.json({ error: "unauthorized" }); }
  if (req.method !== "POST") { res.statusCode = 405; return res.json({ error: "method not allowed" }); }

  const ctx = gh.cfg((req.query && req.query.project) || 0);
  if (!ctx.token) {
    res.statusCode = 400;
    return res.json({ error: "This needs a GITHUB_TOKEN with write access (Contents: read & write) set in Vercel." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { id, status } = body;
  if (!id || !["done", "in-progress", "not-started"].includes(status)) {
    res.statusCode = 400;
    return res.json({ error: "Provide a task id and a valid status." });
  }

  const tz = process.env.DASH_TZ || "Europe/Belgrade";
  const today = todayLocal(tz);

  // Read → edit → commit, retrying once if the file changed underneath us.
  for (let attempt = 0; attempt < 2; attempt++) {
    let file;
    try { file = await gh.fetchFileWithSha(ctx, "TASKS.md"); }
    catch (e) { res.statusCode = 502; return res.json({ error: "Couldn't read TASKS.md: " + e.message }); }

    let updated;
    try { updated = setTaskStatus(file.text, id, status, today); }
    catch (e) { res.statusCode = 404; return res.json({ error: e.message }); }

    if (updated === file.text) { res.statusCode = 200; return res.json({ ok: true, unchanged: true }); }

    try {
      await gh.putFile(ctx, "TASKS.md", updated, file.sha,
        `chore(board): move ${id} to ${status} via dashboard`);
      res.statusCode = 200;
      return res.json({ ok: true });
    } catch (e) {
      if (e.status === 409 && attempt === 0) continue; // stale SHA, refetch + retry
      res.statusCode = e.status === 403 ? 403 : 502;
      return res.json({ error: "Couldn't save the change: " + e.message +
        (e.status === 403 ? " (is the token write-enabled?)" : "") });
    }
  }
  res.statusCode = 409;
  return res.json({ error: "The file kept changing — try again." });
};
