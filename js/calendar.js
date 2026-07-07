(function () {
  'use strict';

  // Same Supabase project + "sync" table the calendar app (Calendar-app repo)
  // reads/writes. Same merge protocol (updatedAt wins, tombstones for
  // deletes) so this can safely run alongside that app on the same data.
  var SUPABASE_URL = 'https://jmmwqqssqujsiedafqdd.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN';
  var SYNC_KEY = 'veson_sync_code';
  var EVENTS_KEY = 'veson_cal_events_v1';
  var TOMBS_KEY = 'veson_cal_tombstones_v1';
  var REMOTE_TODOS_KEY = 'veson_cal_remote_todos_cache';

  var CATEGORIES = [
    { id: 'work', label: 'Work', color: '#42a5f5' },
    { id: 'personal', label: 'Personal', color: '#66bb6a' },
    { id: 'health', label: 'Health', color: '#ef5350' },
    { id: 'social', label: 'Social', color: '#ab47bc' },
    { id: 'family', label: 'Family', color: '#ffa726' },
    { id: 'other', label: 'Other', color: '#78909c' }
  ];
  var CAT_BY_ID = {};
  CATEGORIES.forEach(function (c) { CAT_BY_ID[c.id] = c; });

  var events = [];
  var tombstones = [];
  var remoteTodos = [];
  var syncInProgress = false;
  var syncDirty = false;

  var today = startOfDay(new Date());
  var cursor = startOfDay(new Date());
  var currentView = 'month';
  var editingId = null;
  var repeatType = 'none';
  var repeatWeeks = 2;
  var activeModal = null;
  var drag = null;

  /* ── Date helpers ── */
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function fmt(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseDate(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function getWeekStart(d) {
    var s = new Date(d);
    var day = s.getDay();
    s.setDate(s.getDate() - (day === 0 ? 6 : day - 1));
    s.setHours(0, 0, 0, 0);
    return s;
  }
  function nowIso() { return new Date().toISOString(); }
  function stampEvent(ev) { ev.updatedAt = nowIso(); return ev; }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

  function eventSpansDate(ev, d) {
    var start = parseDate(ev.date);
    var end = ev.endDate ? parseDate(ev.endDate) : start;
    var x = startOfDay(d);
    return x >= start && x <= end;
  }
  function eventsForDate(d) {
    return events.filter(function (ev) { return eventSpansDate(ev, d); })
      .sort(function (a, b) { return (a.startTime || '00:00') > (b.startTime || '00:00') ? 1 : -1; });
  }
  function isReadOnly(ev) { return !!ev._icsId; }
  function catFor(ev) { return CAT_BY_ID[ev.category] || CAT_BY_ID.other; }

  /* ── Local persistence ── */
  function saveLocal() {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
    localStorage.setItem(TOMBS_KEY, JSON.stringify(tombstones));
  }
  function loadLocal() {
    try { events = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]'); } catch (e) { events = []; }
    try { tombstones = JSON.parse(localStorage.getItem(TOMBS_KEY) || '[]'); } catch (e) { tombstones = []; }
    try { remoteTodos = JSON.parse(localStorage.getItem(REMOTE_TODOS_KEY) || '[]'); } catch (e) { remoteTodos = []; }
  }
  function tombstoneIds(ids) {
    var t = nowIso();
    ids.forEach(function (id) { tombstones.push({ id: id, at: t }); });
  }

  /* ── Sync (mirrors the calendar app's merge protocol) ── */
  function syncCode() { return localStorage.getItem(SYNC_KEY); }
  function syncHeaders(extra) {
    var h = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }
  function mergeById(local, remote) {
    var map = {};
    local.forEach(function (e) { map[e.id] = e; });
    remote.forEach(function (e) {
      var p = map[e.id];
      if (!p || (e.updatedAt || '') > (p.updatedAt || '')) map[e.id] = e;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function mergeTombs(local, remote) {
    var map = {};
    local.forEach(function (t) { map[t.id] = t; });
    remote.forEach(function (t) {
      var p = map[t.id];
      if (!p || (t.at || '') > (p.at || '')) map[t.id] = t;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function applyTombs(items, tombs) {
    var tMap = {};
    tombs.forEach(function (t) { tMap[t.id] = t.at || ''; });
    return items.filter(function (e) {
      var tAt = tMap[e.id];
      return tAt === undefined || (e.updatedAt || '') > tAt;
    });
  }

  function pushSync() {
    var code = syncCode();
    if (!code) return Promise.resolve();
    if (syncInProgress) { syncDirty = true; return Promise.resolve(); }
    syncInProgress = true; syncDirty = false;
    var ts = nowIso();
    return fetch(SUPABASE_URL + '/rest/v1/sync', {
      method: 'POST',
      headers: syncHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ code: code, events: events, todos: remoteTodos, tombstones: tombstones, updated_at: ts })
    }).catch(function () {}).then(function () {
      syncInProgress = false;
      if (syncDirty) return pushSync();
    });
  }

  function pullSync() {
    var code = syncCode();
    if (!code || syncInProgress) return Promise.resolve(false);
    syncInProgress = true;
    return fetch(SUPABASE_URL + '/rest/v1/sync?code=eq.' + encodeURIComponent(code) + '&select=events,todos,tombstones,updated_at', {
      headers: syncHeaders()
    }).then(function (res) {
      if (!res.ok) throw new Error('sync fetch failed: ' + res.status);
      return res.json();
    }).then(function (rows) {
      syncInProgress = false;
      if (!rows.length) return false;
      var remote = rows[0];
      remoteTodos = remote.todos || [];
      var remoteTombs = remote.tombstones || [];
      var mergedTombs = mergeTombs(tombstones, remoteTombs);
      var mergedEvents = applyTombs(mergeById(events, remote.events || []), mergedTombs);
      var changed = JSON.stringify(mergedEvents) !== JSON.stringify(events) ||
        JSON.stringify(mergedTombs) !== JSON.stringify(tombstones);
      events = mergedEvents;
      tombstones = mergedTombs;
      saveLocal();
      localStorage.setItem(REMOTE_TODOS_KEY, JSON.stringify(remoteTodos));
      if (changed) return pushSync().then(function () { return true; });
      return changed;
    }).catch(function () {
      syncInProgress = false;
      return false;
    });
  }

  /* ── Modal system ── */
  function openModal(id) {
    if (activeModal) document.getElementById(activeModal).classList.remove('open');
    activeModal = id;
    document.getElementById(id).classList.add('open');
    document.getElementById('calOverlay').classList.add('open');
  }
  function closeModal() {
    if (!activeModal) return;
    document.getElementById(activeModal).classList.remove('open');
    document.getElementById('calOverlay').classList.remove('open');
    activeModal = null;
  }

  /* ── Shared chip/row builders ── */
  function buildChip(ev) {
    var chip = document.createElement('div');
    chip.className = 'cal-chip';
    chip.dataset.eventId = ev.id;
    var cat = catFor(ev);
    chip.style.setProperty('--chip-color', cat.color);
    chip.style.setProperty('--chip-bg', cat.color + '22');
    if (ev.startTime && !ev.allDay) {
      var t = document.createElement('span');
      t.className = 'cal-chip-time';
      t.textContent = ev.startTime;
      chip.appendChild(t);
    }
    var title = document.createElement('span');
    title.className = 'cal-chip-title';
    title.textContent = ev.title || '(untitled)';
    chip.appendChild(title);
    if (isReadOnly(ev)) chip.style.opacity = '0.7';
    return chip;
  }

  function buildAgendaRow(ev) {
    var cat = catFor(ev);
    var row = document.createElement('div');
    row.className = 'ag-row';
    row.dataset.eventId = ev.id;
    var bar = document.createElement('div');
    bar.className = 'ag-bar';
    bar.style.background = cat.color;
    var info = document.createElement('div');
    info.className = 'ag-info';
    var title = document.createElement('div');
    title.className = 'ag-title';
    title.textContent = ev.title || '(untitled)';
    var meta = document.createElement('div');
    meta.className = 'ag-meta';
    meta.textContent = ev.allDay ? 'All day' : ((ev.startTime || '') + (ev.endTime ? ' – ' + ev.endTime : ''));
    if (ev.location) meta.textContent += '  ·  ' + ev.location;
    info.appendChild(title); info.appendChild(meta);
    row.appendChild(bar); row.appendChild(info);
    return row;
  }

  /* ── Home widget (Upcoming Events card) ── */
  function renderHomeWidget() {
    var body = document.getElementById('eventsBody');
    if (!body) return;
    var todays = eventsForDate(new Date());
    if (!todays.length) {
      body.innerHTML = '<p class="empty-state">No events today.</p>';
      return;
    }
    body.innerHTML = '';
    todays.forEach(function (ev) {
      var row = document.createElement('div');
      row.className = 'event-row';
      var time = document.createElement('span');
      time.className = 'event-time';
      time.textContent = ev.allDay ? 'All day' : (ev.startTime || '');
      var title = document.createElement('span');
      title.className = 'event-title';
      title.textContent = ev.title || '(untitled event)';
      row.appendChild(time); row.appendChild(title);
      body.appendChild(row);
    });
  }

  /* ── Toolbar title ── */
  function updateTitle() {
    var title = document.getElementById('calTitle');
    if (currentView === 'month') {
      title.textContent = cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });
    } else {
      var ws = getWeekStart(cursor), we = new Date(ws); we.setDate(we.getDate() + 6);
      if (ws.getMonth() === we.getMonth()) {
        title.textContent = ws.toLocaleDateString([], { month: 'short' }) + ' ' + ws.getDate() + '–' + we.getDate() + ', ' + ws.getFullYear();
      } else {
        title.textContent = ws.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' – ' + we.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
    }
  }

  /* ── Month view ── */
  function renderMonth() {
    var grid = document.getElementById('calGrid');
    grid.innerHTML = '';
    var year = cursor.getFullYear(), month = cursor.getMonth();
    var firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var prevDays = new Date(year, month, 0).getDate();
    var total = Math.ceil((firstDay + daysInMonth) / 7) * 7;

    for (var i = 0; i < total; i++) {
      var d, other = false;
      if (i < firstDay) { d = new Date(year, month - 1, prevDays - firstDay + i + 1); other = true; }
      else if (i >= firstDay + daysInMonth) { d = new Date(year, month + 1, i - firstDay - daysInMonth + 1); other = true; }
      else d = new Date(year, month, i - firstDay + 1);

      var cell = document.createElement('div');
      cell.className = 'cal-cell' + (other ? ' other-month' : '') + (isSameDay(d, today) ? ' today' : '');
      cell.dataset.date = fmt(d);

      var dn = document.createElement('div');
      dn.className = 'cal-daynum';
      dn.textContent = String(d.getDate());
      cell.appendChild(dn);

      var chipsWrap = document.createElement('div');
      chipsWrap.className = 'cal-chips';
      var evs = eventsForDate(d);
      evs.slice(0, 3).forEach(function (ev) { chipsWrap.appendChild(buildChip(ev)); });
      if (evs.length > 3) {
        var more = document.createElement('div');
        more.className = 'cal-more';
        more.textContent = '+' + (evs.length - 3) + ' more';
        chipsWrap.appendChild(more);
      }
      cell.appendChild(chipsWrap);
      grid.appendChild(cell);
    }
  }

  /* ── Month view: click + drag-to-reschedule ── */
  function initMonthInteractions() {
    var grid = document.getElementById('calGrid');

    grid.addEventListener('click', function (e) {
      if (drag && drag.active) return;
      var chip = e.target.closest('.cal-chip');
      if (chip) { openEventModal(chip.dataset.eventId); return; }
      var cell = e.target.closest('.cal-cell');
      if (cell) openDayModal(parseDate(cell.dataset.date));
    });

    grid.addEventListener('pointerdown', function (e) {
      var chip = e.target.closest('.cal-chip');
      if (!chip) return;
      var ev = events.find(function (x) { return x.id === chip.dataset.eventId; });
      if (!ev || isReadOnly(ev)) return;
      drag = { chipEl: chip, evId: chip.dataset.eventId, startX: e.clientX, startY: e.clientY, active: false, ghost: null };
    });

    document.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 8) return;
        drag.active = true;
        drag.chipEl.classList.add('dragging');
        var g = drag.chipEl.cloneNode(true);
        g.style.position = 'fixed';
        g.style.zIndex = '9999';
        g.style.pointerEvents = 'none';
        g.style.opacity = '0.9';
        g.style.width = drag.chipEl.offsetWidth + 'px';
        document.body.appendChild(g);
        drag.ghost = g;
      }
      drag.ghost.style.left = (e.clientX - drag.ghost.offsetWidth / 2) + 'px';
      drag.ghost.style.top = (e.clientY - 12) + 'px';
      drag.ghost.style.visibility = 'hidden';
      var under = document.elementFromPoint(e.clientX, e.clientY);
      drag.ghost.style.visibility = '';
      document.querySelectorAll('.cal-cell.drag-over').forEach(function (c) { c.classList.remove('drag-over'); });
      var overCell = under && under.closest && under.closest('.cal-cell');
      if (overCell) overCell.classList.add('drag-over');
    });

    document.addEventListener('pointerup', function () {
      if (!drag) return;
      if (drag.active) {
        if (drag.ghost) drag.ghost.remove();
        drag.chipEl.classList.remove('dragging');
        var target = document.querySelector('.cal-cell.drag-over');
        document.querySelectorAll('.cal-cell.drag-over').forEach(function (c) { c.classList.remove('drag-over'); });
        if (target && target.dataset.date) rescheduleEvent(drag.evId, target.dataset.date);
      }
      drag = null;
    });

    document.addEventListener('pointercancel', function () {
      if (!drag) return;
      if (drag.ghost) drag.ghost.remove();
      if (drag.chipEl) drag.chipEl.classList.remove('dragging');
      document.querySelectorAll('.cal-cell.drag-over').forEach(function (c) { c.classList.remove('drag-over'); });
      drag = null;
    });
  }

  function rescheduleEvent(evId, newDate) {
    var ev = events.find(function (e) { return e.id === evId; });
    if (!ev) return;
    ev.date = newDate;
    stampEvent(ev);
    saveLocal();
    render();
    pushSync();
  }

  /* ── Week view ── */
  function buildWeekEventBlock(ev) {
    var sh = (ev.startTime || '00:00').split(':').map(Number);
    var eh = (ev.endTime || ev.startTime || '00:00').split(':').map(Number);
    var startTotal = sh[0] + sh[1] / 60;
    var endTotal = eh[0] + eh[1] / 60;
    if (endTotal <= startTotal) endTotal += 24;
    var top = startTotal * 44;
    var height = Math.max(Math.min(endTotal, 24) - startTotal, 0.5) * 44;
    var cat = catFor(ev);
    var el = document.createElement('div');
    el.className = 'wk-ev';
    el.dataset.eventId = ev.id;
    el.style.top = top + 'px';
    el.style.height = height + 'px';
    el.style.background = cat.color;
    var t = document.createElement('span');
    t.className = 'wk-ev-time';
    t.textContent = ev.startTime + (ev.endTime ? ' – ' + ev.endTime : '');
    var ti = document.createElement('span');
    ti.textContent = ev.title || '(untitled)';
    el.appendChild(t); el.appendChild(ti);
    return el;
  }

  function renderWeek() {
    var hdr = document.getElementById('wkHdr');
    var body = document.getElementById('wkBody');
    hdr.innerHTML = ''; body.innerHTML = '';

    var ws = getWeekStart(cursor);
    var days = [];
    for (var i = 0; i < 7; i++) { var d = new Date(ws); d.setDate(d.getDate() + i); days.push(d); }

    hdr.appendChild(document.createElement('div'));
    days.forEach(function (d) {
      var cell = document.createElement('div');
      cell.className = 'wk-hdr-cell' + (isSameDay(d, today) ? ' today-col' : '');
      cell.innerHTML = d.toLocaleDateString([], { weekday: 'short' }) + '<strong>' + d.getDate() + '</strong>';
      hdr.appendChild(cell);
    });

    var timeCol = document.createElement('div');
    timeCol.className = 'wk-time-col';
    for (var h = 0; h < 24; h++) {
      var s = document.createElement('div');
      s.className = 'wk-tsl';
      s.textContent = h === 0 ? '' : (h < 12 ? h + 'am' : (h === 12 ? '12pm' : (h - 12) + 'pm'));
      timeCol.appendChild(s);
    }
    body.appendChild(timeCol);

    days.forEach(function (d) {
      var col = document.createElement('div');
      col.className = 'wk-col';
      col.dataset.date = fmt(d);
      for (var h2 = 0; h2 < 24; h2++) {
        var slot = document.createElement('div');
        slot.className = 'wk-slot';
        slot.dataset.hour = String(h2);
        col.appendChild(slot);
      }
      eventsForDate(d).filter(function (ev) { return !ev.allDay && ev.startTime; })
        .forEach(function (ev) { col.appendChild(buildWeekEventBlock(ev)); });
      body.appendChild(col);
    });

    var now = new Date();
    var weekEnd = new Date(ws); weekEnd.setDate(weekEnd.getDate() + 6);
    if (now >= ws && now <= weekEnd) {
      var dayIndex = Math.round((startOfDay(now) - ws) / 86400000);
      var col2 = body.children[1 + dayIndex];
      if (col2) {
        var line = document.createElement('div');
        line.className = 'wk-now-line';
        line.style.top = ((now.getHours() + now.getMinutes() / 60) * 44) + 'px';
        col2.appendChild(line);
      }
    }
  }

  function initWeekInteractions() {
    document.getElementById('wkBody').addEventListener('click', function (e) {
      var evBlock = e.target.closest('.wk-ev');
      if (evBlock) { openEventModal(evBlock.dataset.eventId); return; }
      var slot = e.target.closest('.wk-slot');
      if (slot) {
        var col = slot.closest('.wk-col');
        openEventModal(null, col.dataset.date, String(slot.dataset.hour).padStart(2, '0') + ':00');
      }
    });
  }

  /* ── Agenda view ── */
  function renderAgenda() {
    var wrap = document.getElementById('calAgendaView');
    wrap.innerHTML = '';
    var ws = getWeekStart(cursor);
    for (var i = 0; i < 7; i++) {
      var d = new Date(ws); d.setDate(d.getDate() + i);
      var isT = isSameDay(d, today);
      var grp = document.createElement('div');
      grp.className = 'ag-group';
      var dh = document.createElement('div');
      dh.className = 'ag-date' + (isT ? ' today-hdr' : '');
      dh.textContent = (isT ? 'Today — ' : '') + d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
      grp.appendChild(dh);
      var evs = eventsForDate(d);
      if (!evs.length) {
        var empty = document.createElement('div');
        empty.className = 'ag-empty';
        empty.textContent = 'No events';
        grp.appendChild(empty);
      } else {
        evs.forEach(function (ev) { grp.appendChild(buildAgendaRow(ev)); });
      }
      wrap.appendChild(grp);
    }
  }

  function initAgendaInteractions() {
    document.getElementById('calAgendaView').addEventListener('click', function (e) {
      var row = e.target.closest('.ag-row');
      if (row) openEventModal(row.dataset.eventId);
    });
  }

  /* ── Day detail modal ── */
  function openDayModal(d) {
    document.getElementById('dayModalTitle').textContent = isSameDay(d, today)
      ? 'Today'
      : d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    var body = document.getElementById('dayModalBody');
    body.innerHTML = '';
    var evs = eventsForDate(d);
    if (!evs.length) {
      body.innerHTML = '<p class="empty-state">No events this day.</p>';
    } else {
      evs.forEach(function (ev) { body.appendChild(buildAgendaRow(ev)); });
    }
    document.getElementById('dayModalAdd').onclick = function () {
      closeModal();
      openEventModal(null, fmt(d));
    };
    body.onclick = function (e) {
      var row = e.target.closest('.ag-row');
      if (row) { closeModal(); openEventModal(row.dataset.eventId); }
    };
    openModal('dayModal');
  }

  /* ── Event add/edit modal ── */
  function renderCatPills(selected) {
    var wrap = document.getElementById('efCatPills');
    wrap.innerHTML = '';
    CATEGORIES.forEach(function (c) {
      var p = document.createElement('button');
      p.type = 'button';
      p.className = 'cf-pill' + (c.id === selected ? ' sel' : '');
      p.dataset.cat = c.id;
      var dot = document.createElement('span');
      dot.className = 'cf-pill-dot';
      dot.style.background = c.color;
      p.appendChild(dot);
      p.appendChild(document.createTextNode(c.label));
      wrap.appendChild(p);
    });
  }

  function openEventModal(id, prefDate, prefTime) {
    editingId = id || null;
    var ev = id ? events.find(function (e) { return e.id === id; }) : null;
    var p = ev || {};

    document.getElementById('eventModalTitle').textContent = id ? 'Edit Event' : 'Add Event';
    document.getElementById('efDelete').style.display = id ? '' : 'none';
    document.getElementById('efTitle').value = p.title || '';
    document.getElementById('efDate').value = p.date || prefDate || fmt(new Date());
    document.getElementById('efEndDate').value = p.endDate || '';
    var allDay = p.allDay === undefined ? false : p.allDay;
    document.getElementById('efAllDay').checked = allDay;
    document.getElementById('efStart').value = p.startTime || prefTime || '09:00';
    document.getElementById('efEnd').value = p.endTime || (prefTime ? (String(Number(prefTime.split(':')[0]) + 1).padStart(2, '0') + ':00') : '10:00');
    document.getElementById('efTimeWrap').style.display = allDay ? 'none' : '';
    document.getElementById('efLocation').value = p.location || '';
    document.getElementById('efNotes').value = p.notes || '';
    renderCatPills(p.category || 'work');

    repeatType = 'none'; repeatWeeks = 2;
    document.querySelectorAll('#efRepeatPills .cf-pill').forEach(function (x, i) { x.classList.toggle('sel', i === 0); });
    document.querySelectorAll('#efRepeatWeeksPills .cf-pill').forEach(function (x, i) { x.classList.toggle('sel', i === 0); });
    document.getElementById('efRepeatDaysWrap').style.display = 'none';
    document.getElementById('efRepeatWeeksWrap').style.display = 'none';
    document.querySelectorAll('#efRepeatDays .cf-day-btn').forEach(function (b) { b.classList.remove('sel'); });

    openModal('eventModal');
    setTimeout(function () { document.getElementById('efTitle').focus(); }, 50);
  }

  function saveEvent() {
    var titleInput = document.getElementById('efTitle');
    var title = titleInput.value.trim();
    if (!title) {
      titleInput.style.borderColor = '#ef5350';
      titleInput.focus();
      setTimeout(function () { titleInput.style.borderColor = ''; }, 1500);
      return;
    }
    var allDay = document.getElementById('efAllDay').checked;
    var catPill = document.querySelector('#efCatPills .cf-pill.sel');
    var ev = {
      id: editingId || newId(),
      title: title,
      date: document.getElementById('efDate').value,
      endDate: document.getElementById('efEndDate').value || null,
      allDay: allDay,
      startTime: allDay ? null : document.getElementById('efStart').value,
      endTime: allDay ? null : document.getElementById('efEnd').value,
      location: document.getElementById('efLocation').value.trim() || null,
      notes: document.getElementById('efNotes').value.trim() || null,
      category: catPill ? catPill.dataset.cat : 'other'
    };
    if (editingId) {
      var existing = events.find(function (e) { return e.id === editingId; });
      if (existing && existing.recurringId) ev.recurringId = existing.recurringId;
    }
    stampEvent(ev);

    var selectedDays = Array.prototype.slice.call(document.querySelectorAll('#efRepeatDays .cf-day-btn.sel'))
      .map(function (b) { return parseInt(b.dataset.dow, 10); });

    if (repeatType === 'weekly' && !selectedDays.length) {
      var wrap = document.getElementById('efRepeatDaysWrap');
      wrap.style.outline = '1px solid #ef5350';
      setTimeout(function () { wrap.style.outline = ''; }, 1200);
      return;
    }

    if (editingId) {
      var i = events.findIndex(function (e) { return e.id === editingId; });
      if (i !== -1) events[i] = ev; else events.push(ev);
    } else {
      events.push(ev);
    }

    if (repeatType !== 'none') {
      var recurringId = ev.recurringId || newId();
      ev.recurringId = recurringId;
      var baseDate = parseDate(ev.date);
      if (repeatType === 'daily') {
        for (var j = 1; j < repeatWeeks * 7; j++) {
          var d = new Date(baseDate); d.setDate(d.getDate() + j);
          var copy = Object.assign({}, ev, { id: newId(), date: fmt(d), endDate: null });
          stampEvent(copy);
          events.push(copy);
        }
      } else {
        var sun = new Date(baseDate); sun.setDate(sun.getDate() - baseDate.getDay());
        for (var w = 0; w < repeatWeeks; w++) {
          selectedDays.forEach(function (dow) {
            var d2 = new Date(sun); d2.setDate(d2.getDate() + w * 7 + dow);
            if (isSameDay(d2, baseDate)) return;
            var copy2 = Object.assign({}, ev, { id: newId(), date: fmt(d2), endDate: null });
            stampEvent(copy2);
            events.push(copy2);
          });
        }
      }
    }

    saveLocal();
    closeModal();
    render();
    pushSync();
  }

  function deleteEvent() {
    if (!editingId) return;
    var ev = events.find(function (e) { return e.id === editingId; });
    var ids;
    if (ev && ev.recurringId) {
      var count = events.filter(function (e) { return e.recurringId === ev.recurringId; }).length;
      var all = confirm('This is a repeating event (' + count + ' total).\nOK = delete all in series\nCancel = delete only this one');
      ids = all ? events.filter(function (e) { return e.recurringId === ev.recurringId; }).map(function (e) { return e.id; }) : [editingId];
    } else {
      if (!confirm('Delete this event?')) return;
      ids = [editingId];
    }
    tombstoneIds(ids);
    events = events.filter(function (e) { return ids.indexOf(e.id) === -1; });
    saveLocal();
    closeModal();
    render();
    pushSync();
  }

  function initEventFormListeners() {
    document.getElementById('efAllDay').addEventListener('change', function () {
      document.getElementById('efTimeWrap').style.display = this.checked ? 'none' : '';
    });
    document.getElementById('efCatPills').addEventListener('click', function (e) {
      var p = e.target.closest('.cf-pill'); if (!p) return;
      document.querySelectorAll('#efCatPills .cf-pill').forEach(function (x) { x.classList.remove('sel'); });
      p.classList.add('sel');
    });
    document.getElementById('efRepeatPills').addEventListener('click', function (e) {
      var p = e.target.closest('.cf-pill'); if (!p) return;
      repeatType = p.dataset.repeat;
      document.querySelectorAll('#efRepeatPills .cf-pill').forEach(function (x) { x.classList.remove('sel'); });
      p.classList.add('sel');
      document.getElementById('efRepeatDaysWrap').style.display = repeatType === 'weekly' ? '' : 'none';
      document.getElementById('efRepeatWeeksWrap').style.display = repeatType !== 'none' ? '' : 'none';
    });
    document.getElementById('efRepeatWeeksPills').addEventListener('click', function (e) {
      var p = e.target.closest('.cf-pill'); if (!p) return;
      repeatWeeks = parseInt(p.dataset.weeks, 10);
      document.querySelectorAll('#efRepeatWeeksPills .cf-pill').forEach(function (x) { x.classList.remove('sel'); });
      p.classList.add('sel');
    });
    document.getElementById('efRepeatDays').addEventListener('click', function (e) {
      var b = e.target.closest('.cf-day-btn'); if (!b) return;
      b.classList.toggle('sel');
    });
    document.getElementById('efSave').addEventListener('click', saveEvent);
    document.getElementById('efDelete').addEventListener('click', deleteEvent);
    document.getElementById('efCancel').addEventListener('click', closeModal);
    document.getElementById('eventModalClose').addEventListener('click', closeModal);
    document.getElementById('dayModalClose').addEventListener('click', closeModal);
    document.getElementById('calOverlay').addEventListener('click', closeModal);
  }

  /* ── Toolbar ── */
  function stepCursor(dir) {
    if (currentView === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
    else { cursor = new Date(cursor); cursor.setDate(cursor.getDate() + dir * 7); }
  }

  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.cal-view-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.calview === view); });
    document.querySelectorAll('.cal-view-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'calPanel-' + view); });
    render();
  }

  function initToolbar() {
    document.getElementById('calPrev').addEventListener('click', function () { stepCursor(-1); render(); });
    document.getElementById('calNext').addEventListener('click', function () { stepCursor(1); render(); });
    document.getElementById('calTodayBtn').addEventListener('click', function () { cursor = startOfDay(new Date()); render(); });
    document.getElementById('calAddBtn').addEventListener('click', function () { openEventModal(null, fmt(new Date())); });
    document.querySelectorAll('.cal-view-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.dataset.calview); });
    });
  }

  /* ── Render dispatch ── */
  function render() {
    updateTitle();
    if (currentView === 'month') renderMonth();
    else if (currentView === 'week') renderWeek();
    else renderAgenda();
    renderHomeWidget();
  }

  /* ── Public API ── */
  window.VesonCalendar = {
    init: function () {
      loadLocal();
      initToolbar();
      initMonthInteractions();
      initWeekInteractions();
      initAgendaInteractions();
      initEventFormListeners();
      render();
      pullSync().then(render);
    },
    refresh: function () {
      render();
      pullSync().then(render);
    },
    // Compact list of events from today through the next ~3 weeks, for the AI
    // command bar. Reads the already-synced in-memory events.
    getSnapshot: function () {
      var horizon = new Date(today);
      horizon.setDate(horizon.getDate() + 21);
      var out = [];
      events.forEach(function (ev) {
        var start = parseDate(ev.date);
        var end = ev.endDate ? parseDate(ev.endDate) : start;
        if (end < today || start > horizon) return;
        out.push({
          date: ev.date,
          title: ev.title || '(untitled)',
          time: ev.allDay ? 'all day'
            : (ev.startTime ? ev.startTime + (ev.endTime ? '–' + ev.endTime : '') : ''),
          category: (CAT_BY_ID[ev.category] || CAT_BY_ID.other).label
        });
      });
      out.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return (a.time || '') < (b.time || '') ? -1 : 1;
      });
      return out.slice(0, 20);
    }
  };
})();
