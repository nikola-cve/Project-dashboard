// GET /api/state[?project=N] — the live project state for the cloud dashboard.
// Requires a valid auth cookie. Reads everything from GitHub at request time
// (no caching). Live-only sections ("right now", uncommitted) are reported as
// unavailable in the cloud — never faked.

const { isAuthed } = require("../lib/auth");
const gh = require("../lib/github");
const { parseTasks, buildPhases } = require("../lib/tasks");

let LAST_GOOD_TASKS = {}; // per-project last-good snapshot, keyed by "owner/repo"

function localDayStartEpoch(tz, reset) {
  const now = new Date();
  if (reset === "utc") return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = dtf.formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
  const hour = p.hour === "24" ? 0 : parseInt(p.hour, 10);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  const offsetMs = asUTC - now.getTime();
  return Math.floor((Date.UTC(+p.year, +p.month - 1, +p.day) - offsetMs) / 1000);
}

module.exports = async (req, res) => {
  if (!isAuthed(req)) { res.statusCode = 401; return res.json({ error: "unauthorized" }); }

  const tz = process.env.DASH_TZ || "Europe/Belgrade";
  const dayReset = (process.env.DASH_DAY_RESET || "local").toLowerCase();
  const projIndex = (req.query && req.query.project) || 0;
  const ctx = gh.cfg(projIndex);
  const key = `${ctx.owner}/${ctx.repo}`;
  const hasToken = !!ctx.token;
  let rateLimited = false, readError = null;

  // Tasks (last-good fallback per project on a transient read/parse failure).
  let taskData = LAST_GOOD_TASKS[key] || null;
  try {
    const text = await gh.fetchFileRaw(ctx, "TASKS.md");
    if (text != null) { taskData = parseTasks(text); LAST_GOOD_TASKS[key] = taskData; }
    else taskData = null;
  } catch (e) { if (e.rateLimited) rateLimited = true; readError = e; }

  let reviews = [], commits = [], name = ctx.repo, prs = [];
  try { reviews = await gh.fetchReviewDocs(ctx); } catch (e) { if (e.rateLimited) rateLimited = true; }
  try { commits = await gh.fetchCommits(ctx, 20, hasToken ? 10 : 0); } catch (e) { if (e.rateLimited) rateLimited = true; readError = e; }
  try { name = await gh.fetchProjectName(ctx, ctx.repo); } catch (_) {}
  try { prs = await gh.fetchOpenPRs(ctx); } catch (_) {}

  let errorSoft = null;
  if (rateLimited) {
    errorSoft = "GitHub's hourly limit for un-authenticated requests was reached. " +
      "Add a GITHUB_TOKEN in Vercel (Settings → Environment Variables) for a much higher limit.";
  } else if (readError && !taskData && !commits.length) {
    errorSoft = "Couldn't read the project from GitHub: " + readError.message;
  }

  const phases = buildPhases(taskData, reviews);
  const cutoff = localDayStartEpoch(tz, dayReset);
  const todays = commits.filter(c => c.epoch != null && c.epoch >= cutoff);
  const badge = (commits.length || phases.available) ? "IDLE" : "UNKNOWN";

  res.statusCode = 200;
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    generated_iso_utc: new Date().toISOString(),
    tz, day_reset: dayReset, cloud: true,
    error_soft: errorSoft,
    projects: ctx.projectList,
    project_index: ctx.index,
    project: { name, root: key, branch: ctx.branch, git: true, writable: hasToken },
    badge,
    hero: { percent: phases.overall_percent, buckets: phases.buckets, summary: phases.summary, has_tasks: phases.available },
    phases_left: phases.left,
    phases_done: phases.done,
    board: { tasks: phases.tasks || [], next_phase_id: phases.next_phase_id || null },
    prs,
    today: {
      count: todays.length,
      items: todays.map(c => ({ message: c.message, iso_utc: c.iso_utc, short: c.short, file_count: c.file_count })),
    },
    right_now: { text: "Live activity isn't visible in the cloud version — it only exists on the machine where you edit. State here updates from GitHub." },
    commits: commits.slice(0, 10).map(c => ({ message: c.message, iso_utc: c.iso_utc, short: c.short, file_count: c.file_count })),
    last_commit_iso: commits.length ? commits[0].iso_utc : null,
    hygiene: null,
  });
};
