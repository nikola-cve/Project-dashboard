# PRD — Project Dashboard / Command Center

## Problem
A builder using LLMs needs to know, at a glance, the true state of a project —
what's done, what's next, what's risky — without scrolling logs or asking.

## Users
Solo / small-team builders driving work through Claude Code, often from a phone.

## Requirements
- **Truthful progress**: a big % computed from a real source (`TASKS.md`).
- **Manage work**: an editable Kanban board (status/priority/due/assignee/labels)
  that writes back.
- **Memory**: persistent session logs, handoffs, decisions, and specs.
- **Awareness**: activity feed, risk/quality, deploys, alerts.
- **Reach**: usable from a phone, behind a login, read from GitHub.

## Success
The user opens the Overview and immediately knows the project's status, the last
thing that happened, and the next thing to do.
