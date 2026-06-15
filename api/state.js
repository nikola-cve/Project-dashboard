// GET /api/state — the live project state for the cloud dashboard.
// Requires a valid auth cookie. Reads everything from GitHub at request time
// (no caching). Sections that only exist on a local working copy ("right now",
// uncommitted changes) are reported as unavailable in the cloud — never faked.

const { isAuthed } = require("../lib/auth");
const { cfg, fetchFileRaw, fetchCommits, fetchReviewDocs, fetchProjectName } = require("../lib/github");
const { parseTasks, buildPhases } = require("../lib/tasks");

let LAST_GOOD_TASKS = null; // tolerate a mid-write TASKS.md read between deploys

function localDayStartEpoch(tz, reset) {
  const now = new Date();
  if (reset === "utc") {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  }
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = dtf.formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
  const hour = p.hour === "24" ? 0 : parseInt(p.hour, 10);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  const offsetMs = asUTC - now.getTime();
  const midnightUTC = Date.UTC(+p.year, +p.month - 1, +p.day) - offsetMs;
  return Math.floor(midnightUTC / 1000);
}

module.exports = async (req, res) => {
  if (!isAuthed(req)) {
    res.statusCode = 401;
    return res.json({ error: "unauthorized" });
  }

  const tz = process.env.DASH_TZ || "Europe/Belgrade";
  const dayReset = (process.env.DASH_DAY_RESET || "local").toLowerCase();
  const { owner, repo, branch } = cfg();

  // A public repo can be read without a token, but GitHub limits unauthenticated
  // requests to 60/hour — so we detect that and recommend setting a token.
  const hasToken = !!process.env.GITHUB_TOKEN;
  let rateLimited = false, readError = null;

  // Tasks (with last-good fallback on a transient parse/read failure).
  let taskData = LAST_GOOD_TASKS;
  try {
    const text = await fetchFileRaw("TASKS.md");
    if (text != null) {
      taskData = parseTasks(text);
      LAST_GOOD_TASKS = taskData;
    } else {
      taskData = null; // file genuinely absent
    }
  } catch (e) { if (e.rateLimited) rateLimited = true; readError = e; }

  let reviews = [], commits = [], name = repo;
  try { reviews = await fetchReviewDocs(); } catch (e) { if (e.rateLimited) rateLimited = true; }
  // Per-commit file counts cost extra API calls; skip them when unauthenticated.
  try { commits = await fetchCommits(20, hasToken ? 10 : 0); } catch (e) { if (e.rateLimited) rateLimited = true; readError = e; }
  try { name = await fetchProjectName(repo); } catch (_) {}

  let errorSoft = null;
  if (rateLimited) {
    errorSoft = "GitHub's hourly limit for un-authenticated requests was reached. " +
      "Add a GITHUB_TOKEN in Vercel (Settings → Environment Variables) for a much higher limit.";
  } else if (readError && !taskData && !commits.length) {
    errorSoft = "Couldn't read the project from GitHub: " + readError.message;
  }

  const phases = buildPhases(taskData, reviews);

  // Today's completed work, by local-midnight boundary.
  const cutoff = localDayStartEpoch(tz, dayReset);
  const todays = commits.filter(c => c.epoch != null && c.epoch >= cutoff);

  const badge = commits.length || phases.available ? "IDLE" : "UNKNOWN";

  res.statusCode = 200;
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    generated_iso_utc: new Date().toISOString(),
    tz, day_reset: dayReset, cloud: true,
    error_soft: errorSoft,
    project: { name, root: `${owner}/${repo}`, branch, git: true },
    badge,
    hero: {
      percent: phases.overall_percent,
      buckets: phases.buckets,
      summary: phases.summary,
      has_tasks: phases.available,
    },
    phases_left: phases.left,
    phases_done: phases.done,
    today: {
      count: todays.length,
      items: todays.map(c => ({ message: c.message, iso_utc: c.iso_utc, short: c.short, file_count: c.file_count })),
    },
    right_now: {
      text: "Live activity isn't visible in the cloud version — it only exists on the machine where you edit. State here updates from GitHub.",
    },
    commits: commits.slice(0, 10).map(c => ({
      message: c.message, iso_utc: c.iso_utc, short: c.short, file_count: c.file_count,
    })),
    last_commit_iso: commits.length ? commits[0].iso_utc : null,
    hygiene: null,
  });
};
