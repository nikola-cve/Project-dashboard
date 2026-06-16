/* Command Center frontend (cloud).
   Tabbed: only the active tab fetches/polls its endpoint. Times render in the
   project's local zone. A 401 anywhere sends you to the login page. */

"use strict";

let TZ = "UTC";
let CURRENT_PROJECT = 0;
let currentTab = "overview";
let pollTimer = null;

/* ---------- helpers ---------- */
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function fmtTime(iso) { if (!iso) return "—"; try { return new Intl.DateTimeFormat(undefined, { timeZone: TZ, hour: "2-digit", minute: "2-digit", month: "short", day: "numeric", timeZoneName: "short" }).format(new Date(iso)); } catch (e) { return new Date(iso).toLocaleString(); } }
function fmtTimeShort(iso) { if (!iso) return "—"; try { return new Intl.DateTimeFormat(undefined, { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch (e) { return ""; } }
function fmtDate(ymd) { return ymd || "—"; }
async function api(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (res.status === 401) { window.location.href = "/login.html"; throw new Error("unauth"); }
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
function softError(msg) { const se = $("soft-error"); if (msg) { se.hidden = false; se.textContent = msg; } else se.hidden = true; }

/* ---------- header ---------- */
function updateHeader(s) {
  if (s.project) {
    $("project-name").textContent = s.project.name || "—";
    const root = $("project-root"); root.textContent = s.project.root || "—";
    root.onclick = () => navigator.clipboard?.writeText(s.project.root || "").then(() => { const o = root.textContent; root.textContent = "Copied ✓"; setTimeout(() => root.textContent = o, 1200); }).catch(() => {});
  }
  if (s.generated_iso_utc) $("last-refresh").textContent = "Updated " + fmtTimeShort(s.generated_iso_utc);
  TZ = s.tz || TZ;
  // project switcher
  const wrap = $("project-switch-wrap"), sel = $("project-switch");
  const list = s.projects || [];
  if (list.length > 1) {
    wrap.hidden = false;
    if (sel.options.length !== list.length) { sel.innerHTML = ""; list.forEach(p => { const o = document.createElement("option"); o.value = p.index; o.textContent = p.label; sel.appendChild(o); }); }
    sel.value = String(s.project_index != null ? s.project_index : (s.project && s.project.index) || 0);
  } else wrap.hidden = true;
  softError(s.error_soft || "");
}
function setBadge(kind) { const b = $("state-badge"); const map = { OK: "live", ATTENTION: "blocked", IDLE: "idle", UNKNOWN: "unknown" }; b.textContent = kind; b.className = "badge badge--" + (map[kind] || "unknown"); }

/* ---------- tabs ---------- */
const TABS = {
  overview: { load: loadOverview, poll: 20000 },
  board: { load: loadBoard, poll: 30000 },
  memory: { load: loadMemory, poll: 0 },
  activity: { load: loadActivity, poll: 60000 },
  risk: { load: loadRisk, poll: 60000 },
  fleet: { load: loadFleet, poll: 0 },
};
function activateTab(name) {
  if (!TABS[name]) name = "overview";
  currentTab = name;
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-current", t.dataset.tab === name ? "true" : "false"));
  document.querySelectorAll(".tabpanel").forEach(p => { p.hidden = p.id !== "tab-" + name; });
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  TABS[name].load();
  if (TABS[name].poll > 0) pollTimer = setInterval(TABS[name].load, TABS[name].poll);
}

/* ---------- Overview ---------- */
let prevHighAlerts = 0;
async function loadOverview() {
  let s; try { s = await api("/api/overview?project=" + CURRENT_PROJECT); } catch (e) { return; }
  updateHeader(s);
  const high = (s.alerts || []).filter(a => a.level === "high").length;
  setBadge(high ? "ATTENTION" : (s.kpis && s.kpis.done_percent != null) ? "OK" : "UNKNOWN");

  const k = s.kpis || {};
  $("ov-done").textContent = (k.done_percent == null ? "—" : k.done_percent + "%");
  $("ov-prog").textContent = k.in_progress || 0; $("ov-blocked").textContent = k.blocked || 0;
  $("ov-overdue").textContent = k.overdue || 0; $("ov-prs").textContent = k.open_prs || 0;
  $("ov-ci").textContent = s.ci_state === "green" ? "✓" : s.ci_state === "red" ? "✗" : s.ci_state === "pending" ? "…" : "—";

  // hero
  const bk = s.board_snapshot || { done: 0, in_progress: 0, not_started: 0, total: 0 };
  $("hero-percent").textContent = k.done_percent == null ? "—" : k.done_percent + "%";
  $("hero-summary").textContent = s.summary || "";
  const tot = bk.total || 0;
  $("seg-done").style.width = (tot ? bk.done / tot * 100 : 0) + "%"; $("seg-prog").style.width = (tot ? bk.in_progress / tot * 100 : 0) + "%"; $("seg-todo").style.width = (tot ? bk.not_started / tot * 100 : 0) + "%";
  $("leg-done").textContent = bk.done; $("leg-prog").textContent = bk.in_progress; $("leg-todo").textContent = bk.not_started;

  // alerts + bell
  const al = $("ov-alerts"); al.innerHTML = "";
  if ((s.alerts || []).length) { al.hidden = false; s.alerts.forEach(a => al.appendChild(el("span", "alert alert--" + a.level, a.text))); }
  else al.hidden = true;
  const bc = $("bell-count"); if (high) { bc.hidden = false; bc.textContent = high; } else bc.hidden = true;
  maybeNotify(s.alerts || [], high);

  // session + handoff
  $("ov-session").innerHTML = s.last_session ? s.last_session.html : "No session logged yet.";
  $("ov-handoff").innerHTML = s.handoff ? s.handoff.html : "No handoff yet.";

  // ops chips
  const ops = $("ov-ops"); ops.innerHTML = "";
  if (s.deploy) ops.appendChild(el("span", "chip chip--" + (s.deploy.state === "success" ? "ok" : s.deploy.state === "failure" ? "bad" : "neutral"), "Deploy: " + s.deploy.environment + " (" + s.deploy.state + ")"));
  (s.agents || []).forEach(a => ops.appendChild(el("span", "chip chip--" + (a.state === "healthy" ? "ok" : "bad"), "Agent: " + a.name + " · " + a.state)));
  if (!s.deploy && !(s.agents || []).length) ops.appendChild(el("span", "empty", "No deploys or agents yet."));

  // recent
  const rec = $("ov-recent"); rec.innerHTML = "";
  (s.recent || []).forEach(r => { const li = el("li"); li.appendChild(el("span", "feed-ic", r.type === "move" ? "↔" : "●")); li.appendChild(el("span", "feed-tx", r.text)); li.appendChild(el("span", "feed-tm", fmtTime(r.iso_utc))); rec.appendChild(li); });
  if (!(s.recent || []).length) rec.appendChild(el("li", "empty", "No activity yet."));

  fetchHistory();
}

/* ---------- browser notifications (opt-in) ---------- */
function notifyEnabled() { return localStorage.getItem("cc_notify") === "1"; }
function maybeNotify(alerts, high) {
  if (!notifyEnabled() || Notification.permission !== "granted") { prevHighAlerts = high; return; }
  if (high > prevHighAlerts) {
    const top = alerts.find(a => a.level === "high");
    try { new Notification("Command Center", { body: top ? top.text : high + " alerts" }); } catch (_) {}
  }
  prevHighAlerts = high;
}
$("bell").addEventListener("click", async () => {
  if (!notifyEnabled()) {
    if (Notification.permission === "default") { const p = await Notification.requestPermission(); if (p !== "granted") { activateTab("overview"); return; } }
    if (Notification.permission === "granted") { localStorage.setItem("cc_notify", "1"); $("bell").classList.add("on"); }
  } else { localStorage.removeItem("cc_notify"); $("bell").classList.remove("on"); }
  activateTab("overview");
});

/* ---------- burndown ---------- */
function renderHistory(series) {
  const wrap = $("history-chart"); wrap.innerHTML = "";
  if (!series || series.length < 2) { wrap.appendChild(el("p", "empty", series && series.length === 1 ? "Only one data point so far." : "Not enough history yet.")); return; }
  const W = 600, H = 160, pad = 24, n = series.length;
  const x = i => pad + (W - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1));
  const y = p => (H - pad) - (H - 2 * pad) * (p / 100);
  const pts = series.map((d, i) => [x(i), y(d.percent)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = "M" + x(0).toFixed(1) + " " + (H - pad) + " " + pts.map(p => "L" + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") + " L" + x(n - 1).toFixed(1) + " " + (H - pad) + " Z";
  const ns = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Completion over time");
  function mk(t, a, c) { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); if (c) e.setAttribute("class", c); return e; }
  [0, 50, 100].forEach(p => { svg.appendChild(mk("line", { x1: pad, y1: y(p), x2: W - pad, y2: y(p) }, "hc-axis")); const tx = mk("text", { x: 2, y: y(p) + 3 }, "hc-label"); tx.textContent = p + "%"; svg.appendChild(tx); });
  svg.appendChild(mk("path", { d: area }, "hc-area")); svg.appendChild(mk("path", { d: line }, "hc-line"));
  pts.forEach(p => svg.appendChild(mk("circle", { cx: p[0], cy: p[1], r: 2.5 }, "hc-dot")));
  wrap.appendChild(svg);
}
async function fetchHistory() { try { const d = await api("/api/history?project=" + CURRENT_PROJECT); renderHistory(d.series || []); } catch (_) {} }

/* ---------- Board ---------- */
const COLS = ["not-started", "in-progress", "done"];
const COL_LABELS = { "not-started": "Not started", "in-progress": "In progress", "done": "Done" };
let allTasks = [], writable = false, groupByPhase = false, boardBusy = false, lastState = null;
const filters = { search: "", phase: "", priority: "", assignee: "", label: "", tile: "" };

async function loadBoard() {
  let s; try { s = await api("/api/state?project=" + CURRENT_PROJECT); } catch (e) { return; }
  lastState = s; updateHeader(s);
  allTasks = (s.board && s.board.tasks) || []; writable = !!(s.project && s.project.writable);
  renderTiles(allTasks); populateFilters(allTasks); drawBoard();
}
function todayStr() { try { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } }
function dueState(t) { if (!t.due || t.column === "done") return null; const td = todayStr(); if (t.due < td) return "overdue"; const s = new Date(td); s.setDate(s.getDate() + 7); return t.due <= s.toISOString().slice(0, 10) ? "soon" : "normal"; }
function initials(n) { return (n || "").split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?"; }
function taskCard(t) {
  const c = el("div", "task-card" + (t.in_next_phase && t.column !== "done" ? " is-next" : "")); c.dataset.id = t.id; c.dataset.col = t.column; c._task = t;
  if (t.priority) c.classList.add("prio-" + t.priority);
  const top = el("div", "tc-top"); if (t.priority) { const d = el("span", "prio-dot prio-" + t.priority); d.title = t.priority; top.appendChild(d); } top.appendChild(el("span", "tc-title", t.title)); c.appendChild(top);
  const meta = el("div", "tc-meta"); meta.appendChild(el("span", "tc-phase", "P" + t.phase_id));
  if (t.in_next_phase && t.column !== "done") meta.appendChild(el("span", "tc-next", "next"));
  const ds = dueState(t); if (t.due) { const due = el("span", "tc-due" + (ds === "overdue" ? " overdue" : ds === "soon" ? " soon" : ""), (ds === "overdue" ? "⚠ " : "") + t.due.slice(5)); due.title = "Due " + t.due; meta.appendChild(due); }
  (t.labels || []).forEach(l => meta.appendChild(el("span", "tc-label", l)));
  if (t.assignee) { const a = el("span", "tc-assignee", initials(t.assignee)); a.title = t.assignee; meta.appendChild(a); }
  c.appendChild(meta); attachCard(c); return c;
}
function applyFilters(tasks) {
  const q = filters.search.toLowerCase(); const td = todayStr(); const s = new Date(td); s.setDate(s.getDate() + 7); const ss = s.toISOString().slice(0, 10);
  return tasks.filter(t => {
    if (q && !((t.title || "").toLowerCase().includes(q) || String(t.id).toLowerCase().includes(q))) return false;
    if (filters.phase && t.phase_id !== filters.phase) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.assignee && t.assignee !== filters.assignee) return false;
    if (filters.label && !(t.labels || []).includes(filters.label)) return false;
    if (filters.tile === "in-progress" && t.column !== "in-progress") return false;
    if (filters.tile === "blocked" && t.status !== "blocked") return false;
    if (filters.tile === "done" && t.column !== "done") return false;
    if (filters.tile === "overdue" && !(t.due && t.column !== "done" && t.due < td)) return false;
    if (filters.tile === "due-soon" && !(t.due && t.column !== "done" && t.due >= td && t.due <= ss)) return false;
    return true;
  });
}
function makeBoard(tasks) {
  const board = el("div", "board");
  COLS.forEach(col => { const wrap = el("div", "board-col"); wrap.dataset.col = col; const items = tasks.filter(t => t.column === col);
    const title = el("h3", "board-col-title"); title.appendChild(document.createTextNode(COL_LABELS[col] + " ")); title.appendChild(el("span", "col-count", String(items.length))); wrap.appendChild(title);
    const drop = el("div", "board-drop"); drop.dataset.col = col; items.forEach(t => drop.appendChild(taskCard(t))); wrap.appendChild(drop); board.appendChild(wrap); });
  return board;
}
function drawBoard() {
  if (boardBusy) return; const container = $("board"); container.innerHTML = ""; const tasks = applyFilters(allTasks); $("board-empty").hidden = tasks.length > 0;
  if (groupByPhase) {
    const phases = [...new Set(allTasks.map(t => t.phase_id))];
    phases.forEach(pid => { const inPhase = tasks.filter(t => t.phase_id === pid); if (!inPhase.length) return; const name = (allTasks.find(t => t.phase_id === pid) || {}).phase_name || pid; const lane = el("div", "swimlane"); lane.appendChild(el("div", "swimlane-title", "Phase " + pid + " — " + name)); lane.appendChild(makeBoard(inPhase)); container.appendChild(lane); });
  } else container.appendChild(makeBoard(tasks));
  $("board-hint").textContent = writable ? "Tap a card to edit · drag to change status." : "Read-only — add a write-enabled token to edit.";
}
function renderTiles(tasks) {
  const td = todayStr(); const s = new Date(td); s.setDate(s.getDate() + 7); const ss = s.toISOString().slice(0, 10);
  $("tile-prog").textContent = tasks.filter(t => t.column === "in-progress").length;
  $("tile-blocked").textContent = tasks.filter(t => t.status === "blocked").length;
  $("tile-overdue").textContent = tasks.filter(t => t.due && t.column !== "done" && t.due < td).length;
  $("tile-soon").textContent = tasks.filter(t => t.due && t.column !== "done" && t.due >= td && t.due <= ss).length;
  $("tile-done").textContent = (tasks.length ? Math.round(tasks.filter(t => t.column === "done").length / tasks.length * 100) : 0) + "%";
  document.querySelectorAll("#tiles .tile").forEach(b => b.classList.toggle("active", b.dataset.tile === filters.tile));
}
function fillSelect(sel, values, current) { const first = sel.querySelector("option"); sel.innerHTML = ""; sel.appendChild(first); values.forEach(v => { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); }); sel.value = current || ""; }
function populateFilters(tasks) { fillSelect($("f-phase"), [...new Set(tasks.map(t => t.phase_id))], filters.phase); fillSelect($("f-assignee"), [...new Set(tasks.map(t => t.assignee).filter(Boolean))], filters.assignee); fillSelect($("f-label"), [...new Set(tasks.flatMap(t => t.labels || []))], filters.label); }
function boardMsg(text, kind) { const m = $("board-msg"); if (!text) { m.hidden = true; return; } m.hidden = false; m.textContent = text; m.className = "board-msg " + (kind || ""); }

let drag = null;
function attachCard(card) {
  card.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return; const sx = e.clientX, sy = e.clientY; let started = false, ghost = null;
    function onMove(ev) {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return; if (!writable) return;
      if (!started) { started = true; boardBusy = true; card.classList.add("dragging"); ghost = card.cloneNode(true); Object.assign(ghost.style, { position: "fixed", pointerEvents: "none", width: card.offsetWidth + "px", zIndex: 1000, opacity: ".9", margin: 0 }); document.body.appendChild(ghost); drag = { id: card.dataset.id, from: card.dataset.col }; }
      ghost.style.left = (ev.clientX - 20) + "px"; ghost.style.top = (ev.clientY - 16) + "px";
      const u = document.elementFromPoint(ev.clientX, ev.clientY); const d = u && u.closest(".board-drop"); document.querySelectorAll(".board-drop").forEach(x => x.classList.toggle("drag-over", x === d));
    }
    function onUp(ev) {
      card.removeEventListener("pointermove", onMove); card.removeEventListener("pointerup", onUp); card.removeEventListener("pointercancel", onUp); card.classList.remove("dragging"); if (ghost) ghost.remove(); document.querySelectorAll(".board-drop").forEach(x => x.classList.remove("drag-over"));
      if (!started) { openEditor(card._task); drag = null; return; }
      const u = document.elementFromPoint(ev.clientX, ev.clientY); const d = u && u.closest(".board-drop"); const target = d && d.dataset.col;
      if (target && target !== drag.from) saveTask(drag.id, { status: target }); else boardBusy = false; drag = null;
    }
    card.setPointerCapture?.(e.pointerId); card.addEventListener("pointermove", onMove); card.addEventListener("pointerup", onUp); card.addEventListener("pointercancel", onUp);
  });
}
async function saveTask(id, fields, fromEditor) {
  boardBusy = true; if (!fromEditor) boardMsg("Saving…", "");
  try {
    const res = await fetch("/api/task-update?project=" + CURRENT_PROJECT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...fields }) });
    const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || "save failed");
    const t = allTasks.find(x => String(x.id) === String(id));
    if (t) { if (fields.status !== undefined) { t.status = fields.status; t.column = fields.status; } if (fields.priority !== undefined) t.priority = fields.priority || null; if (fields.due !== undefined) t.due = fields.due || null; if (fields.assignee !== undefined) t.assignee = fields.assignee || null; if (fields.labels !== undefined) t.labels = Array.isArray(fields.labels) ? fields.labels : String(fields.labels || "").split(",").map(s => s.trim()).filter(Boolean); }
    boardBusy = false; renderTiles(allTasks); drawBoard(); boardMsg("Saved ✓ — committed to GitHub.", "ok"); setTimeout(() => boardMsg(""), 2500); return true;
  } catch (e) { boardBusy = false; if (lastState) { allTasks = (lastState.board && lastState.board.tasks) || []; drawBoard(); } boardMsg("Couldn't save: " + e.message, "err"); return false; }
}
let editingId = null;
function openEditor(t) { if (!t) return; editingId = t.id; $("editor-task").textContent = "Phase " + t.phase_id + " · #" + t.id + " — " + t.title; $("e-status").value = t.column; $("e-priority").value = t.priority || ""; $("e-due").value = t.due || ""; $("e-assignee").value = t.assignee || ""; $("e-labels").value = (t.labels || []).join(", "); $("editor-msg").hidden = true; const sv = $("editor-save"); sv.disabled = !writable; sv.textContent = writable ? "Save" : "Read-only"; $("editor").hidden = false; $("editor-backdrop").hidden = false; }
function closeEditor() { $("editor").hidden = true; $("editor-backdrop").hidden = true; editingId = null; }
async function submitEditor() { if (!editingId || !writable) return; const fields = { status: $("e-status").value, priority: $("e-priority").value, due: $("e-due").value, assignee: $("e-assignee").value.trim(), labels: $("e-labels").value.split(",").map(s => s.trim()).filter(Boolean) }; const m = $("editor-msg"); m.hidden = false; m.className = "board-msg"; m.textContent = "Saving…"; const ok = await saveTask(editingId, fields, true); if (ok) closeEditor(); else { m.className = "board-msg err"; m.textContent = "Couldn't save."; } }

/* ---------- Memory ---------- */
let memKind = "sessions";
async function loadMemory() {
  document.querySelectorAll("#mem-subtabs .subtab").forEach(b => b.setAttribute("aria-current", b.dataset.kind === memKind ? "true" : "false"));
  $("mem-list-h").textContent = memKind.charAt(0).toUpperCase() + memKind.slice(1);
  const list = $("mem-list"); list.innerHTML = "<li class='empty'>Loading…</li>";
  let d; try { d = await api("/api/memory?kind=" + memKind + "&project=" + CURRENT_PROJECT); } catch (e) { return; }
  list.innerHTML = "";
  if (d.error_soft) softError(d.error_soft);
  if (!(d.items || []).length) { list.appendChild(el("li", "empty", "No " + memKind + " yet.")); return; }
  d.items.forEach(it => { const li = el("li", "mem-item"); li.appendChild(el("div", "mem-name", it.name.replace(/\.md$/, ""))); if (it.preview) li.appendChild(el("div", "mem-prev", it.preview)); li.onclick = () => openNote(it.path); list.appendChild(li); });
  // auto-open the first
  if (d.items[0]) openNote(d.items[0].path);
}
async function openNote(path) {
  $("mem-reader").innerHTML = "<p class='empty'>Loading…</p>";
  try { const d = await api("/api/memory?kind=" + memKind + "&path=" + encodeURIComponent(path) + "&project=" + CURRENT_PROJECT);
    $("mem-reader").innerHTML = d.html || "<p class='empty'>Empty.</p>"; const gh = $("mem-gh"); if (d.url) { gh.hidden = false; gh.href = d.url; } else gh.hidden = true; $("mem-reader-h").textContent = path.split("/").pop();
  } catch (e) { $("mem-reader").innerHTML = "<p class='empty'>Couldn't load.</p>"; }
}

/* ---------- Activity ---------- */
async function loadActivity() {
  const feed = $("act-feed"); if (!feed.children.length || feed.querySelector(".empty")) feed.innerHTML = "<li class='empty'>Loading…</li>";
  let d; try { d = await api("/api/activity?project=" + CURRENT_PROJECT); } catch (e) { return; }
  feed.innerHTML = ""; if (d.error_soft) softError(d.error_soft);
  const ic = { commit: "●", move: "↔", pr: "⇄", deploy: "🚀", session: "📝" };
  (d.items || []).forEach(it => { const li = el("li"); li.appendChild(el("span", "feed-ic", ic[it.type] || "•")); const tx = el("span", "feed-tx"); if (it.url) { const a = el("a", null, it.text); a.href = it.url; a.target = "_blank"; a.rel = "noopener noreferrer"; tx.appendChild(a); } else tx.textContent = it.text; li.appendChild(tx); li.appendChild(el("span", "feed-tm", fmtTime(it.iso_utc))); feed.appendChild(li); });
  if (!(d.items || []).length) feed.appendChild(el("li", "empty", "No activity yet."));
}

/* ---------- Risk ---------- */
async function loadRisk() {
  let d; try { d = await api("/api/risk?project=" + CURRENT_PROJECT); } catch (e) { return; }
  const ci = $("risk-ci"); ci.innerHTML = "";
  (d.ci || []).forEach(r => { const li = el("li"); li.appendChild(el("span", "pr-ci " + (r.state === "green" ? "green" : r.state === "red" ? "red" : r.state === "pending" ? "pending" : "none"), r.state)); const tx = el("span", "feed-tx"); if (r.url) { const a = el("a", null, r.name); a.href = r.url; a.target = "_blank"; a.rel = "noopener noreferrer"; tx.appendChild(a); } else tx.textContent = r.name; li.appendChild(tx); li.appendChild(el("span", "feed-tm", fmtTime(r.iso_utc))); ci.appendChild(li); });
  if (!(d.ci || []).length) ci.appendChild(el("li", "empty", "No CI runs found (add a GitHub Actions workflow)."));

  const bl = $("risk-blockers"); bl.innerHTML = "";
  (d.blockers || []).forEach(b => { const li = el("li"); li.appendChild(el("span", "feed-ic", "⛔")); li.appendChild(el("span", "feed-tx", "#" + b.id + " " + b.title + " (Phase " + b.phase + ")")); bl.appendChild(li); });
  if (!(d.blockers || []).length) bl.appendChild(el("li", "empty", "No blockers."));

  const reg = $("risk-register"); reg.innerHTML = "";
  if (!(d.risks || []).length) reg.appendChild(el("p", "empty", "No risk register (add RISK.json)."));
  else d.risks.forEach(r => { const row = el("div", "risk-row"); row.appendChild(el("span", "risk-sev sev-" + (r.severity || "low"), r.severity || "—")); const mid = el("div", "risk-mid"); mid.appendChild(el("div", "risk-title", (r.id ? r.id + " · " : "") + (r.title || ""))); if (r.notes) mid.appendChild(el("div", "risk-notes", r.notes)); row.appendChild(mid); row.appendChild(el("span", "risk-status", r.status || "")); reg.appendChild(row); });
}

/* ---------- Fleet ---------- */
async function loadFleet() {
  const grid = $("fleet-grid"); if (!grid.querySelector(".fleet-card")) grid.innerHTML = "<p class='empty'>Loading…</p>";
  let d; try { d = await api("/api/fleet"); } catch (e) { return; }
  grid.innerHTML = "";
  (d.projects || []).forEach(p => {
    const c = el("div", "fleet-card"); c.onclick = () => { CURRENT_PROJECT = p.index; const sel = $("project-switch"); if (sel) sel.value = String(p.index); activateTab("overview"); };
    c.appendChild(el("div", "fleet-name", p.label));
    c.appendChild(el("div", "fleet-pct", p.percent == null ? "—" : p.percent + "%"));
    const meta = el("div", "fleet-meta");
    meta.appendChild(el("span", null, (p.open_prs || 0) + " PRs"));
    if (p.blockers) meta.appendChild(el("span", "fleet-blk", p.blockers + " blocked"));
    meta.appendChild(el("span", null, "· " + (p.last_iso ? fmtTime(p.last_iso) : "no activity")));
    c.appendChild(meta);
    if (p.error) c.appendChild(el("div", "fleet-err", p.error));
    grid.appendChild(c);
  });
  if (!(d.projects || []).length) grid.appendChild(el("p", "empty", "No projects configured."));
}

/* ---------- wiring ---------- */
function wireControls() {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => activateTab(t.dataset.tab)));
  document.querySelectorAll("#mem-subtabs .subtab").forEach(b => b.addEventListener("click", () => { memKind = b.dataset.kind; loadMemory(); }));
  $("act-refresh").addEventListener("click", loadActivity);
  $("fleet-refresh").addEventListener("click", loadFleet);
  $("logout").addEventListener("click", async () => { try { await fetch("/api/logout", { method: "POST" }); } catch (_) {} window.location.href = "/login.html"; });
  $("project-switch").addEventListener("change", (e) => { CURRENT_PROJECT = parseInt(e.target.value, 10) || 0; activateTab(currentTab); });
  // board controls
  $("search").addEventListener("input", (e) => { filters.search = e.target.value; drawBoard(); });
  ["f-phase", "f-priority", "f-assignee", "f-label"].forEach(id => $(id).addEventListener("change", (e) => { filters[id.slice(2)] = e.target.value; drawBoard(); }));
  $("f-group").addEventListener("change", (e) => { groupByPhase = e.target.checked; drawBoard(); });
  $("f-clear").addEventListener("click", () => { filters.search = filters.phase = filters.priority = filters.assignee = filters.label = filters.tile = ""; $("search").value = ""; ["f-phase", "f-priority", "f-assignee", "f-label"].forEach(id => $(id).value = ""); renderTiles(allTasks); drawBoard(); });
  document.querySelectorAll("#tiles .tile").forEach(b => b.addEventListener("click", () => { filters.tile = filters.tile === b.dataset.tile ? "" : b.dataset.tile; renderTiles(allTasks); drawBoard(); }));
  $("editor-close").addEventListener("click", closeEditor); $("editor-cancel").addEventListener("click", closeEditor); $("editor-backdrop").addEventListener("click", closeEditor); $("editor-save").addEventListener("click", submitEditor);
  if (notifyEnabled()) $("bell").classList.add("on");
}

wireControls();
activateTab("overview");
