/* Cloud dashboard frontend.
   Polls /api/state, renders the cards, and supports an interactive Kanban board
   (drag a card to change its status — committed to GitHub). Times render in the
   project's local zone via Intl. A 401 sends you to the login page. */

"use strict";

const POLL_MS = 30000;
const HISTORY_MS = 60000;
let TZ = "UTC";
let CURRENT_PROJECT = 0;
let boardBusy = false;          // pause board re-render during drag / pending move
let lastState = null;

function $(id) { return document.getElementById(id); }

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: TZ, hour: "2-digit", minute: "2-digit", month: "short", day: "numeric", timeZoneName: "short" }).format(new Date(iso));
  } catch (e) { return new Date(iso).toLocaleString(); }
}
function fmtTimeShort(iso) {
  if (!iso) return "—";
  try { return new Intl.DateTimeFormat(undefined, { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
  catch (e) { return new Date(iso).toLocaleTimeString(); }
}
function fmtDate(ymd) { return ymd || "—"; }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ---------- header / hero ---------- */

function renderHeader(s) {
  $("project-name").textContent = s.project.name || "—";
  const root = $("project-root");
  root.textContent = s.project.root || "—";
  root.onclick = () => navigator.clipboard?.writeText(s.project.root || "").then(() => {
    const old = root.textContent; root.textContent = "Copied ✓";
    setTimeout(() => (root.textContent = old), 1200);
  }).catch(() => {});

  const badge = $("state-badge");
  const b = s.badge || "UNKNOWN";
  badge.textContent = b; badge.className = "badge badge--" + b.toLowerCase();
  $("last-refresh").textContent = "Last updated " + fmtTimeShort(s.generated_iso_utc);
  $("footer-line").textContent = "Project Dashboard · updated " + fmtTimeShort(s.generated_iso_utc);

  const se = $("soft-error");
  if (s.error_soft) { se.hidden = false; se.textContent = s.error_soft; } else se.hidden = true;

  // Project switcher (only when more than one configured).
  const wrap = $("project-switch-wrap"), sel = $("project-switch");
  const list = s.projects || [];
  if (list.length > 1) {
    wrap.hidden = false;
    if (sel.options.length !== list.length) {
      sel.innerHTML = "";
      list.forEach(p => { const o = document.createElement("option"); o.value = p.index; o.textContent = p.label; sel.appendChild(o); });
    }
    sel.value = String(s.project_index);
  } else wrap.hidden = true;
}

function renderHero(s) {
  const h = s.hero, pctEl = $("hero-percent");
  if (!h.has_tasks || h.percent == null) { pctEl.textContent = "—"; $("hero-summary").textContent = h.summary || "No task file yet."; }
  else { pctEl.textContent = h.percent + "%"; $("hero-summary").textContent = h.summary || ""; }
  const bk = h.buckets || { done: 0, in_progress: 0, not_started: 0, total: 0 };
  const total = bk.total || 0;
  $("seg-done").style.width = (total ? bk.done / total * 100 : 0) + "%";
  $("seg-prog").style.width = (total ? bk.in_progress / total * 100 : 0) + "%";
  $("seg-todo").style.width = (total ? bk.not_started / total * 100 : 0) + "%";
  $("leg-done").textContent = bk.done; $("leg-prog").textContent = bk.in_progress; $("leg-todo").textContent = bk.not_started;
}

/* ---------- board (mission control) ---------- */

const COLS = ["not-started", "in-progress", "done"];
const COL_LABELS = { "not-started": "Not started", "in-progress": "In progress", "done": "Done" };
const POST_URL = () => "/api/task-update?project=" + CURRENT_PROJECT;

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
  $("board-empty").hidden = tasks.length > 0;

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
  $("board-hint").textContent = writable ? "Tap a card to edit · drag to change status."
    : "Read-only — add a write-enabled GITHUB_TOKEN to edit.";
}

function renderTiles(tasks) {
  const today = todayStr();
  const soon = new Date(today); soon.setDate(soon.getDate() + 7); const soonStr = soon.toISOString().slice(0, 10);
  const prog = tasks.filter(t => t.column === "in-progress").length;
  const blocked = tasks.filter(t => t.status === "blocked").length;
  const overdue = tasks.filter(t => t.due && t.column !== "done" && t.due < today).length;
  const dueSoon = tasks.filter(t => t.due && t.column !== "done" && t.due >= today && t.due <= soonStr).length;
  const donePct = tasks.length ? Math.round(tasks.filter(t => t.column === "done").length / tasks.length * 100) : 0;
  $("tile-prog").textContent = prog; $("tile-blocked").textContent = blocked;
  $("tile-soon").textContent = dueSoon; $("tile-overdue").textContent = overdue;
  $("tile-done").textContent = donePct + "%";
  document.querySelectorAll(".tile").forEach(b => b.classList.toggle("active", b.dataset.tile === filters.tile));
}

function fillSelect(sel, values, current) {
  const first = sel.querySelector("option");
  sel.innerHTML = ""; sel.appendChild(first);
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
  renderTiles(allTasks);
  populateFilters(allTasks);
  drawBoard();
}

function boardMsg(text, kind) {
  const m = $("board-msg");
  if (!text) { m.hidden = true; return; }
  m.hidden = false; m.textContent = text; m.className = "board-msg " + (kind || "");
}

/* Pointer drag (mouse + touch); a click without movement opens the editor. */
let drag = null;
function attachCard(card) {
  card.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    let started = false, ghost = null;
    function onMove(ev) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!started && Math.hypot(dx, dy) < 8) return;
      if (!writable) return;                     // read-only: no drag
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
      if (!started) { openEditor(card._task); drag = null; return; }   // tap → edit
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
    // Reflect locally so the UI updates before the next poll.
    const t = allTasks.find(x => String(x.id) === String(id));
    if (t) {
      if (fields.status !== undefined) { t.status = fields.status; t.column = fields.status; }
      if (fields.priority !== undefined) t.priority = fields.priority || null;
      if (fields.due !== undefined) t.due = fields.due || null;
      if (fields.assignee !== undefined) t.assignee = fields.assignee || null;
      if (fields.labels !== undefined) t.labels = Array.isArray(fields.labels) ? fields.labels : String(fields.labels || "").split(",").map(s => s.trim()).filter(Boolean);
    }
    boardBusy = false; renderTiles(allTasks); drawBoard();
    boardMsg("Saved ✓ — committed to GitHub.", "ok"); setTimeout(() => boardMsg(""), 2500);
    return true;
  } catch (e) {
    boardBusy = false; if (lastState) renderBoard(lastState);
    boardMsg("Couldn't save: " + e.message, "err");
    return false;
  }
}

/* ---------- editor sheet ---------- */

let editingId = null;
function openEditor(t) {
  if (!t) return;
  editingId = t.id;
  $("editor-task").textContent = "Phase " + t.phase_id + " · #" + t.id + " — " + t.title;
  $("e-status").value = t.column; $("e-priority").value = t.priority || "";
  $("e-due").value = t.due || ""; $("e-assignee").value = t.assignee || "";
  $("e-labels").value = (t.labels || []).join(", ");
  const msg = $("editor-msg"); msg.hidden = true;
  const save = $("editor-save"); save.disabled = !writable; save.textContent = writable ? "Save" : "Read-only";
  $("editor").hidden = false; $("editor-backdrop").hidden = false;
}
function closeEditor() { $("editor").hidden = true; $("editor-backdrop").hidden = true; editingId = null; }
async function submitEditor() {
  if (!editingId || !writable) return;
  const fields = {
    status: $("e-status").value,
    priority: $("e-priority").value,
    due: $("e-due").value,
    assignee: $("e-assignee").value.trim(),
    labels: $("e-labels").value.split(",").map(s => s.trim()).filter(Boolean),
  };
  const m = $("editor-msg"); m.hidden = false; m.className = "board-msg"; m.textContent = "Saving…";
  const ok = await saveTask(editingId, fields, true);
  if (ok) closeEditor();
  else { m.className = "board-msg err"; m.textContent = "Couldn't save — check the token's write access."; }
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

/* ---------- phases / today / commits / prs ---------- */

function reviewPill(p) {
  if (p.review_status === "reviewed") { const x = el("span", "pill pill--review-ok", p.review_label); x.title = "A review document was found."; return x; }
  return el("span", "pill", p.review_label === "—" ? "Review —" : "Not yet reviewed");
}

function phaseNode(phase, showNext) {
  const node = el("div", "phase");
  const head = el("div", "phase-head");
  head.appendChild(el("span", "phase-title", "Phase " + phase.id + " — " + phase.name));
  head.appendChild(el("span", "pill pill--pct", phase.counts.percent + "%"));
  if (showNext && phase.tackle_next) { const n = el("span", "pill pill--next", "Tackle this next"); n.title = phase.tackle_reason || ""; head.appendChild(n); }
  node.appendChild(head);
  const intent = el("p", "phase-field"); intent.appendChild(el("span", "label", "Meant to build: ")); intent.appendChild(document.createTextNode(phase.intent || "—")); node.appendChild(intent);
  const built = el("p", "phase-field"); built.appendChild(el("span", "label", "Built so far: ")); built.appendChild(document.createTextNode(phase.built || "Not started.")); node.appendChild(built);
  const bar = el("div", "bar"); const span = el("span"); span.style.width = phase.counts.percent + "%"; bar.appendChild(span); node.appendChild(bar);
  const meta = el("div", "phase-meta");
  meta.appendChild(reviewPill(phase)); meta.appendChild(el("span", null, "Estimate: " + (phase.est || "—")));
  meta.appendChild(el("span", null, phase.counts.done + "/" + phase.counts.total + " tasks"));
  node.appendChild(meta);
  return node;
}

function renderLeft(s) {
  const wrap = $("phases-left"); wrap.innerHTML = "";
  const left = s.phases_left || [];
  if (!left.length) { wrap.appendChild(el("p", "empty", s.hero.has_tasks ? "Nothing left — every phase is complete." : "No data yet.")); return; }
  left.forEach(p => wrap.appendChild(phaseNode(p, true)));
}

function renderDone(s) {
  const wrap = $("phases-done"); wrap.innerHTML = "";
  const done = s.phases_done || [];
  if (!done.length) { wrap.appendChild(el("p", "empty", "Nothing completed yet.")); return; }
  done.forEach(p => {
    const node = el("div", "phase");
    const head = el("div", "phase-head");
    const title = el("span", "phase-title"); title.appendChild(el("span", "check", "✓")); title.appendChild(document.createTextNode("Phase " + p.id + " — " + p.name));
    head.appendChild(title); node.appendChild(head);
    const built = el("p", "phase-field"); built.appendChild(el("span", "label", "Shipped: ")); built.appendChild(document.createTextNode(p.built || "—")); node.appendChild(built);
    const meta = el("div", "phase-meta"); meta.appendChild(el("span", null, "Completed: " + fmtDate(p.completed_on))); meta.appendChild(reviewPill(p)); node.appendChild(meta);
    wrap.appendChild(node);
  });
}

function renderToday(s) {
  const t = s.today || { count: 0, items: [] };
  $("today-headline").textContent = t.count ? t.count + (t.count === 1 ? " thing completed today" : " things completed today") : "Nothing completed yet today.";
  const list = $("today-list"); list.innerHTML = "";
  (t.items || []).forEach(it => {
    const li = el("li"); li.appendChild(document.createTextNode(it.message + " "));
    const meta = el("span", "meta", "· " + fmtTimeShort(it.iso_utc) + (it.file_count != null ? " · " + it.file_count + (it.file_count === 1 ? " file" : " files") : ""));
    meta.title = it.short; li.appendChild(meta); list.appendChild(li);
  });
}

function renderRightNow(s) { $("right-now").textContent = (s.right_now && s.right_now.text) || "—"; }

function renderPRs(s) {
  const list = $("pr-list"); list.innerHTML = "";
  const prs = s.prs || [];
  if (!prs.length) { list.appendChild(el("li", "empty", "No open pull requests.")); return; }
  prs.forEach(pr => {
    const li = el("li");
    li.appendChild(el("span", "pr-ci " + pr.ci, pr.ci === "green" ? "passing" : pr.ci === "red" ? "failing" : pr.ci === "pending" ? "running" : "no checks"));
    const a = el("a", null, pr.title); a.href = pr.url; a.target = "_blank"; a.rel = "noopener noreferrer";
    li.appendChild(a);
    li.appendChild(el("span", "pr-num", "#" + pr.number + (pr.draft ? " · draft" : "")));
    list.appendChild(li);
  });
}

function renderCommits(s) {
  const list = $("commit-list"); list.innerHTML = "";
  const commits = s.commits || [];
  if (!commits.length) list.appendChild(el("li", "empty", "No commits yet."));
  else commits.forEach(c => {
    const li = el("li");
    li.appendChild(el("span", "time", fmtTime(c.iso_utc)));
    li.appendChild(document.createTextNode(c.message + " "));
    if (c.file_count != null) li.appendChild(el("span", "fc", "· " + c.file_count + (c.file_count === 1 ? " file" : " files")));
    li.title = c.short; list.appendChild(li);
  });
  let gap = "";
  if (s.last_commit_iso) {
    const mins = Math.round((Date.now() - new Date(s.last_commit_iso).getTime()) / 60000);
    if (mins < 2) gap = "Last save was just now.";
    else if (mins < 60) gap = "Last save was " + mins + " minutes ago.";
    else { const hrs = mins / 60; gap = "Last save was about " + hrs.toFixed(1) + " hours ago" + (hrs >= 3 ? " — that's a long gap." : "."); }
  }
  $("commit-gap").textContent = gap;
}

/* ---------- burndown chart ---------- */

function renderHistory(series) {
  const wrap = $("history-chart"); wrap.innerHTML = "";
  if (!series || series.length < 2) { wrap.appendChild(el("p", "empty", series && series.length === 1 ? "Only one data point so far — push more changes to TASKS.md to see a trend." : "Not enough history yet.")); return; }
  const W = 600, H = 160, pad = 24;
  const n = series.length;
  const x = i => pad + (W - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1));
  const y = p => (H - pad) - (H - 2 * pad) * (p / 100);
  const pts = series.map((d, i) => [x(i), y(d.percent)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = "M" + x(0).toFixed(1) + " " + (H - pad) + " " + pts.map(p => "L" + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") + " L" + x(n - 1).toFixed(1) + " " + (H - pad) + " Z";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Completion percentage over time");
  function mk(tag, attrs, cls) { const e = document.createElementNS(svgNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (cls) e.setAttribute("class", cls); return e; }
  // gridlines 0/50/100
  [0, 50, 100].forEach(p => {
    svg.appendChild(mk("line", { x1: pad, y1: y(p), x2: W - pad, y2: y(p) }, "hc-axis"));
    svg.appendChild(mk("text", { x: 2, y: y(p) + 3 }, "hc-label")).textContent = p + "%";
  });
  svg.appendChild(mk("path", { d: area }, "hc-area"));
  svg.appendChild(mk("path", { d: line }, "hc-line"));
  pts.forEach(p => svg.appendChild(mk("circle", { cx: p[0], cy: p[1], r: 2.5 }, "hc-dot")));
  // first/last date labels
  const lbl = (i, anchor) => { const t = mk("text", { x: x(i), y: H - 6, "text-anchor": anchor }, "hc-label"); t.textContent = (series[i].date || "").slice(0, 10); svg.appendChild(t); };
  lbl(0, "start"); if (n > 1) lbl(n - 1, "end");
  wrap.appendChild(svg);
}

async function fetchHistory() {
  try {
    const res = await fetch("/api/history?project=" + CURRENT_PROJECT, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    renderHistory(data.series || []);
  } catch (_) {}
}

/* ---------- poll loop ---------- */

async function tick() {
  try {
    const res = await fetch("/api/state?project=" + CURRENT_PROJECT, { cache: "no-store" });
    if (res.status === 401) { window.location.href = "/login.html"; return; }
    if (!res.ok) throw new Error("bad status " + res.status);
    const s = await res.json();
    lastState = s; TZ = s.tz || "UTC"; CURRENT_PROJECT = s.project_index || 0;
    renderHeader(s); renderHero(s); renderBoard(s);
    renderLeft(s); renderDone(s); renderToday(s); renderRightNow(s); renderPRs(s); renderCommits(s);
  } catch (e) {
    const badge = $("state-badge"); if (badge) { badge.textContent = "UNKNOWN"; badge.className = "badge badge--unknown"; }
    const lr = $("last-refresh"); if (lr) lr.textContent = "Connection lost — retrying…";
  }
}

$("logout").addEventListener("click", async () => { try { await fetch("/api/logout", { method: "POST" }); } catch (_) {} window.location.href = "/login.html"; });
$("project-switch").addEventListener("change", (e) => { CURRENT_PROJECT = parseInt(e.target.value, 10) || 0; tick(); fetchHistory(); });

wireBoardControls();
tick(); fetchHistory();
setInterval(tick, POLL_MS);
setInterval(fetchHistory, HISTORY_MS);
