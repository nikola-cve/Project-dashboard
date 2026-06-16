// GET /api/overview[?project=N] — the condensed mission-control summary for the
// Overview tab: KPIs, alerts, last session, next handoff, latest deploy, agents
// health, board snapshot, and recent activity. Auth-gated, read-only.

const { isAuthed } = require("../lib/auth");
const gh = require("../lib/github");
const { parseTasks, buildPhases } = require("../lib/tasks");
const { mdToHtml } = require("../lib/md");

function todayStr(tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch (_) { return new Date().toISOString().slice(0, 10); }
}

module.exports = async (req, res) => {
  if (!isAuthed(req)) { res.statusCode = 401; return res.json({ error: "unauthorized" }); }
  const tz = process.env.DASH_TZ || "Europe/Belgrade";
  const ctx = gh.cfg((req.query && req.query.project) || 0);
  const paths = gh.memPaths();
  const today = todayStr(tz);
  const soon = new Date(today); soon.setDate(soon.getDate() + 7); const soonStr = soon.toISOString().slice(0, 10);

  let phases = null, tasks = [], name = ctx.repo, softError = null;
  try {
    const text = await gh.fetchFileRaw(ctx, "TASKS.md");
    if (text) { phases = buildPhases(parseTasks(text), []); tasks = phases.tasks || []; }
  } catch (e) { if (e.rateLimited) softError = "GitHub rate limit — add a token."; }
  try { name = await gh.fetchProjectName(ctx, ctx.repo); } catch (_) {}

  let commits = [];
  try { commits = await gh.fetchCommits(ctx, 8, 0); } catch (e) { if (e.rateLimited) softError = "GitHub rate limit — add a token."; }
  let prs = [];
  try { prs = await gh.fetchOpenPRs(ctx); } catch (_) {}
  let runs = [];
  try { runs = await gh.fetchActionsRuns(ctx, 3); } catch (_) {}

  // KPIs
  const k = {
    in_progress: tasks.filter(t => t.column === "in-progress").length,
    blocked: tasks.filter(t => t.status === "blocked").length,
    due_soon: tasks.filter(t => t.due && t.column !== "done" && t.due >= today && t.due <= soonStr).length,
    overdue: tasks.filter(t => t.due && t.column !== "done" && t.due < today).length,
    open_prs: prs.length,
    done_percent: phases ? phases.overall_percent : null,
  };
  const ciState = runs.length ? runs[0].state : (prs.find(p => p.ci === "red") ? "red" : prs.find(p => p.ci === "green") ? "green" : "none");

  // Alerts
  const alerts = [];
  if (k.overdue) alerts.push({ level: "high", text: `${k.overdue} task${k.overdue > 1 ? "s" : ""} overdue` });
  if (k.blocked) alerts.push({ level: "high", text: `${k.blocked} task${k.blocked > 1 ? "s" : ""} blocked` });
  if (ciState === "red") alerts.push({ level: "high", text: "CI is failing" });
  if (k.due_soon) alerts.push({ level: "med", text: `${k.due_soon} due within 7 days` });
  if (commits.length) {
    const gapH = (Date.now() - new Date(commits[0].iso_utc).getTime()) / 3600000;
    if (gapH >= 8) alerts.push({ level: "med", text: `No commit in ${Math.round(gapH)}h` });
  }

  // Last session + next handoff
  let lastSession = null, handoff = null;
  try {
    const dir = await gh.listDir(ctx, paths.sessions);
    const md = dir.filter(e => e.type === "file" && /\.md$/i.test(e.name)).sort((a, b) => b.name.localeCompare(a.name))[0];
    if (md) { const t = await gh.fetchFileRaw(ctx, md.path); lastSession = { name: md.name, path: md.path, html: mdToHtml(t) }; }
  } catch (_) {}
  try { const h = await gh.fetchFileRaw(ctx, `${paths.handoffs}/next.md`); if (h) handoff = { html: mdToHtml(h) }; } catch (_) {}

  // Latest deploy + agents
  let deploy = null, agents = [];
  try { const d = await gh.fetchDeployments(ctx); deploy = d[0] || null; } catch (_) {}
  try {
    const raw = await gh.fetchFileRaw(ctx, paths.agents);
    if (raw) { const data = JSON.parse(raw); const list = Array.isArray(data) ? data : (data.agents || []); const now = Date.now();
      agents = list.map(a => ({ name: a.name, state: a.state || ((a.last_wakeup && now - Date.parse(a.last_wakeup) < 86400000) ? "healthy" : "stale"), current_task: a.current_task })); }
  } catch (_) {}
  if (agents.some(a => a.state === "stale")) alerts.push({ level: "med", text: "An agent looks stale" });

  res.statusCode = 200;
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    generated_iso_utc: new Date().toISOString(), tz, error_soft: softError,
    project: { name, root: `${ctx.owner}/${ctx.repo}`, branch: ctx.branch, index: ctx.index },
    projects: ctx.projectList,
    kpis: k, ci_state: ciState,
    board_snapshot: phases ? phases.buckets : { done: 0, in_progress: 0, not_started: 0, total: 0 },
    summary: phases ? phases.summary : "No task file yet.",
    alerts,
    last_session: lastSession,
    handoff,
    deploy,
    agents,
    recent: commits.slice(0, 5).map(c => ({ text: c.message, iso_utc: c.iso_utc, type: /^chore\(board\)/.test(c.message) ? "move" : "commit" })),
  });
};
