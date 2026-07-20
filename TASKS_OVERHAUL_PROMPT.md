# Tasks page overhaul (Claude Code prompt)

Paste the block below into Claude Code, run from the VeSon project root
(`C:\Users\march\VeSon`).

---

I want to make the Tasks page (`js/tasks.js`, view `#view-tasks` in
`index.html`, styles in `css/style.css`) actually usable day to day.
Read `js/tasks.js` fully first — there's already a decent data model
(projects, priority, doDate/dueDate, order, localStorage-backed via
`veson_tasks_v1` / `veson_projects_v1`), so build on it rather than
rewriting from scratch. `js/home.js` already pulls a "focus" list from
`VesonTasks.getBriefing()` into the `#homeFocus` element on the Home
page — extend that read model, don't replace it.

## 1. Delete projects

There's currently `addProject()` (a `prompt()` for a name) but no way to
remove one. Add a delete action on each project row in `#tkProjects`
(e.g. a small trash icon on hover, matching the existing `I.trash` SVG
used for task rows). On delete:
- Confirm first (`confirm()` is fine, matches existing style in
  `deleteEvent()` in calendar.js).
- Don't delete the project's tasks — unassign them (`projectId = null`)
  so they fall back to the unfiled/no-project bucket instead of
  vanishing. Ask me if you think cascade-delete is better; my instinct
  is unassign is safer.

## 2. Edit an existing task (this is the main gap)

Right now the only way to set a date/priority/project is the quick-add
text parser at creation time (`parse()` — `!priority`, `#tag`,
`today`/`tomorrow`/`next week`), and after that the only edit available
is "snooze" (push doDate +1 day) or delete. There's no way to:
- change a task's title after creating it
- pick an arbitrary due date or do-date (only relative NL phrases work,
  and only at creation)
- move a task to a different project after the fact
- change priority after the fact

Add a proper edit affordance — clicking a task row (not its checkbox or
action buttons) should open an edit modal/panel with real form fields:
title (text), project (select, populated from `projects`, including a
"No project" option), priority (the existing `PRIOS` list as a
button-group like the calendar's category pills in `#efCatPills` —
match that visual pattern for consistency), do date (native
`<input type="date">`), due date (same). Save writes back to the task
object and calls `save(); render();` like the existing actions do.

## 3. Organize / reorder tasks

The task schema already has an `order` field (`Date.now() + Math.random()`
at creation) but nothing lets the user actually reorder. Add drag-to-reorder
within a list (Today / Upcoming / a project view) — look at how
`calendar.js` already does drag-and-drop for rescheduling events
(`pointerdown`/`pointermove`/`pointerup` handlers around `.cal-chip`,
search `drag = {` in that file) and reuse the same approach for `.tk-task`
rows instead of introducing a new drag library. Update `order` on drop and
re-render.

## 4. Get tasks to actually show up on Home

`VesonTasks.getBriefing()` currently only surfaces `overdue().concat(todayList())`
— so a task due in 3 days is invisible on Home until the day it's due,
which is the main reason this has felt broken. Change the focus pool to
also include tasks with a `doDate` or `dueDate` within the next 3 days
(not just exactly today), still capped at 5, still smart-sorted by
`focusScore()` (which already weights near deadlines higher — you may
just need to loosen the pool, not the ranking). Keep the "You're clear
for today" empty state behavior when the pool is genuinely empty.

## General

- Match the existing vanilla-JS module pattern (IIFE + `window.VesonTasks`
  public API) — don't introduce a framework or build step, this is a
  static site with no bundler (see README.md).
- Match existing visual language: `.tk-*` class prefix, SVG icons inline
  like the `I` object at the top of `tasks.js`, same modal/overlay pattern
  as the quick-add (`#tkQaOverlay`) or the calendar's event modal.
- After each change, open `index.html` locally and click through Today /
  Upcoming / Overdue / a project, adding/editing/deleting a task and a
  project, to confirm nothing broke — there's no test suite here, manual
  click-through is the check.
