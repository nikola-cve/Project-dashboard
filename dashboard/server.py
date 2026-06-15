#!/usr/bin/env python3
"""Read-only project dashboard server.

A zero-dependency (standard library only) HTTP server that reads a project's
git history and task files and serves the live state as JSON for the frontend
to render. It NEVER writes, deletes, moves, commits, or pushes anything — it
only reads. It binds to 127.0.0.1 only.

Run:
    PROJECT_ROOT=/path/to/project python3 dashboard/server.py

Environment variables (all optional, safe defaults):
    PROJECT_ROOT    Absolute path to the project to monitor.
                    Default: the parent directory of this dashboard folder.
    DASH_PORT       TCP port to listen on. Default: 4747.
    DASH_HOST       Loopback host to bind. Default: 127.0.0.1.
    DASH_TZ         IANA time zone name. Default: Europe/Belgrade.
                    (Times are emitted as UTC and rendered locally by the
                    browser; this value is sent to the browser and also used
                    server-side to compute the "local midnight" day boundary.)
    DASH_DAY_RESET  'local' or 'utc'. When "today" resets. Default: local.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - zoneinfo ships with Python 3.9+
    ZoneInfo = None  # type: ignore

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

HERE = Path(__file__).resolve().parent
STATIC_DIR = HERE / "static"

PROJECT_ROOT = Path(
    os.environ.get("PROJECT_ROOT", str(HERE.parent))
).resolve()
PORT = int(os.environ.get("DASH_PORT", "4747"))
HOST = os.environ.get("DASH_HOST", "127.0.0.1")
TZ_NAME = os.environ.get("DASH_TZ", "Europe/Belgrade")
DAY_RESET = os.environ.get("DASH_DAY_RESET", "local").lower()

# How recently a file must have changed for work to count as "happening now".
ACTIVE_WINDOW_SECONDS = 5 * 60

# Status aliases -> normalized status.
STATUS_MAP = {
    "done": "done",
    "complete": "done",
    "completed": "done",
    "finished": "done",
    "x": "done",
    "in-progress": "in-progress",
    "in progress": "in-progress",
    "wip": "in-progress",
    "doing": "in-progress",
    "active": "in-progress",
    "not-started": "not-started",
    "not started": "not-started",
    "todo": "not-started",
    "to-do": "not-started",
    "pending": "not-started",
    "backlog": "not-started",
    "blocked": "blocked",
}

REVIEW_DOCS = ["REVIEW.md", "SECURITY.md", "VERIFICATION.md", "AUDIT.md"]

# Last successfully-parsed task snapshot, kept so a mid-write read of the task
# file degrades to the previous good state instead of blanking the dashboard.
_last_good_tasks: dict | None = None


# --------------------------------------------------------------------------- #
# Small utilities
# --------------------------------------------------------------------------- #

def _tz():
    """Return the configured tzinfo, or UTC if zoneinfo/tzdata is unavailable."""
    if ZoneInfo is None:
        return timezone.utc
    try:
        return ZoneInfo(TZ_NAME)
    except Exception:
        return timezone.utc


def _iso_utc(epoch: float) -> str:
    """Convert a unix epoch to a UTC ISO-8601 string (rendered locally later)."""
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _day_start_epoch() -> float:
    """Epoch of the most recent day boundary (local midnight or UTC midnight)."""
    now = datetime.now(timezone.utc)
    if DAY_RESET == "utc":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return start.timestamp()
    tz = _tz()
    local_now = now.astimezone(tz)
    local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight.timestamp()


def run_git(args: list[str]) -> tuple[bool, str]:
    """Run a read-only git command in the project. Returns (ok, stdout).

    Never raises; on any failure returns (False, "").
    """
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return False, ""
    if result.returncode != 0:
        return False, ""
    return True, result.stdout


def is_git_repo() -> bool:
    ok, out = run_git(["rev-parse", "--is-inside-work-tree"])
    return ok and out.strip() == "true"


# --------------------------------------------------------------------------- #
# Git data
# --------------------------------------------------------------------------- #

# Record/field separators chosen to never appear in commit metadata.
_RS = "\x1e"
_FS = "\x1f"


def get_commits(limit: int = 50) -> list[dict]:
    """Recent commits, newest first, with file counts. Empty list on no git."""
    ok, out = run_git(
        [
            "log",
            f"-n{limit}",
            f"--pretty=format:{_RS}%H{_FS}%h{_FS}%at{_FS}%an{_FS}%s",
            "--name-only",
        ]
    )
    if not ok or not out.strip():
        return []
    commits: list[dict] = []
    for chunk in out.split(_RS):
        chunk = chunk.strip("\n")
        if not chunk:
            continue
        lines = chunk.split("\n")
        header = lines[0]
        parts = header.split(_FS)
        if len(parts) < 5:
            continue
        sha, short, at, author, subject = parts[0], parts[1], parts[2], parts[3], parts[4]
        files = [ln for ln in lines[1:] if ln.strip()]
        try:
            epoch = float(at)
        except ValueError:
            continue
        commits.append(
            {
                "sha": sha,
                "short": short,
                "message": subject,
                "author": author,
                "epoch": epoch,
                "iso_utc": _iso_utc(epoch),
                "file_count": len(files),
            }
        )
    return commits


def get_current_branch() -> str | None:
    ok, out = run_git(["rev-parse", "--abbrev-ref", "HEAD"])
    if not ok:
        return None
    return out.strip() or None


def get_status() -> list[dict]:
    """Uncommitted changes via porcelain status. Empty list on clean/no git."""
    ok, out = run_git(["status", "--porcelain", "--untracked-files=all"])
    if not ok or not out.strip():
        return []
    entries: list[dict] = []
    for line in out.splitlines():
        if len(line) < 4:
            continue
        code = line[:2]
        path = line[3:]
        # Renames look like "old -> new"; keep the new path.
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        path = path.strip().strip('"')
        entries.append({"code": code.strip(), "path": path})
    return entries


def _change_kind(code: str) -> str:
    c = code.replace(" ", "")
    if "?" in c:
        return "added"
    if "A" in c:
        return "added"
    if "D" in c:
        return "deleted"
    if "R" in c:
        return "renamed"
    if "M" in c:
        return "modified"
    return "changed"


# --------------------------------------------------------------------------- #
# Task file parsing
# --------------------------------------------------------------------------- #

PHASE_HEADER_RE = re.compile(r"^###\s+Phase\s+(\S+)\s*[—\-:]\s*(.+?)\s*$")
INTENT_RE = re.compile(r"^>\s*intent:\s*(.+?)\s*$", re.IGNORECASE)


def _normalize_status(raw: str) -> str:
    key = raw.strip().lower().strip("`")
    return STATUS_MAP.get(key, "not-started")


def _parse_est_hours(raw: str) -> float | None:
    """Parse an estimate like '2h', '1d', '30m' into hours. None if blank."""
    raw = (raw or "").strip().lower()
    if not raw or raw in {"-", "—"}:
        return None
    total = 0.0
    found = False
    for value, unit in re.findall(r"(\d+(?:\.\d+)?)\s*([dhm])", raw):
        found = True
        v = float(value)
        if unit == "d":
            total += v * 8.0  # treat a working day as 8h (declared assumption)
        elif unit == "h":
            total += v
        elif unit == "m":
            total += v / 60.0
    return total if found else None


def _fmt_hours(hours: float | None) -> str:
    if hours is None:
        return "—"
    if hours >= 8:
        days = hours / 8.0
        return f"~{days:.1f}d".replace(".0d", "d")
    return f"~{hours:.0f}h" if hours >= 1 else f"~{round(hours * 60)}m"


# Header label -> canonical field name (header-driven columns).
HEADER_ALIASES = {
    "id": "id", "title": "title", "task": "title", "name": "title",
    "phase": "phase", "status": "status", "state": "status",
    "est": "est", "estimate": "est", "est_hours": "est", "hours": "est",
    "done_on": "done_on", "done": "done_on", "completed": "done_on", "completed_on": "done_on",
    "priority": "priority", "prio": "priority", "p": "priority",
    "due": "due", "due_date": "due", "deadline": "due",
    "assignee": "assignee", "owner": "assignee", "who": "assignee", "assigned": "assignee",
    "labels": "labels", "label": "labels", "tags": "labels", "tag": "labels",
    "notes": "notes", "note": "notes",
}
DEFAULT_COLS = {"id": 0, "title": 1, "phase": 2, "status": 3, "est": 4, "done_on": 5, "notes": 6}


def _normalize_priority(raw: str) -> str | None:
    k = (raw or "").strip().lower()
    if k in ("high", "h", "p1", "urgent", "1"):
        return "high"
    if k in ("medium", "med", "m", "p2", "normal", "2"):
        return "medium"
    if k in ("low", "l", "p3", "3"):
        return "low"
    return None


def _parse_labels(raw: str) -> list[str]:
    return [s.strip() for s in (raw or "").split(",") if s.strip()]


def _header_cols(cells: list[str]) -> dict:
    cols: dict[str, int] = {}
    for i, h in enumerate(cells):
        c = HEADER_ALIASES.get(h.lower().replace(" ", "_"))
        if c and c not in cols:
            cols[c] = i
    if "id" not in cols:
        cols["id"] = 0
    return cols


def _cell(cells: list[str], cols: dict, name: str) -> str:
    i = cols.get(name)
    if i is None or i >= len(cells):
        return ""
    return cells[i]


def parse_tasks(text: str) -> dict:
    """Parse the TASKS.md content into phases + tasks. Raises on malformed input.

    Columns are matched by header name, so order/extra columns are tolerated.
    Returns a dict: {"phases": [...], "source": "TASKS.md"}.
    """
    phases: list[dict] = []
    phase_by_id: dict[str, dict] = {}
    current_phase_id: str | None = None
    cols = dict(DEFAULT_COLS)

    for raw_line in text.splitlines():
        line = raw_line.rstrip()

        m = PHASE_HEADER_RE.match(line)
        if m:
            pid, name = m.group(1), m.group(2)
            phase = {
                "id": pid,
                "name": name,
                "intent": None,
                "tasks": [],
            }
            phases.append(phase)
            phase_by_id[pid] = phase
            current_phase_id = pid
            continue

        mi = INTENT_RE.match(line)
        if mi and current_phase_id is not None:
            phase_by_id[current_phase_id]["intent"] = mi.group(1)
            continue

        if line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 2:
                continue
            # A header row redefines the column map for following rows.
            if cells[0].lower() == "id":
                cols = _header_cols(cells)
                continue
            if all(set(c) <= {"-", ":"} for c in cells if c):
                continue
            if not _cell(cells, cols, "title"):
                continue
            phase_ref = _cell(cells, cols, "phase")
            task = {
                "id": _cell(cells, cols, "id"),
                "title": _cell(cells, cols, "title"),
                "phase_ref": phase_ref,
                "status": _normalize_status(_cell(cells, cols, "status")),
                "est_hours": _parse_est_hours(_cell(cells, cols, "est")),
                "done_on": _cell(cells, cols, "done_on") or None,
                "priority": _normalize_priority(_cell(cells, cols, "priority")),
                "due": _cell(cells, cols, "due") or None,
                "assignee": _cell(cells, cols, "assignee") or None,
                "labels": _parse_labels(_cell(cells, cols, "labels")),
                "notes": _cell(cells, cols, "notes") or None,
            }
            target = phase_by_id.get(phase_ref)
            if target is None:
                target = phase_by_id.get(current_phase_id) if current_phase_id else None
            if target is None:
                # A task referencing an undeclared phase: synthesize one.
                target = {
                    "id": phase_ref or "?",
                    "name": f"Phase {phase_ref}" if phase_ref else "Ungrouped",
                    "intent": None,
                    "tasks": [],
                }
                phases.append(target)
                phase_by_id[phase_ref or "?"] = target
            target["tasks"].append(task)

    if not any(p["tasks"] for p in phases):
        raise ValueError("no tasks parsed")

    return {"phases": phases, "source": "TASKS.md"}


def load_tasks() -> dict | None:
    """Read and parse TASKS.md, falling back to the last good parse on error."""
    global _last_good_tasks
    path = PROJECT_ROOT / "TASKS.md"
    if not path.exists():
        return _last_good_tasks  # may be None
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
        parsed = parse_tasks(text)
        _last_good_tasks = parsed
        return parsed
    except Exception:
        # Mid-write or malformed read: keep showing the last good state.
        return _last_good_tasks


# --------------------------------------------------------------------------- #
# Aggregation / derived state
# --------------------------------------------------------------------------- #

def _phase_counts(tasks: list[dict]) -> dict:
    done = sum(1 for t in tasks if t["status"] == "done")
    in_prog = sum(1 for t in tasks if t["status"] in ("in-progress", "blocked"))
    not_started = sum(1 for t in tasks if t["status"] == "not-started")
    total = len(tasks)
    pct = round(done / total * 100) if total else 0
    return {
        "done": done,
        "in_progress": in_prog,
        "not_started": not_started,
        "total": total,
        "percent": pct,
    }


def _phase_built_text(tasks: list[dict]) -> str:
    done_titles = [t["title"] for t in tasks if t["status"] == "done"]
    prog_titles = [t["title"] for t in tasks if t["status"] in ("in-progress", "blocked")]
    if not done_titles and not prog_titles:
        return "Not started."
    parts = []
    if done_titles:
        parts.append("Built: " + "; ".join(done_titles) + ".")
    if prog_titles:
        parts.append("In progress: " + "; ".join(prog_titles) + ".")
    return " ".join(parts)


def _phase_est(tasks: list[dict]) -> str:
    hours = [t["est_hours"] for t in tasks if t["est_hours"] is not None]
    if not hours:
        return "—"
    return _fmt_hours(sum(hours))


def _detect_reviews() -> list[str]:
    found = []
    for name in REVIEW_DOCS:
        if (PROJECT_ROOT / name).exists():
            found.append(name)
    return found


def build_phases(task_data: dict | None, reviews: list[str]) -> dict:
    """Build the what's-left / what's-done phase views and overall totals."""
    if not task_data:
        return {
            "available": False,
            "overall_percent": None,
            "buckets": {"done": 0, "in_progress": 0, "not_started": 0, "total": 0},
            "left": [],
            "done": [],
            "tasks": [],
            "next_phase_id": None,
            "summary": "No task file yet — add a TASKS.md to track progress.",
        }

    phases = task_data["phases"]
    all_tasks = [t for p in phases for t in p["tasks"]]
    totals = _phase_counts(all_tasks)

    review_label = (
        f"Reviewed ✓ ({', '.join(reviews)})" if reviews else "—"
    )
    review_status = "reviewed" if reviews else "none"

    left, done_phases = [], []
    for p in phases:
        counts = _phase_counts(p["tasks"])
        completed_dates = [t["done_on"] for t in p["tasks"] if t["done_on"]]
        view = {
            "id": p["id"],
            "name": p["name"],
            "intent": p["intent"] or "—",
            "built": _phase_built_text(p["tasks"]),
            "counts": counts,
            "est": _phase_est(p["tasks"]),
            "review_status": review_status,
            "review_label": review_label,
            "completed_on": max(completed_dates) if completed_dates else None,
        }
        if counts["total"] > 0 and counts["done"] == counts["total"]:
            done_phases.append(view)
        else:
            left.append(view)

    # Exactly one "tackle this next": first in-progress phase, else first
    # not-started phase, by document order.
    next_id, next_reason = None, None
    for p in left:
        if p["counts"]["in_progress"] > 0:
            next_id = p["id"]
            next_reason = "Already in progress — finish it before starting new work."
            break
    if next_id is None:
        for p in left:
            if p["counts"]["done"] == 0 and p["counts"]["total"] > 0:
                next_id = p["id"]
                next_reason = "Next phase in order with nothing started yet."
                break
    if next_id is None and left:
        next_id = left[0]["id"]
        next_reason = "Closest phase to completion — keep the momentum."
    for p in left:
        p["tackle_next"] = p["id"] == next_id
        p["tackle_reason"] = next_reason if p["id"] == next_id else None

    # Done phases newest first by completion date when available.
    done_phases.sort(key=lambda v: v["completed_on"] or "", reverse=True)

    # Flat task list for the Kanban board.
    tasks = []
    for p in phases:
        for t in p["tasks"]:
            if t["status"] == "done":
                col = "done"
            elif t["status"] in ("in-progress", "blocked"):
                col = "in-progress"
            else:
                col = "not-started"
            tasks.append({
                "id": t["id"], "title": t["title"], "status": t["status"],
                "column": col, "phase_id": p["id"], "phase_name": p["name"],
                "in_next_phase": p["id"] == next_id,
                "priority": t.get("priority"), "due": t.get("due"),
                "assignee": t.get("assignee"), "labels": t.get("labels", []),
            })

    # Plain-English overall summary.
    summary = _overall_summary(totals)

    return {
        "available": True,
        "overall_percent": _overall_percent(totals),
        "buckets": {
            "done": totals["done"],
            "in_progress": totals["in_progress"],
            "not_started": totals["not_started"],
            "total": totals["total"],
        },
        "left": left,
        "done": done_phases,
        "tasks": tasks,
        "next_phase_id": next_id,
        "summary": summary,
    }


def _overall_percent(totals: dict):
    total = totals["total"]
    if total == 0:
        return None
    raw = totals["done"] / total * 100
    remaining = 100 - raw
    if 0 < remaining < 1:
        return round(raw, 1)
    return round(raw)


def _fraction_phrase(done: int, total: int) -> str:
    if total == 0:
        return ""
    frac = done / total
    if done == 0:
        return "just getting started"
    if done == total:
        return "all done"
    if frac < 0.2:
        return "early days"
    if frac < 0.45:
        return "about a third of the way through"
    if frac < 0.55:
        return "about halfway there"
    if frac < 0.8:
        return "well over halfway"
    return "almost there"


def _overall_summary(totals: dict) -> str:
    done, total = totals["done"], totals["total"]
    if total == 0:
        return "No tasks defined yet."
    phrase = _fraction_phrase(done, total)
    bits = [f"{done} of {total} tasks done — {phrase}"]
    extra = []
    if totals["in_progress"]:
        extra.append(f"{totals['in_progress']} in progress")
    if totals["not_started"]:
        extra.append(f"{totals['not_started']} not started")
    if extra:
        bits.append(" (" + ", ".join(extra) + ")")
    return "".join(bits)


# --------------------------------------------------------------------------- #
# Today / right-now / commit hygiene
# --------------------------------------------------------------------------- #

def build_today(commits: list[dict]) -> dict:
    cutoff = _day_start_epoch()
    todays = [c for c in commits if c["epoch"] >= cutoff]
    return {
        "count": len(todays),
        "items": [
            {
                "message": c["message"],
                "iso_utc": c["iso_utc"],
                "short": c["short"],
                "file_count": c["file_count"],
            }
            for c in todays
        ],
    }


def _most_recent_change_epoch(status: list[dict]) -> float | None:
    newest = None
    for entry in status:
        p = PROJECT_ROOT / entry["path"]
        try:
            mtime = p.stat().st_mtime
        except Exception:
            continue
        if newest is None or mtime > newest:
            newest = mtime
    return newest


def build_right_now(status: list[dict], commits: list[dict], branch: str | None,
                    git_ok: bool) -> dict:
    if not git_ok:
        return {
            "active": False,
            "badge": "UNKNOWN",
            "text": "No git repository here — can't tell what's in progress.",
        }
    if not status:
        return {
            "active": False,
            "badge": "IDLE",
            "text": "Nothing in progress right now — project is idle.",
        }

    newest = _most_recent_change_epoch(status)
    now = datetime.now(timezone.utc).timestamp()
    active = newest is not None and (now - newest) <= ACTIVE_WINDOW_SECONDS

    # Group changed files by their top-level directory.
    dirs: dict[str, int] = {}
    for entry in status:
        top = entry["path"].split("/", 1)[0] if "/" in entry["path"] else "(root)"
        dirs[top] = dirs.get(top, 0) + 1
    dir_list = ", ".join(f"{n} in {d}" for d, n in sorted(dirs.items()))

    n = len(status)
    files_word = "file" if n == 1 else "files"
    if active:
        mins = max(1, round((now - newest) / 60))
        text = (
            f"Work in progress — {n} {files_word} changed, last touched "
            f"about {mins} min ago ({dir_list})."
        )
        badge = "LIVE"
    else:
        text = (
            f"{n} {files_word} changed but nothing touched in the last few "
            f"minutes ({dir_list}) — paused."
        )
        badge = "IDLE"
    return {"active": active, "badge": badge, "text": text}


def build_commit_hygiene(status: list[dict], commits: list[dict]) -> dict:
    """Plain-English save state + commit suggestions, derived from real status."""
    last_commit_iso = commits[0]["iso_utc"] if commits else None
    last_commit_epoch = commits[0]["epoch"] if commits else None

    now = datetime.now(timezone.utc).timestamp()
    gap_text = None
    if last_commit_epoch is not None:
        gap = now - last_commit_epoch
        if gap < 90:
            gap_text = "Last save was just now."
        elif gap < 3600:
            gap_text = f"Last save was {round(gap / 60)} minutes ago."
        else:
            hours = gap / 3600
            tail = " — that's a long gap." if hours >= 3 else "."
            gap_text = f"Last save was about {hours:.1f} hours ago{tail}"

    # Group uncommitted files by top-level directory with a plain description.
    groups: dict[str, dict] = {}
    for entry in status:
        path = entry["path"]
        top = path.split("/", 1)[0] if "/" in path else "(root)"
        g = groups.setdefault(top, {"dir": top, "files": [], "kinds": {}})
        g["files"].append(path)
        kind = _change_kind(entry["code"])
        g["kinds"][kind] = g["kinds"].get(kind, 0) + 1

    group_views = []
    for top, g in sorted(groups.items()):
        kind_bits = ", ".join(
            f"{c} {k}" for k, c in sorted(g["kinds"].items())
        )
        n = len(g["files"])
        files_word = "file" if n == 1 else "files"
        where = "project root" if top == "(root)" else top
        group_views.append(
            {
                "dir": top,
                "file_count": n,
                "description": f"{where}: {n} {files_word} ({kind_bits}).",
                "files": g["files"],
            }
        )

    suggestions: list[str] = []
    order: list[str] = []
    n_files = len(status)
    n_dirs = len(groups)

    if n_files == 0:
        suggestions.append("Everything's saved — nothing waiting to commit.")
    else:
        if n_dirs <= 1:
            suggestions.append(
                "Looks like one focused change — commit it as a single commit."
            )
        else:
            suggestions.append(
                f"Changes span {n_dirs} areas — consider splitting into "
                f"{n_dirs} separate commits, one per area."
            )
            for i, gv in enumerate(group_views, start=1):
                order.append(
                    f"{i}. Commit the {('project root' if gv['dir'] == '(root)' else gv['dir'])} "
                    f"changes ({gv['file_count']})."
                )
        if last_commit_epoch is not None:
            gap_hours = (now - last_commit_epoch) / 3600
            if gap_hours >= 4 and n_files >= 5:
                suggestions.append(
                    f"You haven't saved in {gap_hours:.0f} hours and {n_files} "
                    f"files are changed — consider committing now before this grows."
                )

    return {
        "last_commit_iso": last_commit_iso,
        "gap_text": gap_text,
        "groups": group_views,
        "suggestions": suggestions,
        "order": order,
        "uncommitted_count": n_files,
    }


# --------------------------------------------------------------------------- #
# Overall state badge
# --------------------------------------------------------------------------- #

def overall_badge(git_ok: bool, right_now: dict, phases: dict) -> str:
    if not git_ok:
        return "UNKNOWN"
    if right_now["badge"] == "LIVE":
        return "LIVE"
    return "IDLE"


# --------------------------------------------------------------------------- #
# Top-level state builder
# --------------------------------------------------------------------------- #

def project_name() -> str:
    # Prefer a README H1, then package.json name, else the folder name.
    readme = PROJECT_ROOT / "README.md"
    if readme.exists():
        try:
            for line in readme.read_text(encoding="utf-8", errors="replace").splitlines():
                if line.startswith("# "):
                    return line[2:].strip()
        except Exception:
            pass
    pkg = PROJECT_ROOT / "package.json"
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8", errors="replace"))
            if isinstance(data, dict) and data.get("name"):
                return str(data["name"])
        except Exception:
            pass
    return PROJECT_ROOT.name


def build_state() -> dict:
    git_ok = is_git_repo()
    commits = get_commits(50) if git_ok else []
    status = get_status() if git_ok else []
    branch = get_current_branch() if git_ok else None
    reviews = _detect_reviews()

    task_data = load_tasks()
    phases = build_phases(task_data, reviews)
    today = build_today(commits)
    right_now = build_right_now(status, commits, branch, git_ok)
    hygiene = build_commit_hygiene(status, commits)
    badge = overall_badge(git_ok, right_now, phases)

    return {
        "generated_iso_utc": datetime.now(timezone.utc).isoformat(),
        "tz": TZ_NAME,
        "day_reset": DAY_RESET,
        "project": {
            "name": project_name(),
            "root": str(PROJECT_ROOT),
            "branch": branch,
            "git": git_ok,
            "writable": (PROJECT_ROOT / "TASKS.md").exists(),
        },
        "badge": badge,
        "hero": {
            "percent": phases["overall_percent"],
            "buckets": phases["buckets"],
            "summary": phases["summary"],
            "has_tasks": phases["available"],
        },
        "phases_left": phases["left"],
        "phases_done": phases["done"],
        "board": {"tasks": phases.get("tasks", []), "next_phase_id": phases.get("next_phase_id")},
        "today": today,
        "right_now": right_now,
        "commits": [
            {
                "message": c["message"],
                "iso_utc": c["iso_utc"],
                "short": c["short"],
                "file_count": c["file_count"],
            }
            for c in commits[:10]
        ],
        "hygiene": hygiene,
    }


# --------------------------------------------------------------------------- #
# Task status write-back (the only mutating action)
# --------------------------------------------------------------------------- #

def _today_local() -> str:
    return datetime.now(timezone.utc).astimezone(_tz()).strftime("%Y-%m-%d")


def _column_map(lines: list[str]) -> tuple[dict, int]:
    """Find the table header row and return (column map, column count)."""
    for line in lines:
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells and cells[0].lower() == "id":
            return _header_cols(cells), len(cells)
    return dict(DEFAULT_COLS), 7


def set_task_fields(text: str, task_id: str, fields: dict, today: str) -> str:
    """Update one task's fields in TASKS.md text. Only columns that exist are
    written. Raises if the id isn't found."""
    lines = text.split("\n")
    cols, width = _column_map(lines)

    wanted: dict[str, str] = {}
    if "status" in fields:
        if fields["status"] not in ("done", "in-progress", "not-started"):
            raise ValueError("invalid status")
        wanted["status"] = fields["status"]
        if "done_on" in cols:
            wanted["done_on"] = today if fields["status"] == "done" else ""
    if "priority" in fields:
        wanted["priority"] = _normalize_priority(fields["priority"]) or ""
    if "due" in fields:
        wanted["due"] = (fields["due"] or "").strip()
    if "assignee" in fields:
        wanted["assignee"] = (fields["assignee"] or "").strip()
    if "labels" in fields:
        labels = fields["labels"]
        wanted["labels"] = ", ".join(labels) if isinstance(labels, list) else (labels or "").strip()

    changed = False
    for i, line in enumerate(lines):
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        if cells[0].lower() == "id":
            continue
        if all(set(c) <= {"-", ":"} for c in cells if c):
            continue
        id_idx = cols.get("id", 0)
        if (cells[id_idx] if id_idx < len(cells) else "") != str(task_id):
            continue
        while len(cells) < width:
            cells.append("")
        for field, value in wanted.items():
            idx = cols.get(field)
            if idx is None:
                continue
            if field == "done_on" and value and cells[idx]:
                continue  # keep an existing completion date
            cells[idx] = value
        lines[i] = "| " + " | ".join(cells) + " |"
        changed = True
        break
    if not changed:
        raise ValueError("task id not found: %s" % task_id)
    return "\n".join(lines)


def write_task_fields(task_id: str, fields: dict) -> None:
    """Read TASKS.md, apply the field changes, and write it back atomically."""
    path = PROJECT_ROOT / "TASKS.md"
    text = path.read_text(encoding="utf-8", errors="replace")
    updated = set_task_fields(text, task_id, fields, _today_local())
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(updated, encoding="utf-8")
    os.replace(tmp, path)


# --------------------------------------------------------------------------- #
# HTTP server
# --------------------------------------------------------------------------- #

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "ProjectDashboard/1.0"

    def _no_cache(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")

    def _send_bytes(self, body: bytes, content_type: str, code: int = 200):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._no_cache()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 (stdlib naming)
        path = self.path.split("?", 1)[0]

        if path == "/api/state":
            try:
                body = json.dumps(build_state()).encode("utf-8")
            except Exception as exc:  # never crash the page
                body = json.dumps({"error": str(exc)}).encode("utf-8")
                self._send_bytes(body, _CONTENT_TYPES[".json"], code=500)
                return
            self._send_bytes(body, _CONTENT_TYPES[".json"])
            return

        # Static files (index.html at "/").
        if path in ("/", "/index.html"):
            target = STATIC_DIR / "index.html"
        else:
            # Resolve safely within STATIC_DIR; reject traversal.
            candidate = (STATIC_DIR / path.lstrip("/")).resolve()
            if not str(candidate).startswith(str(STATIC_DIR.resolve())):
                self._send_bytes(b"forbidden", "text/plain; charset=utf-8", code=403)
                return
            target = candidate

        if not target.exists() or not target.is_file():
            self._send_bytes(b"not found", "text/plain; charset=utf-8", code=404)
            return

        ctype = _CONTENT_TYPES.get(target.suffix, "application/octet-stream")
        try:
            self._send_bytes(target.read_bytes(), ctype)
        except Exception:
            self._send_bytes(b"read error", "text/plain; charset=utf-8", code=500)

    def do_POST(self):  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path not in ("/api/task-update", "/api/task-status"):
            self._send_bytes(b"not found", "text/plain; charset=utf-8", code=404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._send_bytes(json.dumps({"error": "bad request"}).encode(),
                             _CONTENT_TYPES[".json"], code=400)
            return

        task_id = str(payload.get("id", "")).strip()
        if not task_id:
            self._send_bytes(json.dumps({"error": "Provide a task id."}).encode(),
                             _CONTENT_TYPES[".json"], code=400)
            return

        # Collect the fields to change.
        fields: dict = {}
        for f in ("status", "priority", "due", "assignee", "labels"):
            if f in payload:
                fields[f] = payload[f]
        if "status" in fields and fields["status"] not in ("done", "in-progress", "not-started"):
            self._send_bytes(json.dumps({"error": "Invalid status."}).encode(),
                             _CONTENT_TYPES[".json"], code=400)
            return
        if not fields:
            self._send_bytes(json.dumps({"error": "No fields to update."}).encode(),
                             _CONTENT_TYPES[".json"], code=400)
            return
        if not (PROJECT_ROOT / "TASKS.md").exists():
            self._send_bytes(json.dumps({"error": "No TASKS.md to update."}).encode(),
                             _CONTENT_TYPES[".json"], code=400)
            return
        try:
            write_task_fields(task_id, fields)
        except ValueError as exc:
            self._send_bytes(json.dumps({"error": str(exc)}).encode(),
                             _CONTENT_TYPES[".json"], code=404)
            return
        except Exception as exc:
            self._send_bytes(json.dumps({"error": str(exc)}).encode(),
                             _CONTENT_TYPES[".json"], code=500)
            return
        self._send_bytes(json.dumps({"ok": True}).encode(), _CONTENT_TYPES[".json"])

    def log_message(self, *args):  # keep the console quiet
        pass


def main():
    if HOST not in ("127.0.0.1", "::1", "localhost"):
        print(
            f"Refusing to bind non-loopback host {HOST!r}. "
            "This dashboard is local-only.",
            file=sys.stderr,
        )
        sys.exit(1)

    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}"
    print(f"Project dashboard for: {PROJECT_ROOT}")
    print(f"Serving on {url}  (Ctrl-C to stop)")
    print(f"Time zone: {TZ_NAME}   Day reset: {DAY_RESET} midnight")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
