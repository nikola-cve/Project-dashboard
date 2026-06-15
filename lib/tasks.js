// Shared task-board logic for the cloud dashboard.
// Parses the project's TASKS.md (header-driven: column order is read from the
// table header row) into phases + tasks and derives the completion view.

const STATUS_MAP = {
  done: "done", complete: "done", completed: "done", finished: "done", x: "done",
  "in-progress": "in-progress", "in progress": "in-progress", wip: "in-progress",
  doing: "in-progress", active: "in-progress",
  "not-started": "not-started", "not started": "not-started", todo: "not-started",
  "to-do": "not-started", pending: "not-started", backlog: "not-started",
  blocked: "blocked",
};

// Header label -> canonical field name. Lets users add/reorder columns freely.
const HEADER_ALIASES = {
  id: "id", title: "title", task: "title", name: "title",
  phase: "phase", status: "status", state: "status",
  est: "est", estimate: "est", est_hours: "est", hours: "est",
  done_on: "done_on", done: "done_on", completed: "done_on", completed_on: "done_on",
  priority: "priority", prio: "priority", p: "priority",
  due: "due", due_date: "due", deadline: "due",
  assignee: "assignee", owner: "assignee", who: "assignee", assigned: "assignee",
  labels: "labels", label: "labels", tags: "labels", tag: "labels",
  notes: "notes", note: "notes",
};

const DEFAULT_COLS = { id: 0, title: 1, phase: 2, status: 3, est: 4, done_on: 5, notes: 6 };

const PHASE_HEADER_RE = /^###\s+Phase\s+(\S+)\s*[—\-:]\s*(.+?)\s*$/;
const INTENT_RE = /^>\s*intent:\s*(.+?)\s*$/i;

function splitRow(line) {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
}
function isSeparator(cells) { return cells.every(c => c === "" || /^[-:]+$/.test(c)); }

function normalizeStatus(raw) {
  const key = (raw || "").trim().toLowerCase().replace(/`/g, "");
  return STATUS_MAP[key] || "not-started";
}
function normalizePriority(raw) {
  const k = (raw || "").trim().toLowerCase();
  if (["high", "h", "p1", "urgent", "1"].includes(k)) return "high";
  if (["medium", "med", "m", "p2", "normal", "2"].includes(k)) return "medium";
  if (["low", "l", "p3", "3"].includes(k)) return "low";
  return null;
}
function parseLabels(raw) {
  return (raw || "").split(",").map(s => s.trim()).filter(Boolean);
}

function parseEstHours(raw) {
  raw = (raw || "").trim().toLowerCase();
  if (!raw || raw === "-" || raw === "—") return null;
  let total = 0, found = false;
  for (const m of raw.matchAll(/(\d+(?:\.\d+)?)\s*([dhm])/g)) {
    found = true; const v = parseFloat(m[1]);
    if (m[2] === "d") total += v * 8; else if (m[2] === "h") total += v; else if (m[2] === "m") total += v / 60;
  }
  return found ? total : null;
}
function fmtHours(hours) {
  if (hours == null) return "—";
  if (hours >= 8) return `~${(hours / 8).toFixed(1).replace(/\.0$/, "")}d`;
  if (hours >= 1) return `~${Math.round(hours)}h`;
  return `~${Math.round(hours * 60)}m`;
}

function cell(cells, cols, name) {
  const i = cols[name];
  return (i == null || i >= cells.length) ? "" : cells[i];
}

// Parse TASKS.md text into phases + tasks. Throws on empty/malformed input.
function parseTasks(text) {
  const phases = [];
  const byId = {};
  let current = null;
  let cols = DEFAULT_COLS;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");

    const mh = line.match(PHASE_HEADER_RE);
    if (mh) { const phase = { id: mh[1], name: mh[2], intent: null, tasks: [] }; phases.push(phase); byId[mh[1]] = phase; current = mh[1]; continue; }

    const mi = line.match(INTENT_RE);
    if (mi && current != null) { byId[current].intent = mi[1]; continue; }

    if (line.startsWith("|")) {
      const cells = splitRow(line);
      if (cells.length < 2) continue;
      if (cells[0].toLowerCase() === "id") {            // header row → column map
        cols = {};
        cells.forEach((h, i) => { const c = HEADER_ALIASES[h.toLowerCase().replace(/\s+/g, "_")]; if (c && cols[c] == null) cols[c] = i; });
        if (cols.id == null) cols.id = 0;
        continue;
      }
      if (isSeparator(cells)) continue;
      if (!cell(cells, cols, "title")) continue;

      const phaseRef = cell(cells, cols, "phase");
      const task = {
        id: cell(cells, cols, "id"),
        title: cell(cells, cols, "title"),
        phase_ref: phaseRef,
        status: normalizeStatus(cell(cells, cols, "status")),
        est_hours: parseEstHours(cell(cells, cols, "est")),
        done_on: cell(cells, cols, "done_on") || null,
        priority: normalizePriority(cell(cells, cols, "priority")),
        due: cell(cells, cols, "due") || null,
        assignee: cell(cells, cols, "assignee") || null,
        labels: parseLabels(cell(cells, cols, "labels")),
        notes: cell(cells, cols, "notes") || null,
      };
      let target = byId[phaseRef] || (current ? byId[current] : null);
      if (!target) { target = { id: phaseRef || "?", name: phaseRef ? `Phase ${phaseRef}` : "Ungrouped", intent: null, tasks: [] }; phases.push(target); byId[phaseRef || "?"] = target; }
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
  return { done, in_progress: inProg, not_started: notStarted, total, percent: total ? Math.round(done / total * 100) : 0 };
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
function phaseEst(tasks) { const h = tasks.map(t => t.est_hours).filter(x => x != null); return h.length ? fmtHours(h.reduce((a, b) => a + b, 0)) : "—"; }
function overallPercent(totals) { if (!totals.total) return null; const raw = totals.done / totals.total * 100; const rem = 100 - raw; return (rem > 0 && rem < 1) ? Math.round(raw * 10) / 10 : Math.round(raw); }
function fractionPhrase(done, total) { if (!total) return ""; const f = done / total; if (done === 0) return "just getting started"; if (done === total) return "all done"; if (f < 0.2) return "early days"; if (f < 0.45) return "about a third of the way through"; if (f < 0.55) return "about halfway there"; if (f < 0.8) return "well over halfway"; return "almost there"; }
function overallSummary(totals) {
  if (!totals.total) return "No tasks defined yet.";
  let s = `${totals.done} of ${totals.total} tasks done — ${fractionPhrase(totals.done, totals.total)}`;
  const extra = []; if (totals.in_progress) extra.push(`${totals.in_progress} in progress`); if (totals.not_started) extra.push(`${totals.not_started} not started`);
  if (extra.length) s += " (" + extra.join(", ") + ")"; return s;
}

function buildPhases(taskData, reviews) {
  if (!taskData) {
    return { available: false, overall_percent: null, buckets: { done: 0, in_progress: 0, not_started: 0, total: 0 }, left: [], done: [], tasks: [], next_phase_id: null, summary: "No task file yet — add a TASKS.md to track progress." };
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
    const view = { id: p.id, name: p.name, intent: p.intent || "—", built: phaseBuilt(p.tasks), counts, est: phaseEst(p.tasks), review_status: reviewStatus, review_label: reviewLabel, completed_on: dates.length ? dates.sort().slice(-1)[0] : null };
    if (counts.total > 0 && counts.done === counts.total) donePhases.push(view); else left.push(view);
  }

  let nextId = null, nextReason = null;
  for (const p of left) if (p.counts.in_progress > 0) { nextId = p.id; nextReason = "Already in progress — finish it before starting new work."; break; }
  if (nextId == null) for (const p of left) if (p.counts.done === 0 && p.counts.total > 0) { nextId = p.id; nextReason = "Next phase in order with nothing started yet."; break; }
  if (nextId == null && left.length) { nextId = left[0].id; nextReason = "Closest phase to completion — keep the momentum."; }
  for (const p of left) { p.tackle_next = p.id === nextId; p.tackle_reason = p.id === nextId ? nextReason : null; }

  donePhases.sort((a, b) => (b.completed_on || "").localeCompare(a.completed_on || ""));

  const tasks = [];
  for (const p of phases) for (const t of p.tasks) {
    const col = t.status === "done" ? "done" : (t.status === "in-progress" || t.status === "blocked") ? "in-progress" : "not-started";
    tasks.push({
      id: t.id, title: t.title, status: t.status, column: col,
      phase_id: p.id, phase_name: p.name, in_next_phase: p.id === nextId,
      priority: t.priority, due: t.due, assignee: t.assignee, labels: t.labels,
    });
  }

  return {
    available: true, overall_percent: overallPercent(totals),
    buckets: { done: totals.done, in_progress: totals.in_progress, not_started: totals.not_started, total: totals.total },
    left, done: donePhases, tasks, next_phase_id: nextId, summary: overallSummary(totals),
  };
}

// Build the column map from a TASKS.md text (for the editor write path).
function columnMap(lines) {
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    const cells = splitRow(line);
    if (cells[0] && cells[0].toLowerCase() === "id") {
      const cols = {};
      cells.forEach((h, i) => { const c = HEADER_ALIASES[h.toLowerCase().replace(/\s+/g, "_")]; if (c && cols[c] == null) cols[c] = i; });
      return { cols, width: cells.length };
    }
  }
  return { cols: { ...DEFAULT_COLS }, width: 7 };
}

// Update arbitrary fields of one task in the raw TASKS.md text. Only columns
// that exist in the table are written. Throws if the id isn't found.
function setTaskFields(text, id, fields, today) {
  const lines = text.split("\n");
  const { cols, width } = columnMap(lines);
  const wanted = {};
  if (fields.status !== undefined) {
    const st = { done: "done", "in-progress": "in-progress", "not-started": "not-started" }[fields.status];
    if (!st) throw new Error("invalid status: " + fields.status);
    wanted.status = st;
    if ("done_on" in cols) wanted.done_on = st === "done" ? today : "";
  }
  if (fields.priority !== undefined) wanted.priority = normalizePriority(fields.priority) || "";
  if (fields.due !== undefined) wanted.due = (fields.due || "").trim();
  if (fields.assignee !== undefined) wanted.assignee = (fields.assignee || "").trim();
  if (fields.labels !== undefined) wanted.labels = Array.isArray(fields.labels) ? fields.labels.join(", ") : (fields.labels || "").trim();

  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) continue;
    const cells = splitRow(line);
    if (cells.length < 2) continue;
    if (cells[0].toLowerCase() === "id") continue;
    if (isSeparator(cells)) continue;
    if ((cols.id != null ? cells[cols.id] : cells[0]) !== String(id)) continue;

    while (cells.length < width) cells.push("");
    for (const f in wanted) {
      const idx = cols[f];
      if (idx == null) continue;
      // For done_on, only clear/set when not already correct (preserve existing on done if present).
      if (f === "done_on" && wanted[f] && cells[idx]) continue;
      cells[idx] = wanted[f];
    }
    lines[i] = "| " + cells.join(" | ") + " |";
    changed = true;
    break;
  }
  if (!changed) throw new Error("task id not found: " + id);
  return lines.join("\n");
}

// Back-compat helper: status-only update.
function setTaskStatus(text, id, status, today) { return setTaskFields(text, id, { status }, today); }

module.exports = { parseTasks, buildPhases, setTaskFields, setTaskStatus };
