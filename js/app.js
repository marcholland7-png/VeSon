(function () {
  'use strict';

  var THEME_KEY = 'veson_theme';
  var SYNC_KEY = 'veson_sync_code';

  // Same Supabase project the calendar app syncs through. The key is the
  // project's public/anon "publishable" key (not a secret) — it's already
  // exposed client-side in that app's own source, so reusing it here for
  // read-only lookups by sync code carries no additional exposure.
  var SUPABASE_URL = 'https://jmmwqqssqujsiedafqdd.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN';

  /* ── Theme ── */
  function applyTheme(theme) {
    document.body.classList.toggle('light', theme === 'light');
    var label = document.getElementById('themeToggleLabel');
    if (label) label.textContent = theme === 'light' ? 'Dark Mode' : 'Light Mode';
  }

  function initTheme() {
    var saved = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(saved);
    var btn = document.getElementById('themeToggle');
    btn.addEventListener('click', function () {
      var current = document.body.classList.contains('light') ? 'light' : 'dark';
      var next = current === 'light' ? 'dark' : 'light';
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });
  }

  /* ── Greeting + clock ── */
  function tick() {
    var now = new Date();
    var hour = now.getHours();
    var period = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    var greeting = document.getElementById('greeting');
    if (greeting) greeting.textContent = 'Good ' + period + ', Marc';

    var timeEl = document.getElementById('clockTime');
    var dateEl = document.getElementById('clockDate');
    if (timeEl) timeEl.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (dateEl) dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }

  /* ── View routing (side nav + any [data-view] trigger) ── */
  function setView(view) {
    document.querySelectorAll('.nav-item[data-view]').forEach(function (item) {
      item.classList.toggle('active', item.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(function (section) {
      section.classList.toggle('active', section.id === 'view-' + view);
    });
  }

  function initRouting() {
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-view]');
      if (trigger) setView(trigger.dataset.view);
    });
  }

  /* ── Calendar sync ── */
  function parseDate(s) {
    var parts = s.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function eventCoversToday(ev, today) {
    var start = parseDate(ev.date);
    var end = ev.endDate ? parseDate(ev.endDate) : start;
    return today >= start && today <= end;
  }

  function fetchTodayEvents(code) {
    var url = SUPABASE_URL + '/rest/v1/sync?code=eq.' + encodeURIComponent(code) + '&select=events';
    return fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
      },
    }).then(function (res) {
      if (!res.ok) throw new Error('Sync request failed: ' + res.status);
      return res.json();
    }).then(function (rows) {
      if (!rows.length) return [];
      var events = rows[0].events || [];
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      return events
        .filter(function (ev) { return eventCoversToday(ev, today); })
        .sort(function (a, b) {
          return (a.startTime || '00:00').localeCompare(b.startTime || '00:00');
        });
    });
  }

  function renderEventsBody(children) {
    var body = document.getElementById('eventsBody');
    body.innerHTML = '';
    children.forEach(function (child) { body.appendChild(child); });
  }

  function textNode(tag, className, text) {
    var el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  }

  function renderNoCode() {
    var p = document.createElement('p');
    p.className = 'empty-state';
    p.appendChild(document.createTextNode('No sync code set yet.'));
    p.appendChild(document.createElement('br'));
    var link = document.createElement('span');
    link.className = 'link-btn';
    link.dataset.view = 'settings';
    link.textContent = 'Go to Settings →';
    p.appendChild(link);
    renderEventsBody([p]);
  }

  function renderLoading() {
    renderEventsBody([textNode('p', 'empty-state', 'Loading events…')]);
  }

  function renderError() {
    renderEventsBody([textNode('p', 'empty-state', "Couldn't reach the sync service. Try again shortly.")]);
  }

  function renderEvents(events) {
    if (!events.length) {
      renderEventsBody([textNode('p', 'empty-state', 'No events today.')]);
      return;
    }
    var rows = events.map(function (ev) {
      var row = document.createElement('div');
      row.className = 'event-row';
      row.appendChild(textNode('span', 'event-time', ev.allDay ? 'All day' : (ev.startTime || '')));
      row.appendChild(textNode('span', 'event-title', ev.title || '(untitled event)'));
      return row;
    });
    renderEventsBody(rows);
  }

  function loadTodayEvents() {
    var code = localStorage.getItem(SYNC_KEY);
    if (!code) { renderNoCode(); return; }
    renderLoading();
    fetchTodayEvents(code).then(renderEvents).catch(renderError);
  }

  /* ── Settings ── */
  function updateSyncStatus(connected) {
    var status = document.getElementById('syncStatus');
    if (connected) {
      status.textContent = '● Connected';
      status.className = 'sync-status ok';
    } else {
      status.textContent = '○ Not connected';
      status.className = 'sync-status';
    }
  }

  function initSettings() {
    var input = document.getElementById('syncCodeInput');
    var saveBtn = document.getElementById('saveSyncBtn');
    var saved = localStorage.getItem(SYNC_KEY);
    if (saved) { input.value = saved; }
    updateSyncStatus(!!saved);

    function save() {
      var code = input.value.trim().toUpperCase();
      if (code) {
        localStorage.setItem(SYNC_KEY, code);
        updateSyncStatus(true);
      } else {
        localStorage.removeItem(SYNC_KEY);
        updateSyncStatus(false);
      }
      loadTodayEvents();
    }

    saveBtn.addEventListener('click', save);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') save();
    });
  }

  /* ── Command bar (visual only — no functionality yet) ── */
  function initCommandBar() {
    var input = document.getElementById('commandInput');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') e.preventDefault();
    });
  }

  /* ── Init ── */
  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initRouting();
    initSettings();
    initCommandBar();
    tick();
    setInterval(tick, 30000);
    loadTodayEvents();
  });
})();
