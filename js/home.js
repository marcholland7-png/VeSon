/* ══════════════════════════════════════════════════════════════════
   VeSon · Home  (window.VesonHome)
   Not a dashboard — a daily briefing. Answers "what do I need to know
   right now?" by COMPOSING real data from the other modules:
     VesonTasks.getBriefing()      — focus + counts (sync, local)
     VesonCalendar.getSnapshot()   — upcoming events (sync, in-memory)
     VesonEarnings.getSnapshot()   — shift + pay (async, Supabase)
   Built entirely from the design system (.vs-*) + the Tasks benchmark.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CAT_COLOR = {
    Work: '#42a5f5', Personal: '#66bb6a', Health: '#ef5350',
    Social: '#ab47bc', Family: '#ffa726', Other: '#78909c'
  };

  /* ── Helpers ── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return '€' + (Number(n) || 0).toFixed(2).replace('.', ','); }
  function iso(d) { return new Date().toISOString().slice(0, 10); }
  function addDays(d, n) { var x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
  function dayLabel(dateStr) {
    if (!dateStr) return '';
    var t = new Date().toISOString().slice(0, 10);
    if (dateStr === t) return 'Today';
    if (dateStr === addDays(t, 1)) return 'Tomorrow';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric' });
  }
  function el(id) { return document.getElementById(id); }

  var CHECK_EMPTY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.4 2.4L15.5 9.5"/></svg>';
  var CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9.5h16M8 3v4M16 3v4"/></svg>';

  /* ── Tiles ── */
  function tile(val, label, sub, accent) {
    return '<div class="vs-tile"><div class="vs-tile-val' + (accent ? ' is-accent' : '') + '">' + val + '</div>' +
      '<div class="vs-tile-label">' + label + '</div>' +
      (sub ? '<div class="vs-tile-sub">' + sub + '</div>' : '') + '</div>';
  }
  function skelTile() { return '<div class="vs-tile"><div class="vs-skeleton" style="height:24px;width:60%"></div><div class="vs-tile-label" style="margin-top:10px">&nbsp;</div></div>'; }

  function renderStats(brief, shift, earn) {
    var wrap = el('homeStats');
    if (!wrap) return;
    var t1 = tile(brief.todayCount, 'Tasks today', brief.openCount + ' open');
    var t2 = tile(brief.overdueCount, 'Overdue', brief.overdueCount ? 'needs attention' : 'all clear', brief.overdueCount > 0);

    // Next shift — from the calendar (sync), so it can show before earnings load.
    var t3;
    if (shift) {
      var v = dayLabel(shift.date) + (shift.start ? ' ' + shift.start : '');
      t3 = tile(v, 'Next shift', shift.allDay ? 'all day' : (shift.end ? '– ' + shift.end : (shift.label || '')));
    } else if (earn === undefined) {
      t3 = skelTile();
    } else {
      t3 = tile('None', 'Next shift', 'nothing booked');
    }

    // This month's pay — from Eitje (async).
    var t4;
    if (earn === undefined) t4 = skelTile();
    else if (!earn || !earn.hasCode) t4 = tile('—', 'This month', 'no sync');
    else if (earn.error) t4 = tile('—', 'This month', 'load failed');
    else t4 = tile(money(earn.month.net), 'This month', earn.month.hours.toFixed(1) + ' hrs · ' + money(earn.month.gross) + ' gross');

    wrap.innerHTML = t1 + t2 + t3 + t4;
  }

  /* ── Focus list ── */
  function focusRow(t) {
    var meta = [];
    if (t.priority && t.priority !== 'none') meta.push('<span class="vs-dot vs-dot--' + t.priority + '"></span>');
    if (t.project) meta.push('<span class="vs-tag">' + esc(t.project) + '</span>');
    if (t.dueLabel) meta.push('<span class="' + (t.overdue ? 'home-due-over' : 'vs-tag') + '">' + esc(t.dueLabel) + '</span>');
    var metaHtml = meta.length ? '<div class="vs-row-meta">' + meta.join('<span class="home-sep">·</span>') + '</div>' : '';
    return '<div class="vs-row home-task vs-rise" data-id="' + t.id + '">' +
      '<div class="vs-row-lead"><button class="tk-check" data-act="home-complete" aria-label="Complete"></button></div>' +
      '<div class="vs-row-main"><div class="vs-row-title">' + esc(t.title) + '</div>' + metaHtml + '</div></div>';
  }
  function renderFocus(brief) {
    var wrap = el('homeFocus');
    if (!wrap) return;
    if (!brief.focus.length) {
      wrap.innerHTML = '<div class="vs-empty">' + CHECK_EMPTY + '<h3>You\'re clear for today</h3><p>No tasks need your attention right now. Enjoy it.</p></div>';
      return;
    }
    wrap.innerHTML = brief.focus.map(focusRow).join('');
  }

  /* ── Shift (from calendar) + pay (from Eitje) ── */
  function renderShift(shift, earn) {
    var wrap = el('homeShift');
    if (!wrap) return;

    // Shift block — driven by the calendar's next Work event.
    var shiftHtml;
    if (shift) {
      var isToday = shift.date === new Date().toISOString().slice(0, 10);
      var timeLine = shift.allDay
        ? 'All day'
        : (shift.start ? esc(shift.start) + ' <span class="home-arrow">→</span> ' + esc(shift.end || '?') : 'Time TBC');
      var metaBits = [];
      if (shift.label) metaBits.push(esc(shift.label));
      if (shift.hours) metaBits.push(shift.hours + 'h');
      shiftHtml =
        '<div class="home-shift-block">' +
          '<span class="vs-label">' + (isToday ? 'Today\'s shift' : 'Next shift · ' + dayLabel(shift.date)) + '</span>' +
          '<div class="home-shift-time">' + timeLine + '</div>' +
          (metaBits.length ? '<div class="vs-row-meta">' + metaBits.join('<span class="home-sep">·</span>') + '</div>' : '') +
        '</div>';
    } else if (earn === undefined) {
      shiftHtml = '<div class="home-shift-block"><span class="vs-label">Next shift</span><div class="vs-skeleton" style="height:22px;width:60%;margin-top:4px"></div></div>';
    } else {
      shiftHtml = '<div class="home-shift-block"><span class="vs-label">Next shift</span>' +
        '<div class="home-shift-time home-muted">No shifts booked</div>' +
        '<div class="vs-row-meta"><span class="link-btn" data-view="calendar">Add one →</span></div></div>';
    }

    // Pay block — driven by Eitje earnings.
    var payHtml;
    if (earn === undefined) {
      payHtml = '<div class="home-shift-block"><span class="vs-label">This month</span><div class="vs-skeleton" style="height:26px;width:50%;margin-top:6px"></div></div>';
    } else if (!earn || !earn.hasCode) {
      payHtml = '<div class="home-shift-block"><span class="vs-label">This month</span><div class="home-shift-time home-muted">—</div>' +
        '<div class="vs-row-meta"><span class="link-btn" data-view="settings">Connect Eitje →</span></div></div>';
    } else if (earn.error) {
      payHtml = '<div class="home-shift-block"><span class="vs-label">This month</span><div class="home-shift-time home-muted">Couldn\'t load</div></div>';
    } else {
      payHtml = '<div class="home-shift-block">' +
        '<span class="vs-label">This month</span>' +
        '<div class="home-pay-val">' + money(earn.month.net) + '</div>' +
        '<div class="vs-tile-sub">' + earn.month.hours.toFixed(1) + ' hrs · ' + money(earn.month.gross) + ' gross</div>' +
      '</div>';
    }
    wrap.innerHTML = shiftHtml + payHtml;
  }

  /* ── Upcoming events ── */
  function renderUpcoming(events) {
    var wrap = el('homeUpcoming');
    if (!wrap) return;
    if (!events || !events.length) {
      wrap.innerHTML = '<div class="vs-empty" style="padding:24px 12px">' + CAL_ICON + '<p>Nothing scheduled ahead.</p></div>';
      return;
    }
    wrap.innerHTML = events.slice(0, 5).map(function (ev) {
      var color = CAT_COLOR[ev.category] || CAT_COLOR.Other;
      return '<div class="home-ev">' +
        '<span class="home-ev-date">' + esc(dayLabel(ev.date)) + '</span>' +
        '<span class="home-ev-dot" style="background:' + color + '"></span>' +
        '<span class="home-ev-title">' + esc(ev.title) + '</span>' +
        (ev.time ? '<span class="home-ev-time">' + esc(ev.time) + '</span>' : '') +
        '</div>';
    }).join('');
  }

  /* ── Brief sentence under the greeting ── */
  function updateBrief(brief, shift, events) {
    var node = el('homeBrief');
    if (!node) return;
    var todayISO = new Date().toISOString().slice(0, 10);
    var parts = [];
    if (brief.todayCount) parts.push(brief.todayCount + (brief.todayCount === 1 ? ' task' : ' tasks') + ' today');
    if (brief.overdueCount) parts.push(brief.overdueCount + ' overdue');
    if (shift) {
      if (shift.date === todayISO) parts.push('shift today' + (shift.start ? ' at ' + shift.start : ''));
      else parts.push('next shift ' + dayLabel(shift.date));
    }
    if (events && events.length) parts.push(events.length + (events.length === 1 ? ' event' : ' events') + ' coming up');
    node.textContent = parts.length ? cap(parts.join(' · ')) + '.' : 'Nothing pressing right now. A calm one.';
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ── Compose ── */
  function briefing() { return (window.VesonTasks && window.VesonTasks.getBriefing) ? window.VesonTasks.getBriefing() : { focus: [], overdueCount: 0, todayCount: 0, openCount: 0, donePct: 0 }; }
  function calEvents() { return (window.VesonCalendar && window.VesonCalendar.getSnapshot) ? window.VesonCalendar.getSnapshot() : []; }
  function calNextShift() { return (window.VesonCalendar && window.VesonCalendar.getNextShift) ? window.VesonCalendar.getNextShift() : null; }

  // The next shift the user actually has planned: prefer the calendar's Work
  // event; fall back to an Eitje upcoming shift only if the calendar has none.
  function resolveShift(calShift, earn) {
    if (calShift) {
      return {
        date: calShift.date,
        start: calShift.allDay ? null : calShift.startTime,
        end: calShift.allDay ? null : calShift.endTime,
        allDay: calShift.allDay,
        label: calShift.location || calShift.title || 'Shift'
      };
    }
    if (earn && earn.hasCode && !earn.error) {
      var e = earn.today || (earn.upcoming && earn.upcoming[0]);
      if (e) return { date: e.date, start: e.start, end: e.end, allDay: false, label: e.job || 'Shift', hours: e.hours };
    }
    return null;
  }

  function compose() {
    if (!el('homeStats')) return;
    var brief = briefing();
    var events = calEvents();
    var calShift = calNextShift();
    var shift = resolveShift(calShift, null); // calendar-derived, available now

    // Paint sync data (tasks + calendar) immediately…
    renderStats(brief, shift, undefined);
    renderFocus(brief);
    renderShift(shift, undefined);
    renderUpcoming(events);
    updateBrief(brief, shift, events);

    // …then fill the async earnings pieces (pay, and shift fallback if no cal shift).
    if (window.VesonEarnings && window.VesonEarnings.getSnapshot) {
      window.VesonEarnings.getSnapshot().then(function (earn) {
        var s = resolveShift(calShift, earn);
        renderStats(brief, s, earn);
        renderShift(s, earn);
        updateBrief(brief, s, events);
      }).catch(function () {
        renderStats(brief, shift, null);
        renderShift(shift, null);
      });
    } else {
      renderStats(brief, shift, null);
      renderShift(shift, null);
    }
  }

  /* ── Wiring ── */
  function bind() {
    var focus = el('homeFocus');
    if (!focus || focus.dataset.bound) return;
    focus.dataset.bound = '1';
    focus.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act="home-complete"]');
      if (!btn) return;
      var row = btn.closest('.home-task');
      var id = row && row.dataset.id;
      if (!id) return;
      btn.classList.add('done');
      row.classList.add('home-task-done');
      if (window.VesonTasks && window.VesonTasks.complete) window.VesonTasks.complete(id);
      setTimeout(compose, 220);
    });
  }

  /* ── Public API ── */
  window.VesonHome = {
    init: function () { if (!el('homeStats')) return; bind(); compose(); },
    refresh: function () { compose(); }
  };
})();
