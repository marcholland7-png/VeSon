# Eitje → VESON hours sync (Cowork prompt)

Paste the block below into a **Claude Cowork** session on your desktop (with your Eitje browser session already logged in). Cowork will read your registered hours from Eitje and push them into the Supabase table VESON reads from.

Run it whenever you want fresh data — after a shift, or on a schedule.

**This is a fallback.** If this session has the VeSon project folder attached, `CLAUDE.md` in the repo root already has all of this context loaded automatically — you shouldn't need to paste anything, just ask in plain language (e.g. "add my worked shifts up to today into veson"). Only paste the block below if you're in a session that for some reason doesn't have this folder attached (e.g. a Dispatch chat opened fresh without the project).

**v3 (2026-07-18):** now covers both jobs. Marc works two bars:
- **Poolbar** = the Eitje-tracked job ("De Gracht Vast"), pulled automatically per the steps below.
- **Woodstock** = a second job with no scheduling app; Marc reports these shifts manually, you just need to log them with `team: "Woodstock"`.
Both pay €17.00/hr (see Eitje → Contracten → Uurloon). Each shift now carries `hours` and `pay` fields alongside date/start/end/status/team — this is the closest thing VESON has to a "finance" view, since `eitje_data` is a single jsonb column, not a separate finance table.

**v2 (2026-07-06):** the v1 prompt ran but left the `eitje_data` table completely empty (verified via direct query) — no rows at all, for any code. v2 is self-verifying: it makes Cowork narrate each step, echo the exact Supabase response, and read the row back afterward so a silent failure can't happen again. It also pins the date range to June–July 2026 instead of a vague "last ~30 days."

---

## The prompt to paste into Cowork

```
Go to https://web.eitje.app in my logged-in browser session.

STEP 1 — Navigate and narrate.
Find the page that shows my REGISTERED HOURS (uren registratie / geregistreerde
uren), not scheduled/planned shifts. Tell me exactly which menu item/URL you
landed on and describe what the page shows (columns, filters, date range
controls) before extracting anything. If you can't find a "registered" vs
"planned" distinction, tell me what tabs/filters DO exist instead of guessing.

STEP 2 — Set the date range.
Filter or scroll the view to cover 1 June 2026 through 31 July 2026 specifically
(today is 6 July 2026, so July will be partial). If the page paginates or lazy-
loads, keep scrolling/paginating until you've covered the full range — tell me
how many rows you found and the earliest/latest date among them, so I can sanity
check coverage.

STEP 3 — Extract.
For every shift row in that range, extract:
- date   → ISO format "YYYY-MM-DD"
- start  → "HH:MM" 24-hour
- end    → "HH:MM" 24-hour (may cross midnight)
- status → raw status text as shown (e.g. "in_afwachting", "goedgekeurd", "afgekeurd")
- team   → "Poolbar" (label Eitje/De Gracht shifts this way, not the raw
  Eitje team text) for shifts from this page, or "Woodstock" for any
  shifts I give you manually
- hours  → end - start as decimal, adding 24h if end < start (crosses midnight)
- hourly_rate → 17.00 (see Eitje → Contracten → Uurloon)
- pay    → hours × hourly_rate

STEP 4 — Merge, don't overwrite.
GET the current row first (`?code=eq.QIMC3M5I&select=shifts`), merge your
new/updated rows into the existing `shifts` array (dedupe on date+team,
keep everything already there — Eitje's list is a rolling window and
drops old shifts once they're approved/paid, so "not on the page anymore"
does NOT mean "delete it"), then re-sort by date before writing.

STEP 5 — Upload to Supabase.
POST this exact request (do not silently swallow errors — show me the full
response body no matter what):

- URL:    https://jmmwqqssqujsiedafqdd.supabase.co/rest/v1/eitje_data
  (do NOT add ?on_conflict=code — that param causes a 42501 row-level-security
  violation on the update path; plain POST + the Prefer header below upserts fine)
- Method: POST
- Headers:
    apikey: sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN
    Authorization: Bearer sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN
    Content-Type: application/json
    Prefer: resolution=merge-duplicates,return=representation
- Body:
    {
      "code": "QIMC3M5I",
      "shifts": [ ...the full merged list, not just new rows... ],
      "updated_at": "<current ISO 8601 timestamp>"
    }

Note: `return=representation` (not `return=minimal`) so the response body
shows what actually got written — paste that raw response back to me.

Also note: Supabase's domain is blocked by the sandbox shell's network
allowlist — run these as `fetch()` calls via the Chrome extension's
javascript_tool against an already-open tab (e.g. the Eitje tab), not via
bash/curl.

STEP 6 — Verify by reading it back.
Immediately do a GET to confirm the write really landed:

    GET https://jmmwqqssqujsiedafqdd.supabase.co/rest/v1/eitje_data?code=eq.QIMC3M5I&select=code,updated_at,shifts
    (same apikey/Authorization headers)

Tell me the exact row count and shift count this GET returns. If it's empty
or doesn't match what you just POSTed, say so explicitly and show me the raw
response — don't report success unless STEP 5 confirms it.
```

---

## When to re-run this

- After any shift you complete
- Or once a day if you'd rather batch
- VESON's card shows "Last synced: X" so you always know how fresh the data is

## When the Cowork prompt needs updating

If Eitje changes its UI (renames a section, moves the button), you may need to tweak the "navigate to the page that shows my REGISTERED HOURS" line to be more specific. Cowork adapts semantically so this is rare.
