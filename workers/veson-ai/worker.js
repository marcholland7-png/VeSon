// VESON AI command-bar proxy — Cloudflare Worker
//
// The dashboard is a static GitHub Pages site, so the Anthropic API key can't
// live in the browser. This Worker holds the key as a secret and proxies the
// browser's request to Claude, streaming the reply straight back.
//
// Deploy:
//   1. npm i -g wrangler   (once)
//   2. cd workers/veson-ai
//   3. wrangler login
//   4. wrangler secret put ANTHROPIC_API_KEY     (paste your key when prompted)
//   5. wrangler deploy
//   → copy the printed https://veson-ai.<you>.workers.dev URL into
//     VESON → Settings → AI Assistant.

const MODEL = 'claude-opus-4-8';   // for ~5x cheaper Q&A, swap to 'claude-haiku-4-5'
const MAX_TOKENS = 2048;

const ALLOWED_ORIGINS = [
  'https://marcholland7-png.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'null'                            // file:// origin, for local testing
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Worker is missing the ANTHROPIC_API_KEY secret.' }, 500, cors);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON in request.' }, 400, cors); }

    const messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages || !messages.length) {
      return json({ error: 'messages[] is required.' }, 400, cors);
    }

    const payload = {
      model: body.model || MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      messages
    };
    if (typeof body.system === 'string') payload.system = body.system;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      return json({ error: 'Anthropic error ' + upstream.status, detail: detail.slice(0, 500) }, 502, cors);
    }

    // Anthropic's response is already Server-Sent Events — pipe it straight through.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
  }
};
