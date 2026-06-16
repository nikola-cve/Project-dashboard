# 0001 — Tabbed command center over a single long page

## Context
The dashboard grew from a simple progress view into a board plus analytics, and
the user wants a detailed "mission control." A single scrolling page made the
most important glance (status, alerts, last session) hard to find, and loading
every module on every poll wasted GitHub API calls.

## Decision
Restructure into tabs — **Overview · Board · Memory · Activity · Risk · Fleet** —
where the Overview is the at-a-glance mission control and only the active tab
fetches/polls its own endpoint.

## Consequences
- Lower, predictable GitHub API usage (one module at a time).
- Each module is a localized, independently testable endpoint + view.
- Memory/specs/risk data must live in the repo (markdown/JSON) so the cloud can
  read it — which also doubles as durable project memory.
