/* VESON AI command bar — talks to the Cloudflare Worker (js/../workers/veson-ai),
 * which holds the Anthropic key. Gathers a compact snapshot of earnings +
 * calendar as context so Claude can answer questions about Marc's own data. */
(function () {
  'use strict';

  var WORKER_URL_KEY = 'veson_ai_worker_url';
  var MAX_HISTORY = 12; // messages kept for multi-turn context

  var history = [];
  var busy = false;

  function workerUrl() { return (localStorage.getItem(WORKER_URL_KEY) || '').trim(); }

  /* ── Context assembly ── */
  function gatherContext() {
    var cal = (window.VesonCalendar && window.VesonCalendar.getSnapshot)
      ? window.VesonCalendar.getSnapshot() : [];
    var earnP = (window.VesonEarnings && window.VesonEarnings.getSnapshot)
      ? window.VesonEarnings.getSnapshot() : Promise.resolve(null);
    return Promise.resolve(earnP).then(function (earn) {
      return { earnings: earn, calendar: cal, now: new Date().toString() };
    });
  }

  function buildSystemPrompt(ctx) {
    var L = [];
    L.push('You are VESON, Marc\'s personal command-center assistant. Marc is a');
    L.push('bartender in the Netherlands. Answer in plain, concise English.');
    L.push('Use ONLY the data below — if something is not in it, say you don\'t');
    L.push('have that yet. Amounts are euros; "net" is take-home after deductions.');
    L.push('');
    L.push('Current date/time: ' + ctx.now);

    var e = ctx.earnings;
    L.push('');
    L.push('## Earnings (from Eitje shift sync)');
    if (!e || !e.hasCode) {
      L.push('No sync code set, so no earnings data is available.');
    } else if (e.error) {
      L.push('Earnings data could not be loaded right now.');
    } else {
      if (e.jobs && e.jobs.length) {
        L.push('Jobs: ' + e.jobs.map(function (j) {
          return j.name + ' (€' + j.hourlyRate + '/hr, team "' + j.team + '")';
        }).join('; '));
      }
      L.push('This month: ' + e.month.hours + ' hrs, €' + e.month.gross + ' gross, €' + e.month.net + ' net.');
      L.push('Year to date: ' + e.ytd.hours + ' hrs, €' + e.ytd.gross + ' gross, €' + e.ytd.net + ' net.');
      L.push('Today: ' + (e.today ? (e.today.start + '–' + e.today.end) : 'no shift.'));
      if (e.upcoming && e.upcoming.length) {
        L.push('Upcoming shifts:');
        e.upcoming.forEach(function (s) {
          L.push('  - ' + s.date + ' ' + s.start + '–' + s.end + ' (' + s.hours + 'h, ' + s.job + ')');
        });
      }
      if (e.updatedAt) L.push('Shift data last synced: ' + e.updatedAt);
    }

    L.push('');
    L.push('## Upcoming calendar (next ~3 weeks)');
    if (!ctx.calendar || !ctx.calendar.length) {
      L.push('No upcoming events.');
    } else {
      ctx.calendar.forEach(function (ev) {
        L.push('  - ' + ev.date + ' ' + (ev.time || '') + '  ' + ev.title + ' [' + ev.category + ']');
      });
    }
    return L.join('\n');
  }

  /* ── Rendering ── */
  function panel() { return document.getElementById('aiPanel'); }
  function messagesEl() { return document.getElementById('aiMessages'); }

  function showPanel() {
    var p = panel();
    if (p) p.hidden = false;
  }
  function hidePanel() {
    var p = panel();
    if (p) p.hidden = true;
  }
  function scrollDown() {
    var m = messagesEl();
    if (m) m.scrollTop = m.scrollHeight;
  }

  function addBubble(role, text) {
    var m = messagesEl();
    var row = document.createElement('div');
    row.className = 'ai-msg ai-msg-' + role;
    var bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    if (text === null) {
      bubble.innerHTML = '<span class="ai-typing"><i></i><i></i><i></i></span>';
    } else {
      bubble.textContent = text;
    }
    row.appendChild(bubble);
    m.appendChild(row);
    scrollDown();
    return bubble;
  }

  /* ── SSE streaming from the Worker ── */
  function streamChat(url, system, msgs, onText, onDone, onError) {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: system, messages: msgs })
    }).then(function (res) {
      if (!res.ok || !res.body) {
        return res.text().then(function (t) {
          var msg = 'Request failed (' + res.status + ').';
          try { var j = JSON.parse(t); if (j.error) msg = j.error; } catch (e) {}
          onError(msg);
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { onDone(); return; }
          buffer += decoder.decode(r.value, { stream: true });
          var blocks = buffer.split('\n\n');
          buffer = blocks.pop();
          blocks.forEach(function (block) {
            var data = block.split('\n')
              .filter(function (l) { return l.indexOf('data:') === 0; })
              .map(function (l) { return l.slice(5).trim(); })
              .join('');
            if (!data) return;
            var evt;
            try { evt = JSON.parse(data); } catch (e) { return; }
            if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
              onText(evt.delta.text);
            } else if (evt.type === 'error') {
              onError((evt.error && evt.error.message) || 'Stream error.');
            }
          });
          return pump();
        });
      }
      return pump();
    }).catch(function () {
      onError('Could not reach the AI Worker. Check the URL in Settings and that it\'s deployed.');
    });
  }

  /* ── Submit flow ── */
  function send(text) {
    if (busy) return;
    var url = workerUrl();
    addBubble('user', text);
    history.push({ role: 'user', content: text });
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    showPanel();

    if (!url) {
      addBubble('assistant', 'Set your AI Worker URL first: Settings → AI Assistant. (See workers/veson-ai/README.md to deploy it.)');
      return;
    }

    busy = true;
    var bubble = addBubble('assistant', null); // typing indicator
    var acc = '';

    gatherContext().then(function (ctx) {
      var system = buildSystemPrompt(ctx);
      streamChat(url, system, history.slice(),
        function onText(t) {
          acc += t;
          bubble.textContent = acc;
          scrollDown();
        },
        function onDone() {
          busy = false;
          if (!acc) bubble.textContent = '(no response)';
          else history.push({ role: 'assistant', content: acc });
          if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
        },
        function onError(msg) {
          busy = false;
          bubble.classList.add('ai-error');
          bubble.textContent = msg;
        }
      );
    });
  }

  /* ── Settings: Worker URL ── */
  function initSettings() {
    var input = document.getElementById('aiWorkerInput');
    var saveBtn = document.getElementById('aiWorkerSaveBtn');
    var status = document.getElementById('aiWorkerStatus');
    if (!input || !saveBtn) return;

    function refreshStatus() {
      var url = workerUrl();
      if (url) {
        status.textContent = '● Connected';
        status.className = 'sync-status ok';
      } else {
        status.textContent = '○ Not set';
        status.className = 'sync-status';
      }
    }
    input.value = workerUrl();
    refreshStatus();

    function save() {
      var v = input.value.trim();
      if (v) localStorage.setItem(WORKER_URL_KEY, v);
      else localStorage.removeItem(WORKER_URL_KEY);
      refreshStatus();
    }
    saveBtn.addEventListener('click', save);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
  }

  /* ── Init ── */
  document.addEventListener('DOMContentLoaded', function () {
    var input = document.getElementById('commandInput');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var text = input.value.trim();
        if (!text) return;
        input.value = '';
        send(text);
      });
    }
    var closeBtn = document.getElementById('aiPanelClose');
    if (closeBtn) closeBtn.addEventListener('click', hidePanel);

    initSettings();
  });
})();
