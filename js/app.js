(function () {
  'use strict';

  var THEME_KEY = 'veson_theme';
  var SYNC_KEY = 'veson_sync_code';
  var LAYOUT_KEY = 'veson_layout_v1';

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
      if (window.VesonCalendar) window.VesonCalendar.refresh();
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
    initSettings();
    initCommandBar();
    applyLayout();
    initDrag();
    tick();
    setInterval(tick, 30000);
    if (window.VesonCalendar) window.VesonCalendar.init();
    if (window.VesonEarnings) {
      window.VesonEarnings.init();
      window.VesonEarnings.initHoursPage();
    }
  });
})();
