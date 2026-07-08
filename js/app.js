(function () {
  'use strict';

  var THEME_KEY = 'veson_theme';
  var SYNC_KEY = 'veson_sync_code';

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
    // Landing on Home re-composes the briefing so it reflects the latest
    // tasks / shifts / events without a page reload.
    if (view === 'home' && window.VesonHome) window.VesonHome.refresh();
  }

  function initRouting() {
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-view]');
      if (trigger) { setView(trigger.dataset.view); return; }

      // Assistant page suggestion chips → drop into the command bar, ready to send
      var suggest = e.target.closest('.ai-suggest');
      if (suggest) {
        var cmd = document.getElementById('commandInput');
        if (cmd) { cmd.value = suggest.textContent.trim(); cmd.focus(); }
      }
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
  }

  /* ── Command bar is handled by js/assistant.js ── */

  /* ── Init ── */
  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initRouting();
    initSettings();
    tick();
    setInterval(tick, 30000);
    if (window.VesonCalendar) window.VesonCalendar.init();
    if (window.VesonTasks) window.VesonTasks.init();
    if (window.VesonEarnings) {
      window.VesonEarnings.init();
      window.VesonEarnings.initHoursPage();
    }
    if (window.VesonHome) window.VesonHome.init();
  });
})();
