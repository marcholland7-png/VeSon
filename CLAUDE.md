# VeSon — context for Claude

VeSon is Marc's personal dashboard app (static HTML/CSS/JS, see README.md).
This file is auto-loaded by Claude Code / Claude Cowork whenever a session
opens in this folder — including sessions started via **Dispatch** from
the phone — so you don't need to re-explain any of this each time.

## The Eitje → VESON hours sync

Marc bartends at two places and tracks both in a single Supabase table that
the VeSon dashboard reads from:

- **Poolbar** — his shifts at "De Gracht Vast (De Gracht B.V.)", sourced
  from Eitje (https://web.eitje.app), a Dutch shift-scheduling app he's
  already logged into in his browser.
- **Woodstock** — a second job with no scheduling app integration. Marc
  reports these shifts to Claude manually (date/start/end), usually a
  batch at a time.

Both jobs pay **€17.00/hour** (Marc's zero-hours contract rate, visible on
the Eitje "Contracten" tab as "Uurloon").

### Supabase target

```
URL:            https://jmmwqqssqujsiedafqdd.supabase.co/rest/v1/eitje_data
apikey:         sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN
Authorization:  Bearer sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN
Row key:        code = "QIMC3M5I"   (one single row holds everything)
Column:         shifts  →  jsonb array, each element:
                  { date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM" (may
                    cross midnight), status: string, team: "Poolbar" |
                    "Woodstock", hours: number, hourly_rate: 17.00,
                    pay: number (hours * hourly_rate) }
                updated_at → ISO 8601 timestamp
```

This is a plain jsonb column, not a real child table — there is no separate
"finance" table. `hours`/`pay` live inline on each shift object. If Marc
asks for a finance page, it reads off this same array. (In practice
`js/earnings.js` recomputes hours/gross/net live from `date`/`start`/`end`
and the hardcoded €17 rate rather than trusting the stored `hours`/`pay`
fields — those fields are still worth writing for other consumers, just
know the Finance page itself doesn't depend on them being present.)

### "Next shift" reads from a DIFFERENT table — don't confuse the two

The Home page's "Next shift" widget (`js/home.js` → `js/calendar.js`
`getNextShift()`) does **not** read `eitje_data`. It reads the soonest
upcoming `category: "work"` event from a separate Supabase table, `sync`
(same table + same `code` "QIMC3M5I" that the Calendar app uses), and
only falls back to Eitje data if the calendar has nothing upcoming.
`eitje_data` only ever holds past/registered hours (Eitje's "Uren
doorgeven" list doesn't include future shifts), so it can't power "next
shift" on its own — you have to also pull Marc's upcoming Poolbar shifts
from Eitje's **Rooster** (`https://web.eitje.app/planning/per_team`, NOT
the writable_hours page) and push them into `sync.events` as objects
shaped like:
```
{ id: "eitje-work-<date>", title: "Poolbar", date, endDate: null,
  allDay: false, startTime, endTime, location: "Poolbar", notes: null,
  category: "work", updatedAt: <now ISO> }
```
Dedupe by matching (date + title:"Poolbar" + category:"work") against
ANY existing event, not by id — the events array has entries from several
past id schemes (`eitje-work-<date>`, `poolbar_<random>`, imported
`imp_file_shift-*`, etc.) and matching only your own id namespace creates
silent duplicates (this happened once — two 2026-07-20 entries — fixed
2026-07-20). If a match exists, update it in place keeping its existing
id; only mint a new `eitje-work-<date>` id when nothing matches. Merge
into the existing `events` array
(`GET /rest/v1/sync?code=eq.QIMC3M5I&select=events,todos,tombstones,updated_at`
first) rather than overwriting — same full-column-replace caveat as
`eitje_data`. Never delete or "fix" other events, even odd-looking ones —
flag them instead. (There was a corrupted entry, id `wood_tjx60etshn`,
date stored as invalid string `"60707-02-20"` — deleted 2026-07-20. Its
garbage far-future date meant it always evaluated as "upcoming" no matter
the real date, so it showed up as a permanently-stuck Woodstock shift on
the calendar's Upcoming views. Neither Marc nor Claude could recover what
shift it was meant to represent, so it was removed outright rather than
guessed at. If something similar happens again, check for `date` values
that don't match `^\d{4}-\d{2}-\d{2}$` — VeSon's date logic assumes
well-formed ISO dates and doesn't validate them.)

**Update 2026-07-20:** `js/calendar.js` now guards this itself. It has an
`isValidDate()` helper (the `^\d{4}-\d{2}-\d{2}$` regex), and `loadLocal()`
runs `purgeInvalidEvents()` which drops any event with a missing/malformed
`date`, tombstones it, and pushes that tombstone to Supabase on the next
sync (via `flushPurge()` after `pullSync`). `getNextShift`, `getSnapshot`
and `eventSpansDate` also skip such events defensively. So a dateless/garbage
`date` shift can no longer get stuck as a phantom "next shift"/"upcoming"
entry — it's auto-removed locally and remotely. This is a targeted purge of
*structurally invalid* dates only; it does NOT touch odd-but-valid events,
so the "flag, don't delete" rule above still stands for everything else.

**Also important:** the VeSon web page itself computes "today" once at
page load and never re-checks it — if the dashboard tab has been open for
days, "Next shift" can silently show a stale answer even though the
underlying Supabase data is fresh. If Marc reports "next shift" looks
wrong, check the data first (it's probably fine) and tell him to reload
the tab before assuming it's a sync bug.

### Daily automation

A scheduled task `veson-daily-refresh` (Claude Scheduled tasks, runs
~11am daily) handles both of the above automatically for Poolbar:
merges freshly-scraped worked hours into `eitje_data` (Finance) and the
next upcoming Rooster shift into `sync.events` (Next Shift widget). It
cannot touch Woodstock — no scheduling app to scrape, Marc still reports
those shifts manually in chat. See
`C:\Users\march\Claude\Scheduled\veson-daily-refresh\SKILL.md` for the
exact prompt if it needs tweaking.

**Note:** `eitje_data` was created ad hoc directly in Supabase and is NOT
part of the tracked schema in `supabase/migrations/0001_init.sql` (that
migration is for VeSon's own task/workspace system and has nothing to do
with hours tracking). Don't assume `eitje_data` follows the same RLS model
as the rest of the app.

### How to sync (do this whenever Marc asks to "add shifts to VESON")

1. **Poolbar/Eitje shifts:** open `https://web.eitje.app/users/75468/writable_hours`
   (nav: Uren → Mijn uren, sidebar: "Uren doorgeven") in the logged-in
   browser session. This page lists the ~25 most recent shifts needing
   hour registration — no date filter exists, it's a flat rolling list.
   Scroll/read the full table (get_page_text may need a scroll to render
   all rows). Extract date/start/end/status/team per row.
2. Compute `hours` = end âˆ' start as decimal, **adding 24h if end < start**
   (shifts cross midnight, e.g. 19:00â†'01:30 = 6.5h). Compute
   `pay = hours Ã— 17.00`.
3. **Woodstock shifts:** Marc will paste these manually (a table of
   date/time range/duration/earnings from memory or another app). Trust
   his stated hours/earnings if given; otherwise compute the same way.
   Label `team: "Woodstock"`.
4. Fetch the current row's `shifts` array first (GET), merge in only the
   new/changed entries (dedupe on date+team), re-sort by date, then POST
   the full array back — this is a full-column replace, not a per-row
   upsert, so always merge client-side before writing.
5. **POST config that actually works:**
   `POST /rest/v1/eitje_data` (no `?on_conflict=code` query param),
   headers `Prefer: resolution=merge-duplicates,return=representation`.
   Adding `?on_conflict=code` was tried once and hit
   `42501 row violates row-level security policy` on the UPDATE path —
   the plain POST without that param works fine as an upsert against the
   existing row. If you hit 42501 again, don't paper over it — show Marc
   the raw response.
6. **Always verify with a follow-up GET** on
   `?code=eq.QIMC3M5I&select=shifts,updated_at` and report the real row/shift
   count back. Never claim success without this check — an early attempt
   silently produced an empty table.
7. Browser network calls (not the sandbox shell — Supabase's domain is
   blocked by the sandbox's proxy allowlist) must go through
   `mcp__claude-in-chrome__javascript_tool` running `fetch()` in a page
   already open in the Chrome extension (e.g. the Eitje tab), since that
   uses the real network instead of the sandboxed one.

### Historical gotchas (don't repeat these)

- First sync attempt (2026-07-06, v1 prompt) silently left the table
  completely empty — always verify with GET, never trust a 2xx alone.
- `?on_conflict=code` → 42501 RLS violation on update (see above). Use
  plain POST + merge-duplicates instead.
- The Eitje "Uren doorgeven" list is a rolling window — old shifts drop
  off once approved/paid. Don't treat "not in the current Eitje list" as
  "never happened" — always merge with what's already in Supabase rather
  than overwriting.
- Dates on the Eitje page are Dutch ("mei"=May, "jun"=June, "jul"=July)
  and year-less in the visible text except a trailing `'26` — confirm the
  year (2026) rather than assuming.

See `EITJE_COWORK_PROMPT.md` for the original standalone prompt version of
this workflow (useful as a copy-paste fallback if this file somehow isn't
loaded in a session — e.g. a Dispatch chat that wasn't opened against this
project folder).
