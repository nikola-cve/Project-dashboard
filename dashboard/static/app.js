/* Project dashboard frontend.
   Polls /api/state every 2 seconds and renders the cards. All timestamps come
   from the server as UTC ISO strings and are rendered in the project's local
   time zone here, so daylight-saving is handled automatically by the browser. */

"use strict";

const POLL_MS = 2000;
let TZ = "UTC";
let boardBusy = false;
let lastState = null;
const COLS = ["not-started", "in-progress", "done"];

/* ---------- helpers ---------- */

function $(id) { return document.getElementById(id); }

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: TZ,
      hour: "2-digit", minute: "2-digit",
      month: "short", day: "numeric",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch (e) {
    return new Date(iso).toLocaleString();
  }
}

function fmtTimeShort(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: TZ, hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch (e) {
    return new Date(iso).toLocaleTimeString();
  }
}

function fmtDate(ymd) {
  if (!ymd) return "—";
  // ymd is a plain YYYY-MM-DD from the task file; show it as-is (no zone math).
  return ymd;
}

/* Create an element with text content (safe against injection). */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ---------- renderers ---------- */

function renderHeader(s) {
  $("project-name").textContent = s.project.name || "—";
  const root = $("project-root");
  root.textContent = s.project.root || "—";
  root.onclick = () => {
    navigator.clipboard?.writeText(s.project.root || "").then(() => {
      const old = root.textContent;
      root.textContent = "Copied ✓";
      setTimeout(() => (root.textContent = old), 1200);
    }).catch(() => {});
  };

  const badge = $("state-badge");
  const b = (s.badge || "UNKNOWN");
  badge.textContent = b;
  badge.className = "badge badge--" + b.toLowerCase();

  $("last-refresh").textContent = "Last updated " + fmtTimeShort(s.generated_iso_utc);
  const fl = $("footer-line");
  if (fl) fl.textContent = "Project Dashboard · updated " + fmtTimeShort(s.generated_iso_utc);
}

/* ---------- board (mission control) ---------- */

const COL_LABELS = { "not-started": "Not started", "in-progress": "In progress", "done": "Done" };
const POST_URL = () => "/api/task-update";

let allTasks = [];
let writable = false;
let groupByPhase = false;
const filters = { search: "", phase: "", priority: "", assignee: "", label: "", tile: "" };

function todayStr() {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
function dueState(t) {
  if (!t.due || t.column === "done") return null;
  const today = todayStr();
  if (t.due < today) return "overdue";
  const soon = new Date(today); soon.setDate(soon.getDate() + 7);
  return t.due <= soon.toISOString().slice(0, 10) ? "soon" : "normal";
}
function initials(name) { return (name || "").split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?"; }

function taskCard(t) {
  const c = el("div", "task-card" + (t.in_next_phase && t.column !== "done" ? " is-next" : ""));
  c.dataset.id = t.id; c.dataset.col = t.column; c._task = t;
  if (t.priority) c.classList.add("prio-" + t.priority);
  const top = el("div", "tc-top");
  if (t.priority) { const d = el("span", "prio-dot prio-" + t.priority); d.title = t.priority + " priority"; top.appendChild(d); }
  top.appendChild(el("span", "tc-title", t.title));
  c.appendChild(top);
  const meta = el("div", "tc-meta");
  meta.appendChild(el("span", "tc-phase", "P" + t.phase_id));
  if (t.in_next_phase && t.column !== "done") meta.appendChild(el("span", "tc-next", "next"));
  const ds = dueState(t);
  if (t.due) { const due = el("span", "tc-due" + (ds === "overdue" ? " overdue" : ds === "soon" ? " soon" : ""), (ds === "overdue" ? "⚠ " : "") + t.due.slice(5)); due.title = "Due " + t.due; meta.appendChild(due); }
  (t.labels || []).forEach(l => meta.appendChild(el("span", "tc-label", l)));
  if (t.assignee) { const a = el("span", "tc-assignee", initials(t.assignee)); a.title = t.assignee; meta.appendChild(a); }
  c.appendChild(meta);
  attachCard(c);
  return c;
}

function applyFilters(tasks) {
  const q = filters.search.toLowerCase();
  const today = todayStr();
  const soon = new Date(today); soon.setDate(soon.getDate() + 7); const soonStr = soon.toISOString().slice(0, 10);
  return tasks.filter(t => {
    if (q && !((t.title || "").toLowerCase().includes(q) || String(t.id).toLowerCase().includes(q))) return false;
    if (filters.phase && t.phase_id !== filters.phase) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.assignee && t.assignee !== filters.assignee) return false;
    if (filters.label && !(t.labels || []).includes(filters.label)) return false;
    if (filters.tile === "in-progress" && t.column !== "in-progress") return false;
    if (filters.tile === "blocked" && t.status !== "blocked") return false;
    if (filters.tile === "done" && t.column !== "done") return false;
    if (filters.tile === "overdue" && !(t.due && t.column !== "done" && t.due < today)) return false;
    if (filters.tile === "due-soon" && !(t.due && t.column !== "done" && t.due >= today && t.due <= soonStr)) return false;
    return true;
  });
}

function makeBoard(tasks) {
  const board = el("div", "board");
  COLS.forEach(col => {
    const wrap = el("div", "board-col"); wrap.dataset.col = col;
    const items = tasks.filter(t => t.column === col);
    const title = el("h3", "board-col-title");
    title.appendChild(document.createTextNode(COL_LABELS[col] + " "));
    title.appendChild(el("span", "col-count", String(items.length)));
    wrap.appendChild(title);
    const drop = el("div", "board-drop"); drop.dataset.col = col;
    items.forEach(t => drop.appendChild(taskCard(t)));
    wrap.appendChild(drop);
    board.appendChild(wrap);
  });
  return board;
}

function drawBoard() {
  if (boardBusy) return;
  const container = $("board"); container.innerHTML = "";
  const tasks = applyFilters(allTasks);
  const empty = $("board-empty"); if (empty) empty.hidden = tasks.length > 0;
  if (groupByPhase) {
    const phases = [...new Set(allTasks.map(t => t.phase_id))];
    phases.forEach(pid => {
      const inPhase = tasks.filter(t => t.phase_id === pid);
      if (!inPhase.length) return;
      const name = (allTasks.find(t => t.phase_id === pid) || {}).phase_name || pid;
      const lane = el("div", "swimlane");
      lane.appendChild(el("div", "swimlane-title", "Phase " + pid + " — " + name));
      lane.appendChild(makeBoard(inPhase));
      container.appendChild(lane);
    });
  } else {
    container.appendChild(makeBoard(tasks));
  }
  $("board-hint").textContent = writable ? "Tap a card to edit · drag to change status." : "Read-only — TASKS.md not found.";
}

function renderTiles(tasks) {
  const today = todayStr();
  const soon = new Date(today); soon.setDate(soon.getDate() + 7); const soonStr = soon.toISOString().slice(0, 10);
  $("tile-prog").textContent = tasks.filter(t => t.column === "in-progress").length;
  $("tile-blocked").textContent = tasks.filter(t => t.status === "blocked").length;
  $("tile-overdue").textContent = tasks.filter(t => t.due && t.column !== "done" && t.due < today).length;
  $("tile-soon").textContent = tasks.filter(t => t.due && t.column !== "done" && t.due >= today && t.due <= soonStr).length;
  $("tile-done").textContent = (tasks.length ? Math.round(tasks.filter(t => t.column === "done").length / tasks.length * 100) : 0) + "%";
  document.querySelectorAll(".tile").forEach(b => b.classList.toggle("active", b.dataset.tile === filters.tile));
}

function fillSelect(sel, values, current) {
  const first = sel.querySelector("option"); sel.innerHTML = ""; sel.appendChild(first);
  values.forEach(v => { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); });
  sel.value = current || "";
}
function populateFilters(tasks) {
  fillSelect($("f-phase"), [...new Set(tasks.map(t => t.phase_id))], filters.phase);
  fillSelect($("f-assignee"), [...new Set(tasks.map(t => t.assignee).filter(Boolean))], filters.assignee);
  fillSelect($("f-label"), [...new Set(tasks.flatMap(t => t.labels || []))], filters.label);
}

function renderBoard(s) {
  if (boardBusy) return;
  allTasks = (s.board && s.board.tasks) || [];
  writable = !!(s.project && s.project.writable);
  renderTiles(allTasks); populateFilters(allTasks); drawBoard();
}

function boardMsg(text, kind) {
  const m = $("board-msg"); if (!m) return;
  if (!text) { m.hidden = true; return; }
  m.hidden = false; m.textContent = text; m.className = "board-msg " + (kind || "");
}

let drag = null;
function attachCard(card) {
  card.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    let started = false, ghost = null;
    function onMove(ev) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!started && Math.hypot(dx, dy) < 8) return;
      if (!writable) return;
      if (!started) {
        started = true; boardBusy = true; card.classList.add("dragging");
        ghost = card.cloneNode(true);
        Object.assign(ghost.style, { position: "fixed", pointerEvents: "none", width: card.offsetWidth + "px", zIndex: 1000, opacity: ".9", margin: 0 });
        document.body.appendChild(ghost);
        drag = { id: card.dataset.id, from: card.dataset.col };
      }
      ghost.style.left = (ev.clientX - 20) + "px"; ghost.style.top = (ev.clientY - 16) + "px";
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const drop = under && under.closest(".board-drop");
      document.querySelectorAll(".board-drop").forEach(d => d.classList.toggle("drag-over", d === drop));
    }
    function onUp(ev) {
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerup", onUp);
      card.removeEventListener("pointercancel", onUp);
      card.classList.remove("dragging");
      if (ghost) ghost.remove();
      document.querySelectorAll(".board-drop").forEach(d => d.classList.remove("drag-over"));
      if (!started) { openEditor(card._task); drag = null; return; }
      let target = null;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const drop = under && under.closest(".board-drop");
      if (drop) target = drop.dataset.col;
      if (target && target !== drag.from) saveTask(drag.id, { status: target });
      else boardBusy = false;
      drag = null;
    }
    card.setPointerCapture?.(e.pointerId);
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerup", onUp);
    card.addEventListener("pointercancel", onUp);
  });
}

async function saveTask(id, fields, fromEditor) {
  boardBusy = true;
  if (!fromEditor) boardMsg("Saving…", "");
  try {
    const res = await fetch(POST_URL(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...fields }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "save failed");
    const t = allTasks.find(x => String(x.id) === String(id));
    if (t) {
      if (fields.status !== undefined) { t.status = fields.status; t.column = fields.status; }
      if (fields.priority !== undefined) t.priority = fields.priority || null;
      if (fields.due !== undefined) t.due = fields.due || null;
      if (fields.assignee !== undefined) t.assignee = fields.assignee || null;
      if (fields.labels !== undefined) t.labels = Array.isArray(fields.labels) ? fields.labels : String(fields.labels || "").split(",").map(s => s.trim()).filter(Boolean);
    }
    boardBusy = false; renderTiles(allTasks); drawBoard();
    boardMsg("Saved ✓ — TASKS.md updated.", "ok"); setTimeout(() => boardMsg(""), 2500);
    return true;
  } catch (e) {
    boardBusy = false; if (lastState) renderBoard(lastState);
    boardMsg("Couldn't save: " + e.message, "err");
    return false;
  }
}

let editingId = null;
function openEditor(t) {
  if (!t) return;
  editingId = t.id;
  $("editor-task").textContent = "Phase " + t.phase_id + " · #" + t.id + " — " + t.title;
  $("e-status").value = t.column; $("e-priority").value = t.priority || "";
  $("e-due").value = t.due || ""; $("e-assignee").value = t.assignee || "";
  $("e-labels").value = (t.labels || []).join(", ");
  $("editor-msg").hidden = true;
  const save = $("editor-save"); save.disabled = !writable; save.textContent = writable ? "Save" : "Read-only";
  $("editor").hidden = false; $("editor-backdrop").hidden = false;
}
function closeEditor() { $("editor").hidden = true; $("editor-backdrop").hidden = true; editingId = null; }
async function submitEditor() {
  if (!editingId || !writable) return;
  const fields = {
    status: $("e-status").value, priority: $("e-priority").value, due: $("e-due").value,
    assignee: $("e-assignee").value.trim(),
    labels: $("e-labels").value.split(",").map(s => s.trim()).filter(Boolean),
  };
  const m = $("editor-msg"); m.hidden = false; m.className = "board-msg"; m.textContent = "Saving…";
  const ok = await saveTask(editingId, fields, true);
  if (ok) closeEditor(); else { m.className = "board-msg err"; m.textContent = "Couldn't save."; }
}

function wireBoardControls() {
  $("search").addEventListener("input", (e) => { filters.search = e.target.value; drawBoard(); });
  $("f-phase").addEventListener("change", (e) => { filters.phase = e.target.value; drawBoard(); });
  $("f-priority").addEventListener("change", (e) => { filters.priority = e.target.value; drawBoard(); });
  $("f-assignee").addEventListener("change", (e) => { filters.assignee = e.target.value; drawBoard(); });
  $("f-label").addEventListener("change", (e) => { filters.label = e.target.value; drawBoard(); });
  $("f-group").addEventListener("change", (e) => { groupByPhase = e.target.checked; drawBoard(); });
  $("f-clear").addEventListener("click", () => {
    filters.search = filters.phase = filters.priority = filters.assignee = filters.label = filters.tile = "";
    $("search").value = ""; ["f-phase", "f-priority", "f-assignee", "f-label"].forEach(id => { $(id).value = ""; });
    renderTiles(allTasks); drawBoard();
  });
  document.querySelectorAll(".tile").forEach(b => b.addEventListener("click", () => {
    filters.tile = filters.tile === b.dataset.tile ? "" : b.dataset.tile;
    renderTiles(allTasks); drawBoard();
  }));
  $("editor-close").addEventListener("click", closeEditor);
  $("editor-cancel").addEventListener("click", closeEditor);
  $("editor-backdrop").addEventListener("click", closeEditor);
  $("editor-save").addEventListener("click", submitEditor);
}

function renderHero(s) {
  const h = s.hero;
  const pctEl = $("hero-percent");
  if (!h.has_tasks || h.percent == null) {
    pctEl.textContent = "—";
    $("hero-summary").textContent = h.summary || "No task file yet.";
  } else {
    pctEl.textContent = h.percent + "%";
    $("hero-summary").textContent = h.summary || "";
  }

  const bk = h.buckets || { done: 0, in_progress: 0, not_started: 0, total: 0 };
  const total = bk.total || 0;
  const pd = total ? (bk.done / total) * 100 : 0;
  const pp = total ? (bk.in_progress / total) * 100 : 0;
  const pt = total ? (bk.not_started / total) * 100 : 0;
  $("seg-done").style.width = pd + "%";
  $("seg-prog").style.width = pp + "%";
  $("seg-todo").style.width = pt + "%";
  $("leg-done").textContent = bk.done;
  $("leg-prog").textContent = bk.in_progress;
  $("leg-todo").textContent = bk.not_started;
}

function reviewPill(phase) {
  if (phase.review_status === "reviewed") {
    return Object.assign(el("span", "pill pill--review-ok", phase.review_label), {
      title: "A review document was found for this project.",
    });
  }
  // No review process at all -> em dash; otherwise "Not yet reviewed".
  const label = phase.review_label === "—" ? "—" : "Not yet reviewed";
  return el("span", "pill", label === "—" ? "Review —" : label);
}

function phaseNode(phase, opts) {
  const node = el("div", "phase");

  const head = el("div", "phase-head");
  head.appendChild(el("span", "phase-title",
    "Phase " + phase.id + " — " + phase.name));
  head.appendChild(el("span", "pill pill--pct", phase.counts.percent + "%"));
  if (opts.showNext && phase.tackle_next) {
    const next = el("span", "pill pill--next", "Tackle this next");
    next.title = phase.tackle_reason || "Highest-leverage next move.";
    head.appendChild(next);
  }
  node.appendChild(head);

  const intent = el("p", "phase-field");
  intent.appendChild(el("span", "label", "Meant to build: "));
  intent.appendChild(document.createTextNode(phase.intent || "—"));
  node.appendChild(intent);

  const built = el("p", "phase-field");
  built.appendChild(el("span", "label", "Built so far: "));
  built.appendChild(document.createTextNode(phase.built || "Not started."));
  node.appendChild(built);

  const bar = el("div", "bar");
  const span = el("span");
  span.style.width = phase.counts.percent + "%";
  bar.appendChild(span);
  node.appendChild(bar);

  const meta = el("div", "phase-meta");
  meta.appendChild(reviewPill(phase));
  meta.appendChild(el("span", null, "Estimate: " + (phase.est || "—")));
  meta.appendChild(el("span", null,
    phase.counts.done + "/" + phase.counts.total + " tasks"));
  node.appendChild(meta);

  return node;
}

function renderLeft(s) {
  const wrap = $("phases-left");
  wrap.innerHTML = "";
  const left = s.phases_left || [];
  if (!left.length) {
    wrap.appendChild(el("p", "empty",
      s.hero.has_tasks ? "Nothing left — every phase is complete." : "No data yet."));
    return;
  }
  left.forEach(p => wrap.appendChild(phaseNode(p, { showNext: true })));
}

function renderDone(s) {
  const wrap = $("phases-done");
  wrap.innerHTML = "";
  const done = s.phases_done || [];
  if (!done.length) {
    wrap.appendChild(el("p", "empty", "Nothing completed yet."));
    return;
  }
  done.forEach(p => {
    const node = el("div", "phase");
    const head = el("div", "phase-head");
    const title = el("span", "phase-title");
    title.appendChild(el("span", "check", "✓"));
    title.appendChild(document.createTextNode("Phase " + p.id + " — " + p.name));
    head.appendChild(title);
    node.appendChild(head);

    const built = el("p", "phase-field");
    built.appendChild(el("span", "label", "Shipped: "));
    built.appendChild(document.createTextNode(p.built || "—"));
    node.appendChild(built);

    const meta = el("div", "phase-meta");
    meta.appendChild(el("span", null, "Completed: " + fmtDate(p.completed_on)));
    meta.appendChild(reviewPill(p));
    node.appendChild(meta);

    wrap.appendChild(node);
  });
}

function renderToday(s) {
  const t = s.today || { count: 0, items: [] };
  const head = $("today-headline");
  head.textContent = t.count
    ? t.count + (t.count === 1 ? " thing completed today" : " things completed today")
    : "Nothing completed yet today.";
  const list = $("today-list");
  list.innerHTML = "";
  (t.items || []).forEach(it => {
    const li = el("li");
    li.appendChild(document.createTextNode(it.message + " "));
    const meta = el("span", "meta",
      "· " + fmtTimeShort(it.iso_utc) + " · " + it.file_count +
      (it.file_count === 1 ? " file" : " files"));
    meta.title = it.short; // SHA only on hover
    li.appendChild(meta);
    list.appendChild(li);
  });
}

function renderRightNow(s) {
  $("right-now").textContent = (s.right_now && s.right_now.text) || "—";
}

function renderCommits(s) {
  const list = $("commit-list");
  list.innerHTML = "";
  const commits = s.commits || [];
  if (!commits.length) {
    list.appendChild(el("li", "empty", "No commits yet."));
  } else {
    commits.forEach(c => {
      const li = el("li");
      li.appendChild(el("span", "time", fmtTime(c.iso_utc)));
      li.appendChild(document.createTextNode(c.message + " "));
      const fc = el("span", "fc",
        "· " + c.file_count + (c.file_count === 1 ? " file" : " files"));
      li.title = c.short; // SHA on hover
      li.appendChild(fc);
      list.appendChild(li);
    });
  }
  $("commit-gap").textContent = (s.hygiene && s.hygiene.gap_text) || "";

  const unc = $("uncommitted");
  unc.innerHTML = "";
  const groups = (s.hygiene && s.hygiene.groups) || [];
  if (!groups.length) {
    unc.appendChild(el("p", "empty", "Everything's saved."));
  } else {
    groups.forEach(g => {
      const d = el("div", "group");
      d.textContent = g.description;
      d.title = g.files.join("\n"); // file paths on hover only
      unc.appendChild(d);
    });
  }

  const hy = $("hygiene");
  hy.innerHTML = "";
  const sugs = (s.hygiene && s.hygiene.suggestions) || [];
  sugs.forEach(text => {
    const warn = /haven't saved|failing|grows/i.test(text);
    hy.appendChild(el("div", "sug" + (warn ? " warn" : ""), text));
  });
  const order = (s.hygiene && s.hygiene.order) || [];
  if (order.length) {
    const ol = el("ul", "order");
    order.forEach(o => ol.appendChild(el("li", null, o)));
    hy.appendChild(ol);
  }
}

/* ---------- poll loop ---------- */

async function tick() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) throw new Error("bad status " + res.status);
    const s = await res.json();
    if (s.error) throw new Error(s.error);
    lastState = s;
    TZ = s.tz || "UTC";
    renderHeader(s);
    renderHero(s);
    renderBoard(s);
    renderLeft(s);
    renderDone(s);
    renderToday(s);
    renderRightNow(s);
    renderCommits(s);
  } catch (e) {
    // Degrade gracefully: keep the last good render, flag the badge.
    const badge = $("state-badge");
    if (badge) {
      badge.textContent = "UNKNOWN";
      badge.className = "badge badge--unknown";
    }
    const lr = $("last-refresh");
    if (lr) lr.textContent = "Connection lost — retrying…";
  }
}

wireBoardControls();
tick();
setInterval(tick, POLL_MS);
