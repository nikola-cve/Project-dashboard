/* Cloud dashboard frontend.
   Polls /api/state and renders the cards. Data comes from GitHub, so it changes
   when you push — a 30s poll is plenty. UTC timestamps are rendered in the
   project's local time zone via Intl. A 401 sends you to the login page. */

"use strict";

const POLL_MS = 30000;
let TZ = "UTC";

function $(id) { return document.getElementById(id); }

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: TZ, hour: "2-digit", minute: "2-digit",
      month: "short", day: "numeric", timeZoneName: "short",
    }).format(new Date(iso));
  } catch (e) { return new Date(iso).toLocaleString(); }
}
function fmtTimeShort(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch (e) { return new Date(iso).toLocaleTimeString(); }
}
function fmtDate(ymd) { return ymd || "—"; }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderHeader(s) {
  $("project-name").textContent = s.project.name || "—";
  const root = $("project-root");
  root.textContent = s.project.root || "—";
  root.onclick = () => {
    navigator.clipboard?.writeText(s.project.root || "").then(() => {
      const old = root.textContent; root.textContent = "Copied ✓";
      setTimeout(() => (root.textContent = old), 1200);
    }).catch(() => {});
  };
  const badge = $("state-badge");
  const b = s.badge || "UNKNOWN";
  badge.textContent = b;
  badge.className = "badge badge--" + b.toLowerCase();
  $("last-refresh").textContent = "Last updated " + fmtTimeShort(s.generated_iso_utc);

  const se = $("soft-error");
  if (s.error_soft) { se.hidden = false; se.textContent = s.error_soft; }
  else { se.hidden = true; }
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
  $("seg-done").style.width = (total ? bk.done / total * 100 : 0) + "%";
  $("seg-prog").style.width = (total ? bk.in_progress / total * 100 : 0) + "%";
  $("seg-todo").style.width = (total ? bk.not_started / total * 100 : 0) + "%";
  $("leg-done").textContent = bk.done;
  $("leg-prog").textContent = bk.in_progress;
  $("leg-todo").textContent = bk.not_started;
}

function reviewPill(phase) {
  if (phase.review_status === "reviewed") {
    const p = el("span", "pill pill--review-ok", phase.review_label);
    p.title = "A review document was found for this project.";
    return p;
  }
  return el("span", "pill", phase.review_label === "—" ? "Review —" : "Not yet reviewed");
}

function phaseNode(phase, showNext) {
  const node = el("div", "phase");
  const head = el("div", "phase-head");
  head.appendChild(el("span", "phase-title", "Phase " + phase.id + " — " + phase.name));
  head.appendChild(el("span", "pill pill--pct", phase.counts.percent + "%"));
  if (showNext && phase.tackle_next) {
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
  const span = el("span"); span.style.width = phase.counts.percent + "%"; bar.appendChild(span);
  node.appendChild(bar);

  const meta = el("div", "phase-meta");
  meta.appendChild(reviewPill(phase));
  meta.appendChild(el("span", null, "Estimate: " + (phase.est || "—")));
  meta.appendChild(el("span", null, phase.counts.done + "/" + phase.counts.total + " tasks"));
  node.appendChild(meta);
  return node;
}

function renderLeft(s) {
  const wrap = $("phases-left"); wrap.innerHTML = "";
  const left = s.phases_left || [];
  if (!left.length) {
    wrap.appendChild(el("p", "empty", s.hero.has_tasks ? "Nothing left — every phase is complete." : "No data yet."));
    return;
  }
  left.forEach(p => wrap.appendChild(phaseNode(p, true)));
}

function renderDone(s) {
  const wrap = $("phases-done"); wrap.innerHTML = "";
  const done = s.phases_done || [];
  if (!done.length) { wrap.appendChild(el("p", "empty", "Nothing completed yet.")); return; }
  done.forEach(p => {
    const node = el("div", "phase");
    const head = el("div", "phase-head");
    const title = el("span", "phase-title");
    title.appendChild(el("span", "check", "✓"));
    title.appendChild(document.createTextNode("Phase " + p.id + " — " + p.name));
    head.appendChild(title); node.appendChild(head);
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
  $("today-headline").textContent = t.count
    ? t.count + (t.count === 1 ? " thing completed today" : " things completed today")
    : "Nothing completed yet today.";
  const list = $("today-list"); list.innerHTML = "";
  (t.items || []).forEach(it => {
    const li = el("li");
    li.appendChild(document.createTextNode(it.message + " "));
    const meta = el("span", "meta", "· " + fmtTimeShort(it.iso_utc) +
      (it.file_count != null ? " · " + it.file_count + (it.file_count === 1 ? " file" : " files") : ""));
    meta.title = it.short;
    li.appendChild(meta);
    list.appendChild(li);
  });
}

function renderRightNow(s) { $("right-now").textContent = (s.right_now && s.right_now.text) || "—"; }

function renderCommits(s) {
  const list = $("commit-list"); list.innerHTML = "";
  const commits = s.commits || [];
  if (!commits.length) { list.appendChild(el("li", "empty", "No commits yet.")); }
  else commits.forEach(c => {
    const li = el("li");
    li.appendChild(el("span", "time", fmtTime(c.iso_utc)));
    li.appendChild(document.createTextNode(c.message + " "));
    if (c.file_count != null) li.appendChild(el("span", "fc", "· " + c.file_count + (c.file_count === 1 ? " file" : " files")));
    li.title = c.short;
    list.appendChild(li);
  });

  let gap = "";
  if (s.last_commit_iso) {
    const mins = Math.round((Date.now() - new Date(s.last_commit_iso).getTime()) / 60000);
    if (mins < 2) gap = "Last save was just now.";
    else if (mins < 60) gap = "Last save was " + mins + " minutes ago.";
    else {
      const hrs = mins / 60;
      gap = "Last save was about " + hrs.toFixed(1) + " hours ago" + (hrs >= 3 ? " — that's a long gap." : ".");
    }
  }
  $("commit-gap").textContent = gap;
}

async function tick() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.status === 401) { window.location.href = "/login.html"; return; }
    if (!res.ok) throw new Error("bad status " + res.status);
    const s = await res.json();
    TZ = s.tz || "UTC";
    renderHeader(s);
    renderHero(s);
    renderLeft(s);
    renderDone(s);
    renderToday(s);
    renderRightNow(s);
    renderCommits(s);
  } catch (e) {
    const badge = $("state-badge");
    if (badge) { badge.textContent = "UNKNOWN"; badge.className = "badge badge--unknown"; }
    const lr = $("last-refresh");
    if (lr) lr.textContent = "Connection lost — retrying…";
  }
}

$("logout").addEventListener("click", async () => {
  try { await fetch("/api/logout", { method: "POST" }); } catch (_) {}
  window.location.href = "/login.html";
});

tick();
setInterval(tick, POLL_MS);
