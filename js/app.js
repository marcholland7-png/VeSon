(function () {
  'use strict';

  var THEME_KEY = 'veson_theme';
  var SYNC_KEY = 'veson_sync_code';
  var LAYOUT_KEY = 'veson_layout_v1';

  // Same Supabase project the calendar app syncs through. The key is the
  // project's public/anon "publishable" key (not a secret) — it's already
  // exposed client-side in that app's own source, so reusing it here for
  // read-only lookups by sync code carries no additional exposure.
  var SUPABASE_URL = 'https://jmmwqqssqujsiedafqdd.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN';

  // 'loading' | 'ready' | 'error' | 'nocode'
  var eventsState = 'nocode';
  var allEvents = [];
  var calMonth = startOfMonth(new Date());
  var selectedDate = startOfDay(new Date());

  /* ── Theme ── */
  function applyTheme(theme) {
    document.body.classList.toggle('light', theme === 'light');
    var label = document.getElementById('themeToggleLabel');
    if (label) label.textContent = theme === 'light' ? 'Dark Mode' : 'Light Mode';
  }

  function initTheme() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
    document.getElementById('themeToggle').addEventListener('click', function () {
      var next = document.body.classList.contains('light') ? 'dark' : 'light';
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });
  }

  /* ── Greeting + clock ── */
  function tick() {
    var now = new Date();
    var hour = now.getHours();
    var period = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    document.getElementById('greeting').textContent = 'Good ' + period + ', Marc';
    document.getElementById('clockTime').textContent =
      now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    document.getElementById('clockDate').textContent =
      now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }

  /* ── View routing (top tabs, rail, any [data-view] trigger) ── */
  function setView(view) {
    document.querySelectorAll('.nav-trigger[data-view]').forEach(function (item) {
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

  /* ── Date helpers ── */
  function startOfDay(d) {
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }
  function parseDate(s) {
    var parts = s.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function fmtDate(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function eventCoversDate(ev, day) {
    if (!ev.date) return false;
    var start = parseDate(ev.date);
    var end = ev.endDate ? parseDate(ev.endDate) : start;
    return day >= start && day <= end;
  }
  function eventsForDate(day) {
    return allEvents
      .filter(function (ev) { return eventCoversDate(ev, day); })
      .sort(function (a, b) {
        return (a.startTime || '00:00').localeCompare(b.startTime || '00:00');
      });
  }

  /* ── Sync fetch ── */
  function fetchAllEvents(code) {
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
      return rows.length ? (rows[0].events || []) : [];
    });
  }

  function loadEvents() {
    var code = localStorage.getItem(SYNC_KEY);
    if (!code) {
      eventsState = 'nocode';
      allEvents = [];
      renderAll();
      return;
    }
    eventsState = 'loading';
    renderAll();
    fetchAllEvents(code).then(function (events) {
      allEvents = events;
      eventsState = 'ready';
      renderAll();
    }).catch(function () {
      eventsState = 'error';
      renderAll();
    });
  }

  function renderAll() {
    renderHomeEvents();
    renderCalendar();
    renderDayEvents();
  }

  /* ── Shared render helpers ── */
  function textNode(tag, className, text) {
    var el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  }

  function noCodeMessage() {
    var p = document.createElement('p');
    p.className = 'empty-state';
    p.appendChild(document.createTextNode('No sync code set yet.'));
    p.appendChild(document.createElement('br'));
    var link = document.createElement('span');
    link.className = 'link-btn';
    link.dataset.view = 'settings';
    link.textContent = 'Go to Settings →';
    p.appendChild(link);
    return p;
  }

  function stateMessage() {
    if (eventsState === 'nocode') return noCodeMessage();
    if (eventsState === 'loading') return textNode('p', 'empty-state', 'Loading events…');
    if (eventsState === 'error') return textNode('p', 'empty-state', "Couldn't reach the sync service. Try again shortly.");
    return null;
  }

  function eventRow(ev) {
    var row = document.createElement('div');
    row.className = 'event-row';
    row.appendChild(textNode('span', 'event-time', ev.allDay ? 'All day' : (ev.startTime || '')));
    row.appendChild(textNode('span', 'event-title', ev.title || '(untitled event)'));
    return row;
  }

  function fillBody(body, children) {
    body.innerHTML = '';
    children.forEach(function (child) { body.appendChild(child); });
  }

  /* ── Home: today's events ── */
  function renderHomeEvents() {
    var body = document.getElementById('eventsBody');
    var msg = stateMessage();
    if (msg) { fillBody(body, [msg]); return; }
    var todays = eventsForDate(startOfDay(new Date()));
    if (!todays.length) {
      fillBody(body, [textNode('p', 'empty-state', 'No events today.')]);
      return;
    }
    fillBody(body, todays.map(eventRow));
  }

  /* ── Calendar view ── */
  function renderCalendar() {
    var grid = document.getElementById('calGrid');
    var title = document.getElementById('calTitle');
    title.textContent = calMonth.toLocaleDateString([], { month: 'long', year: 'numeric' });

    grid.innerHTML = '';
    var today = startOfDay(new Date());
    var firstWeekday = (calMonth.getDay() + 6) % 7; // Monday-based
    var daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();

    for (var i = 0; i < firstWeekday; i++) {
      grid.appendChild(textNode('div', 'cal-cell blank', ''));
    }
    for (var day = 1; day <= daysInMonth; day++) {
      var date = new Date(calMonth.getFullYear(), calMonth.getMonth(), day);
      var cell = document.createElement('div');
      cell.className = 'cal-cell';
      if (isSameDay(date, today)) cell.classList.add('today');
      if (isSameDay(date, selectedDate)) cell.classList.add('selected');
      cell.dataset.date = fmtDate(date);
      cell.appendChild(textNode('span', 'cal-daynum', String(day)));

      var count = eventsState === 'ready' ? eventsForDate(date).length : 0;
      if (count) {
        var dots = document.createElement('div');
        dots.className = 'cal-dots';
        for (var d = 0; d < Math.min(count, 3); d++) {
          dots.appendChild(textNode('span', 'cal-dot', ''));
        }
        cell.appendChild(dots);
      }
      grid.appendChild(cell);
    }
  }

  function renderDayEvents() {
    var title = document.getElementById('calDayTitle');
    var body = document.getElementById('calDayBody');
    var today = startOfDay(new Date());
    title.textContent = isSameDay(selectedDate, today)
      ? 'Today'
      : selectedDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

    var msg = stateMessage();
    if (msg) { fillBody(body, [msg]); return; }
    var dayEvents = eventsForDate(selectedDate);
    if (!dayEvents.length) {
      fillBody(body, [textNode('p', 'empty-state', 'No events this day.')]);
      return;
    }
    fillBody(body, dayEvents.map(eventRow));
  }

  function initCalendar() {
    document.getElementById('calPrev').addEventListener('click', function () {
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    document.getElementById('calNext').addEventListener('click', function () {
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    document.getElementById('calGrid').addEventListener('click', function (e) {
      var cell = e.target.closest('.cal-cell');
      if (!cell || cell.classList.contains('blank')) return;
      selectedDate = parseDate(cell.dataset.date);
      renderCalendar();
      renderDayEvents();
    });
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
      loadEvents();
      if (window.VesonEarnings) {
        window.VesonEarnings.init();
        window.VesonEarnings.initHoursPage();
      }
    }

    saveBtn.addEventListener('click', save);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') save();
    });

    document.getElementById('resetLayoutBtn').addEventListener('click', resetLayout);
  }

  /* ── Draggable dashboard cards ── */
  function dragEnabled() {
    return window.innerWidth > 1100;
  }

  function saveLayout() {
    var canvas = document.getElementById('dashCanvas');
    var layout = {};
    canvas.querySelectorAll('.dash-card').forEach(function (card) {
      layout[card.dataset.card] = {
        left: (card.offsetLeft / canvas.clientWidth) * 100,
        top: (card.offsetTop / canvas.clientHeight) * 100,
      };
    });
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  }

  function applyLayout() {
    var canvas = document.getElementById('dashCanvas');
    var raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return;
    var layout;
    try { layout = JSON.parse(raw); } catch (e) { return; }
    Object.keys(layout).forEach(function (id) {
      var card = canvas.querySelector('[data-card="' + id + '"]');
      if (!card || typeof layout[id].left !== 'number') return;
      card.style.left = layout[id].left + '%';
      card.style.top = layout[id].top + '%';
      card.style.right = 'auto';
    });
  }

  function resetLayout() {
    localStorage.removeItem(LAYOUT_KEY);
    document.querySelectorAll('.dash-card').forEach(function (card) {
      card.style.left = '';
      card.style.top = '';
      card.style.right = '';
    });
  }

  function initDrag() {
    var canvas = document.getElementById('dashCanvas');
    var drag = null;

    canvas.addEventListener('pointerdown', function (e) {
      if (!dragEnabled()) return;
      var card = e.target.closest('.dash-card');
      if (!card) return;
      // Let interactive elements work normally
      if (e.target.closest('button, input, [data-view], .link-btn')) return;
      drag = {
        card: card,
        dx: e.clientX - card.offsetLeft,
        dy: e.clientY - card.offsetTop,
      };
      card.classList.add('dragging');
      card.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var maxX = Math.max(0, canvas.clientWidth - drag.card.offsetWidth);
      var maxY = Math.max(0, canvas.clientHeight - drag.card.offsetHeight);
      var x = Math.min(Math.max(0, e.clientX - drag.dx), maxX);
      var y = Math.min(Math.max(0, e.clientY - drag.dy), maxY);
      drag.card.style.left = x + 'px';
      drag.card.style.top = y + 'px';
      drag.card.style.right = 'auto';
    });

    function endDrag() {
      if (!drag) return;
      drag.card.classList.remove('dragging');
      saveLayout();
      drag = null;
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  /* ── Command bar (visual only — no functionality yet) ── */
  function initCommandBar() {
    document.getElementById('commandInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') e.preventDefault();
    });
  }

  /* ── Init ── */
  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initRouting();
    initCalendar();
    initSettings();
    initCommandBar();
    applyLayout();
    initDrag();
    tick();
    setInterval(tick, 30000);
    loadEvents();
    if (window.VesonEarnings) {
      window.VesonEarnings.init();
      window.VesonEarnings.initHoursPage();
    }
  });
})();
