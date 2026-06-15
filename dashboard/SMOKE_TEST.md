# Smoke Test

Run through this after starting the dashboard to confirm it's telling the truth.

Start it:

```bash
python3 dashboard/server.py
# open http://127.0.0.1:4747
```

## Checklist

- [ ] **Page loads** at http://127.0.0.1:4747 with no errors.
- [ ] **Header** shows the project name and the absolute folder path. Clicking
      the path copies it to the clipboard ("Copied ✓").
- [ ] **State badge** (top-right) is visible and shows one of
      LIVE / IDLE / UNKNOWN.
- [ ] **Big %** is a real number computed from `TASKS.md`
      (done tasks ÷ total tasks). Currently this repo seeds 13 tasks with 7
      done → **54%**. Edit a status in `TASKS.md`, refresh, and watch it change.
- [ ] **Remaining-work bar** segments (done / in-progress / not-started) match
      the percentage and the legend counts.
- [ ] **What's left**: each phase shows "Meant to build" AND "Built so far",
      a completion bar, a review badge, and an estimate (or `—`).
- [ ] **Exactly one** "Tackle this next" pink badge appears, with a tooltip
      explaining why (hover it).
- [ ] **What's done**: fully-completed phases show a green ✓ and a completion
      date. (Seed data has none fully complete yet — expect "Nothing completed
      yet" until a whole phase is done.)
- [ ] **Today's work**: the count matches commits made since your local
      midnight. Hover an item to see its short commit id.
- [ ] **Right now**: reflects reality — "in progress" when you have recent
      uncommitted changes, "idle" when the tree is clean.
- [ ] **Commits (left)**: last few commits with local-time, plain message, and
      file count. Commit id appears only on hover.
- [ ] **Not yet saved (right)**: lists your actual uncommitted changes grouped
      by directory, with commit-hygiene suggestions specific to that diff.
- [ ] **Tiles** (In progress / Blocked / Due soon / Overdue / Done %) show the
      right counts; tapping one filters the board.
- [ ] **Board** shows tasks in three columns with priority dots, due chips
      (red overdue / amber soon), labels, and assignee initials. Drag a card to
      another column → `TASKS.md` updates and "Saved ✓" appears.
- [ ] **Tap a card** → editor opens; change priority/due/assignee/labels/status,
      Save → only that `TASKS.md` row changes.
- [ ] **Search / filters / Group by phase** narrow the visible cards.
- [ ] **Footer** shows a neutral "Project Dashboard · updated …" line (no ad).

## Resilience checks

- [ ] Rename `TASKS.md` (e.g. `mv TASKS.md TASKS.bak`) and refresh — the hero
      shows "No task file yet" instead of crashing. Rename it back.
- [ ] Point the server at an empty folder
      (`PROJECT_ROOT=/tmp/empty python3 dashboard/server.py`) — the page still
      loads, badge shows UNKNOWN, cards show "no data yet".

## Verify the numbers

Look at the **big %** and **today's-work count**. Do they match what you know to
be true about the project? If not, the parsing is off — check that your
`TASKS.md` statuses are one of `done` / `in-progress` / `not-started` and that
the table header row is intact.
