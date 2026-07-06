# Eitje → VESON hours sync (Cowork prompt)

Paste the block below into a **Claude Cowork** session on your desktop (with your Eitje browser session already logged in). Cowork will read your registered hours from Eitje and push them into the Supabase table VESON reads from.

Run it whenever you want fresh data — after a shift, or on a schedule.

---

## The prompt to paste into Cowork

```
Go to https://web.eitje.app in my logged-in browser session. Navigate to the
page that shows my REGISTERED HOURS (uren registratie / geregistreerde uren) —
NOT just scheduled/planned shifts. If Eitje has separate tabs for "planned"
vs "registered/submitted/approved", pick registered.

For every visible shift row, extract:
- date         → ISO format "YYYY-MM-DD"
- start        → "HH:MM" 24-hour
- end          → "HH:MM" 24-hour (may cross midnight)
- status       → the raw status text as shown (e.g. "in_afwachting", "goedgekeurd", "afgekeurd")
- team         → the team/employer text as shown (e.g. "De Gracht Vast (De Gracht B.V.)")

Scroll to load all visible rows (typically last ~30 days plus upcoming).

Then upsert the collected list into Supabase:
- URL:   https://jmmwqqssqujsiedafqdd.supabase.co/rest/v1/eitje_data
- Auth:  header  apikey: sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN
         header  Authorization: Bearer sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN
         header  Content-Type: application/json
         header  Prefer: resolution=merge-duplicates,return=minimal
- Body:  {
           "code": "QIMC3M5I",
           "shifts": [ ...the collected list... ],
           "updated_at": "<current ISO timestamp>"
         }
- Method: POST (Supabase upserts via POST with Prefer: resolution=merge-duplicates)

If the request returns 2xx, tell me "Synced N shifts to VESON, updated at <ts>."
If it fails, show me the response body so I can debug.
```

---

## When to re-run this

- After any shift you complete
- Or once a day if you'd rather batch
- VESON's card shows "Last synced: X" so you always know how fresh the data is

## When the Cowork prompt needs updating

If Eitje changes its UI (renames a section, moves the button), you may need to tweak the "navigate to the page that shows my REGISTERED HOURS" line to be more specific. Cowork adapts semantically so this is rare.
