// Shared task-board logic for the cloud dashboard.
// A faithful JS port of the Python parser in dashboard/server.py — parses the
// project's TASKS.md into phases + tasks and derives the completion view.

const STATUS_MAP = {
  done: "done", complete: "done", completed: "done", finished: "done", x: "done",
  "in-progress": "in-progress", "in progress": "in-progress", wip: "in-progress",
  doing: "in-progress", active: "in-progress",
  "not-started": "not-started", "not started": "not-started", todo: "not-started",
  "to-do": "not-started", pending: "not-started", backlog: "not-started",
  blocked: "blocked",
};

const PHASE_HEADER_RE = /^###\s+Phase\s+(\S+)\s*[—\-:]\s*(.+?)\s*$/;
const INTENT_RE = /^>\s*intent:\s*(.+?)\s*$/i;

function normalizeStatus(raw) {
  const key = (raw || "").trim().toLowerCase().replace(/`/g, "");
  return STATUS_MAP[key] || "not-started";
}

function parseEstHours(raw) {
  raw = (raw || "").trim().toLowerCase();
  if (!raw || raw === "-" || raw === "—") return null;
  let total = 0, found = false;
  for (const m of raw.matchAll(/(\d+(?:\.\d+)?)\s*([dhm])/g)) {
    found = true;
    const v = parseFloat(m[1]);
    if (m[2] === "d") total += v * 8;
    else if (m[2] === "h") total += v;
    else if (m[2] === "m") total += v / 60;
  }
  return found ? total : null;
}

function fmtHours(hours) {
  if (hours == null) return "—";
  if (hours >= 8) return `~${(hours / 8).toFixed(1).replace(/\.0$/, "")}d`;
  if (hours >= 1) return `~${Math.round(hours)}h`;
  return `~${Math.round(hours * 60)}m`;
}

// Parse TASKS.md text. Throws on malformed/empty input so the caller can fall
// back to the last good state.
function parseTasks(text) {
  const phases = [];
  const byId = {};
  let current = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");

    const mh = line.match(PHASE_HEADER_RE);
    if (mh) {
      const phase = { id: mh[1], name: mh[2], intent: null, tasks: [] };
      phases.push(phase);
      byId[mh[1]] = phase;
      current = mh[1];
      continue;
    }

    const mi = line.match(INTENT_RE);
    if (mi && current != null) {
      byId[current].intent = mi[1];
      continue;
    }

    if (line.startsWith("|")) {
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      if (cells.length < 4) continue;
      if (cells[0].toLowerCase() === "id") continue;            // header row
      if (cells.every(c => c === "" || /^[-:]+$/.test(c))) continue; // separator
      const [tid, title, phaseRef, status] = cells;
      const est = cells[4] || "", doneOn = cells[5] || "", notes = cells[6] || "";
      const task = {
        id: tid, title, phase_ref: phaseRef,
        status: normalizeStatus(status),
        est_hours: parseEstHours(est),
        done_on: doneOn || null,
        notes: notes || null,
      };
      let target = byId[phaseRef] || (current ? byId[current] : null);
      if (!target) {
        target = { id: phaseRef || "?", name: phaseRef ? `Phase ${phaseRef}` : "Ungrouped", intent: null, tasks: [] };
        phases.push(target);
        byId[phaseRef || "?"] = target;
      }
      target.tasks.push(task);
    }
  }

  if (!phases.some(p => p.tasks.length)) throw new Error("no tasks parsed");
  return { phases, source: "TASKS.md" };
}

function phaseCounts(tasks) {
  const done = tasks.filter(t => t.status === "done").length;
  const inProg = tasks.filter(t => t.status === "in-progress" || t.status === "blocked").length;
  const notStarted = tasks.filter(t => t.status === "not-started").length;
  const total = tasks.length;
  return { done, in_progress: inProg, not_started: notStarted, total,
           percent: total ? Math.round(done / total * 100) : 0 };
}

function phaseBuilt(tasks) {
  const doneT = tasks.filter(t => t.status === "done").map(t => t.title);
  const progT = tasks.filter(t => t.status === "in-progress" || t.status === "blocked").map(t => t.title);
  if (!doneT.length && !progT.length) return "Not started.";
  const parts = [];
  if (doneT.length) parts.push("Built: " + doneT.join("; ") + ".");
  if (progT.length) parts.push("In progress: " + progT.join("; ") + ".");
  return parts.join(" ");
}

function phaseEst(tasks) {
  const hrs = tasks.map(t => t.est_hours).filter(h => h != null);
  if (!hrs.length) return "—";
  return fmtHours(hrs.reduce((a, b) => a + b, 0));
}

function overallPercent(totals) {
  if (!totals.total) return null;
  const raw = totals.done / totals.total * 100;
  const remaining = 100 - raw;
  if (remaining > 0 && remaining < 1) return Math.round(raw * 10) / 10;
  return Math.round(raw);
}

function fractionPhrase(done, total) {
  if (!total) return "";
  const f = done / total;
  if (done === 0) return "just getting started";
  if (done === total) return "all done";
  if (f < 0.2) return "early days";
  if (f < 0.45) return "about a third of the way through";
  if (f < 0.55) return "about halfway there";
  if (f < 0.8) return "well over halfway";
  return "almost there";
}

function overallSummary(totals) {
  if (!totals.total) return "No tasks defined yet.";
  let s = `${totals.done} of ${totals.total} tasks done — ${fractionPhrase(totals.done, totals.total)}`;
  const extra = [];
  if (totals.in_progress) extra.push(`${totals.in_progress} in progress`);
  if (totals.not_started) extra.push(`${totals.not_started} not started`);
  if (extra.length) s += " (" + extra.join(", ") + ")";
  return s;
}

// Build the phase views + overall totals from parsed task data and the list of
// review docs found in the repo.
function buildPhases(taskData, reviews) {
  if (!taskData) {
    return {
      available: false, overall_percent: null,
      buckets: { done: 0, in_progress: 0, not_started: 0, total: 0 },
      left: [], done: [],
      summary: "No task file yet — add a TASKS.md to track progress.",
    };
  }
  const phases = taskData.phases;
  const allTasks = phases.flatMap(p => p.tasks);
  const totals = phaseCounts(allTasks);
  const reviewLabel = reviews.length ? `Reviewed ✓ (${reviews.join(", ")})` : "—";
  const reviewStatus = reviews.length ? "reviewed" : "none";

  const left = [], donePhases = [];
  for (const p of phases) {
    const counts = phaseCounts(p.tasks);
    const dates = p.tasks.map(t => t.done_on).filter(Boolean);
    const view = {
      id: p.id, name: p.name, intent: p.intent || "—",
      built: phaseBuilt(p.tasks), counts, est: phaseEst(p.tasks),
      review_status: reviewStatus, review_label: reviewLabel,
      completed_on: dates.length ? dates.sort().slice(-1)[0] : null,
    };
    if (counts.total > 0 && counts.done === counts.total) donePhases.push(view);
    else left.push(view);
  }

  // Exactly one "tackle this next".
  let nextId = null, nextReason = null;
  for (const p of left) {
    if (p.counts.in_progress > 0) { nextId = p.id; nextReason = "Already in progress — finish it before starting new work."; break; }
  }
  if (nextId == null) {
    for (const p of left) {
      if (p.counts.done === 0 && p.counts.total > 0) { nextId = p.id; nextReason = "Next phase in order with nothing started yet."; break; }
    }
  }
  if (nextId == null && left.length) { nextId = left[0].id; nextReason = "Closest phase to completion — keep the momentum."; }
  for (const p of left) {
    p.tackle_next = p.id === nextId;
    p.tackle_reason = p.id === nextId ? nextReason : null;
  }

  donePhases.sort((a, b) => (b.completed_on || "").localeCompare(a.completed_on || ""));

  return {
    available: true,
    overall_percent: overallPercent(totals),
    buckets: { done: totals.done, in_progress: totals.in_progress, not_started: totals.not_started, total: totals.total },
    left, done: donePhases,
    summary: overallSummary(totals),
  };
}

module.exports = { parseTasks, buildPhases };
