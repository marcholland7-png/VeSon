# VESON AI Worker

Cloudflare Worker that proxies the browser command bar to the Anthropic API,
keeping the API key off the public GitHub Pages site.

## One-time deploy

```bash
npm install -g wrangler          # if you don't have it
cd workers/veson-ai
wrangler login                   # opens browser, log into your Cloudflare account
wrangler secret put ANTHROPIC_API_KEY   # paste your Anthropic key when prompted
wrangler deploy
```

Wrangler prints a URL like `https://veson-ai.<your-subdomain>.workers.dev`.

## Wire it into VESON

Open the site → **Settings → AI Assistant** → paste that Worker URL → **Save**.
The command bar at the bottom is now live.

## Config

Edit `worker.js`:

- `MODEL` — defaults to `claude-opus-4-8`. Swap to `claude-haiku-4-5` for
  roughly 5× cheaper Q&A over your own data.
- `ALLOWED_ORIGINS` — the sites allowed to call this Worker (so nobody else can
  spend your key). Already includes the GitHub Pages URL and localhost.

Re-run `wrangler deploy` after any edit.

## Cost

Only your own requests hit it. Opus 4.8 is ~$5 / $25 per million input/output
tokens; a typical "what am I earning this month?" round-trip is a few thousand
tokens. Haiku 4.5 is ~5× cheaper if you want to keep it minimal.
