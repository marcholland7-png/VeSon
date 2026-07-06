# Eitje → VESON hours sync (Cowork prompt)

Paste the block below into a **Claude Cowork** session on your desktop (with your Eitje browser session already logged in). Cowork will read your registered hours from Eitje and push them into the Supabase table VESON reads from.

Run it whenever you want fresh data — after a shift, or on a schedule.

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
- team   → team/employer text as shown (e.g. "De Gracht Vast (De Gracht B.V.)")

STEP 4 — Upload to Supabase.
POST this exact request (do not silently swallow errors — show me the full
response body no matter what):

- URL:    https://jmmwqqssqujsiedafqdd.supabase.co/rest/v1/eitje_data?on_conflict=code
- Method: POST
- Headers:
    apikey: sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN
    Authorization: Bearer sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN
    Content-Type: application/json
    Prefer: resolution=merge-duplicates,return=representation
- Body:
    {
      "code": "QIMC3M5I",
      "shifts": [ ...the collected list... ],
      "updated_at": "<current ISO 8601 timestamp>"
    }

Note: `return=representation` (not `return=minimal`) so the response body
shows what actually got written — paste that raw response back to me.

STEP 5 — Verify by reading it back.
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
