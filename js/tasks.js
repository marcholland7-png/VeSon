/* ══════════════════════════════════════════════════════════════════
   VeSon · Tasks  (window.VesonTasks)
   Vanilla module matching the calendar.js / earnings.js pattern.
   Offline-first via localStorage; mirrors the src/core domain model
   (do-date vs deadline, priorities, projects) so a later swap to the
   typed core is a drop-in. init() / refresh() public API.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var TASKS_KEY = 'veson_tasks_v1';
  var PROJ_KEY = 'veson_projects_v1';
  var SEED_KEY = 'veson_tasks_seeded_v1';

  var PRIOS = ['none', 'low', 'medium', 'high', 'urgent'];
  var state = { view: 'today', project: null, search: '', filter: 'all', sort: 'smart' };
  var tasks = [];
  var projects = [];

  /* ── Storage ── */
  function load() {
    try { tasks = JSON.parse(localStorage.getItem(TASKS_KEY) || '[]'); } catch (e) { tasks = []; }
    try { projects = JSON.parse(localStorage.getItem(PROJ_KEY) || '[]'); } catch (e) { projects = []; }
  }
  function save() {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    localStorage.setItem(PROJ_KEY, JSON.stringify(projects));
  }
  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID()
      : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  }

  /* ── Dates ── */
  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(d, n) { var x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
  function fmtDate(d) {
    if (!d) return '';
    var t = today();
    if (d === t) return 'Today';
    if (d === addDays(t, 1)) return 'Tomorrow';
    if (d === addDays(t, -1)) return 'Yesterday';
    return new Date(d + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /* ── Seed (first run only, so every section is alive) ── */
  function seed() {
    if (localStorage.getItem(SEED_KEY)) return;
    var t = today();
    var pV = uid(), pM = uid();
    projects = [
      { id: pV, name: 'VeSon v2', color: null, createdAt: t },
      { id: pM, name: 'Money', color: null, createdAt: t }
    ];
    tasks = [
      mk('Finish task-system spec', { priority: 'high', doDate: t, dueDate: addDays(t, 1), projectId: pV, tags: ['design'] }),
      mk('Reply to Woostock schedule', { priority: 'medium', doDate: t, dueDate: t }),
      mk('Groceries before shift', { priority: 'low', doDate: t }),
      mk('Send invoice to accountant', { priority: 'urgent', dueDate: addDays(t, -2), projectId: pM }),
      mk('Draft AI command-bar copy', { priority: 'medium', doDate: addDays(t, 2), projectId: pV }),
      mk('Book dentist', { priority: 'low', doDate: addDays(t, 4) }),
      mk('Review payslip vs earnings', { priority: 'medium', doDate: addDays(t, 3), projectId: pM }),
      done('Push AI command bar', pV, addDays(t, -1)),
      done('Set up Cloudflare Worker', pV, t)
    ];
    localStorage.setItem(SEED_KEY, '1');
    save();
  }
  function mk(title, o) {
    o = o || {};
    return {
      id: uid(), title: title, notes: '', status: 'todo',
      priority: o.priority || 'none', doDate: o.doDate || null, dueDate: o.dueDate || null,
      projectId: o.projectId || null, tags: o.tags || [], completedAt: null,
      createdAt: today(), order: Date.now() + Math.random()
    };
  }
  function done(title, projectId, at) { var t = mk(title, { projectId: projectId }); t.status = 'done'; t.completedAt = at; return t; }

  /* ── Buckets ── */
  var isTodo = function (t) { return t.status === 'todo'; };
  function overdue() { var d = today(); return tasks.filter(function (t) { return isTodo(t) && t.dueDate && t.dueDate < d; }); }
  function todayList() { var d = today(); return tasks.filter(function (t) { return isTodo(t) && t.doDate === d && !(t.dueDate && t.dueDate < d); }); }
  function upcoming() {
    var d = today();
    return tasks.filter(function (t) { return isTodo(t) && (!t.doDate || t.doDate > d) && !(t.dueDate && t.dueDate < d); });
  }
  function completed() { return tasks.filter(function (t) { return t.status === 'done'; }); }
  function projectTasks(id) { return tasks.filter(function (t) { return t.projectId === id; }); }

  function projectPct(id) {
    var list = projectTasks(id);
    if (!list.length) return 0;
    return Math.round(list.filter(function (t) { return t.status === 'done'; }).length / list.length * 100);
  }

  /* ── Sort / filter ── */
  function focusScore(t) {
    var s = 0, d = today();
    if (t.dueDate) {
      var days = (new Date(t.dueDate) - new Date(d)) / 864e5;
      s += days < 0 ? 1000 - days * 10 : Math.max(0, 200 - days * 8);
    }
    s += PRIOS.indexOf(t.priority) * 40;
    if (t.doDate === d) s += 60;
    return s;
  }
  function applyView(list) {
    var q = state.search.toLowerCase();
    if (q) list = list.filter(function (t) { return t.title.toLowerCase().indexOf(q) !== -1; });
    if (state.filter !== 'all') list = list.filter(function (t) { return t.priority === state.filter; });
    list = list.slice();
    if (state.sort === 'smart') list.sort(function (a, b) { return focusScore(b) - focusScore(a); });
    else if (state.sort === 'deadline') list.sort(function (a, b) { return (a.dueDate || '9') > (b.dueDate || '9') ? 1 : -1; });
    else if (state.sort === 'priority') list.sort(function (a, b) { return PRIOS.indexOf(b.priority) - PRIOS.indexOf(a.priority); });
    else list.sort(function (a, b) { return b.order - a.order; });
    return list;
  }

  /* ── Natural-language quick add ── */
  function parse(text) {
    var o = { priority: 'none', doDate: null, tags: [] };
    var title = text;
    var t = today();
    title = title.replace(/!(urgent|high|medium|low)/i, function (_, p) { o.priority = p.toLowerCase(); return ''; });
    title = title.replace(/#(\w+)/g, function (_, tag) { o.tags.push(tag); return ''; });
    if (/\btoday\b/i.test(title)) { o.doDate = t; title = title.replace(/\btoday\b/i, ''); }
    else if (/\btomorrow\b/i.test(title)) { o.doDate = addDays(t, 1); title = title.replace(/\btomorrow\b/i, ''); }
    else if (/\bnext week\b/i.test(title)) { o.doDate = addDays(t, 7); title = title.replace(/\bnext week\b/i, ''); }
    o.title = title.replace(/\s+/g, ' ').trim();
    return o;
  }

  /* ── SVG icons ── */
  var I = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    upcoming: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>',
    overdue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 16H3z"/><path d="M12 9v4M12 17h.01"/></svg>',
    completed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.4 2.4L15.5 9.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    snooze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3M21 3h-6v6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>'
  };

  /* ── Renderers ── */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function navItem(view, label, icon, count, extra) {
    var active = (state.view === view && !state.project) ? ' active' : '';
    return '<button class="tk-nav-item' + active + (extra || '') + '" data-tkview="' + view + '">' +
      icon + '<span>' + label + '</span><span class="tk-count">' + count + '</span></button>';
  }

  function renderSidebar() {
    var nav = document.getElementById('tkNav');
    nav.innerHTML =
      navItem('today', 'Today', I.today, todayList().length) +
      navItem('upcoming', 'Upcoming', I.upcoming, upcoming().length) +
      navItem('overdue', 'Overdue', I.overdue, overdue().length, ' tk-overdue') +
      navItem('completed', 'Completed', I.completed, completed().length);

    var pc = document.getElementById('tkProjects');
    pc.innerHTML = projects.map(function (p) {
      var pct = projectPct(p.id);
      var active = state.project === p.id ? ' active' : '';
      return '<div class="tk-project' + active + '" data-tkproj="' + p.id + '">' +
        '<div class="tk-project-row"><span class="tk-project-name">' + esc(p.name) + '</span>' +
        '<span class="tk-project-pct">' + pct + '%</span></div>' +
        '<div class="tk-project-bar"><span style="width:' + pct + '%"></span></div></div>';
    }).join('') || '<p class="tk-tag" style="padding:0 4px">No projects yet</p>';

    var ss = document.getElementById('tkSideStats');
    var doneWeek = completed().filter(function (t) {
      return t.completedAt && (new Date() - new Date(t.completedAt + 'T00:00:00')) < 7 * 864e5;
    }).length;
    ss.innerHTML =
      stat('Done this week', doneWeek) +
      stat('Active projects', projects.length);
  }
  function stat(label, val) { return '<div class="tk-side-stat"><span>' + label + '</span><strong>' + val + '</strong></div>'; }

  function renderStats() {
    var el = document.getElementById('tkStats');
    var od = overdue().length;
    var allTodo = tasks.filter(isTodo).length;
    var pct = tasks.length ? Math.round(completed().length / tasks.length * 100) : 0;
    el.innerHTML =
      tile(todayList().length, 'Due today', false) +
      tile(od, 'Overdue', od > 0) +
      tile(allTodo, 'Open tasks', false) +
      tile(pct + '%', 'Complete', false);
  }
  function tile(val, label, accent) {
    return '<div class="tk-stat"><div class="tk-stat-val' + (accent ? ' accent' : '') + '">' + val +
      '</div><div class="tk-stat-label">' + label + '</div></div>';
  }

  function dueChip(t) {
    if (!t.dueDate) return '';
    var d = today(), cls = '';
    if (t.dueDate < d) cls = ' over';
    else if (t.dueDate <= addDays(d, 1)) cls = ' soon';
    var lbl = t.dueDate < d ? 'Due ' + fmtDate(t.dueDate) : fmtDate(t.dueDate);
    return '<span class="tk-due' + cls + '">' + lbl + '</span>';
  }

  function taskRow(t) {
    var proj = t.projectId ? (projects.filter(function (p) { return p.id === t.projectId; })[0] || {}).name : '';
    var meta = [];
    if (t.priority !== 'none') meta.push('<span class="tk-prio ' + t.priority + '"></span>');
    if (proj) meta.push('<span class="tk-tag">' + esc(proj) + '</span>');
    var dc = dueChip(t); if (dc) meta.push(dc);
    (t.tags || []).forEach(function (tag) { meta.push('<span class="tk-tag">#' + esc(tag) + '</span>'); });
    var metaHtml = meta.join('<span class="tk-meta-sep">·</span>');
    return '<div class="tk-task' + (t.status === 'done' ? ' done' : '') + '" data-id="' + t.id + '">' +
      '<button class="tk-check' + (t.status === 'done' ? ' done' : '') + '" data-act="toggle" aria-label="Complete"></button>' +
      '<div class="tk-task-main"><div class="tk-task-title">' + esc(t.title) + '</div>' +
      (metaHtml ? '<div class="tk-task-meta">' + metaHtml + '</div>' : '') + '</div>' +
      '<div class="tk-task-actions">' +
      (t.status === 'done' ? '' : '<button class="tk-act" data-act="snooze" title="Push to tomorrow">' + I.snooze + '</button>') +
      '<button class="tk-act danger" data-act="delete" title="Delete">' + I.trash + '</button></div></div>';
  }

  function emptyState(msg) {
    return '<div class="tk-empty">' + I.completed + '<p>' + msg + '</p></div>';
  }

  function renderContent() {
    var el = document.getElementById('tkContent');
    var html = '';

    if (state.project) {
      var p = projects.filter(function (x) { return x.id === state.project; })[0];
      var list = applyView(projectTasks(state.project).filter(isTodo));
      var doneList = projectTasks(state.project).filter(function (t) { return t.status === 'done'; });
      html += group(p ? p.name + ' · ' + projectPct(state.project) + '%' : 'Project', list, 'Nothing open in this project.');
      if (doneList.length) html += group('Completed', doneList, '');
    } else if (state.view === 'today') {
      var od = overdue();
      if (od.length) {
        html += '<div class="tk-overdue-callout">' + I.overdue +
          '<span>' + od.length + ' overdue ' + (od.length === 1 ? 'task' : 'tasks') + ' need attention</span>' +
          '<button data-tkjump="overdue">Triage →</button></div>';
      }
      html += group('Today', applyView(todayList()), "You're clear for today.");
    } else if (state.view === 'upcoming') {
      html += group('Upcoming', applyView(upcoming()), 'Nothing scheduled ahead.');
    } else if (state.view === 'overdue') {
      html += '<div class="tk-group overdue">' + groupInner('Overdue', applyView(overdue()), 'No overdue tasks. ✦') + '</div>';
    } else if (state.view === 'completed') {
      html += group('Completed', applyView(completed()), 'No completed tasks yet.');
    }
    el.innerHTML = html;
  }
  function group(title, list, empty) { return '<div class="tk-group">' + groupInner(title, list, empty) + '</div>'; }
  function groupInner(title, list, empty) {
    return '<div class="tk-group-head">' + esc(title) + '</div>' +
      (list.length ? '<div class="tk-list">' + list.map(taskRow).join('') + '</div>' : (empty ? emptyState(empty) : ''));
  }

  function render() { renderSidebar(); renderStats(); renderContent(); }

  /* ── Actions ── */
  function byId(id) { return tasks.filter(function (t) { return t.id === id; })[0]; }
  function toggle(id, rowEl) {
    var t = byId(id); if (!t) return;
    if (t.status === 'done') { t.status = 'todo'; t.completedAt = null; save(); render(); return; }
    if (rowEl) rowEl.classList.add('completing');
    t.status = 'done'; t.completedAt = today(); save();
    setTimeout(render, 260);
  }
  function snooze(id) { var t = byId(id); if (t) { t.doDate = addDays(today(), 1); save(); render(); } }
  function del(id) { tasks = tasks.filter(function (t) { return t.id !== id; }); save(); render(); }

  function addFromText(text) {
    var o = parse(text); if (!o.title) return;
    tasks.push(mk(o.title, { priority: o.priority, doDate: o.doDate || (state.view === 'today' ? today() : null), tags: o.tags, projectId: state.project }));
    save(); render();
  }

  /* ── Quick Add modal ── */
  function openQA() {
    var ov = document.getElementById('tkQaOverlay');
    ov.hidden = false;
    var inp = document.getElementById('tkQaInput');
    inp.value = ''; document.getElementById('tkQaPreview').innerHTML = '';
    inp.focus();
  }
  function closeQA() { document.getElementById('tkQaOverlay').hidden = true; }
  function previewQA() {
    var v = document.getElementById('tkQaInput').value;
    var o = parse(v), pills = [];
    if (o.priority !== 'none') pills.push(o.priority);
    if (o.doDate) pills.push(fmtDate(o.doDate));
    o.tags.forEach(function (t) { pills.push('#' + t); });
    document.getElementById('tkQaPreview').innerHTML =
      pills.map(function (p) { return '<span class="tk-qa-pill">' + esc(p) + '</span>'; }).join('');
  }

  /* ── Wiring ── */
  function bind() {
    var root = document.getElementById('view-tasks');
    if (!root || root.dataset.bound) return;
    root.dataset.bound = '1';

    root.addEventListener('click', function (e) {
      var nav = e.target.closest('[data-tkview]');
      if (nav) { state.view = nav.dataset.tkview; state.project = null; render(); return; }
      var proj = e.target.closest('[data-tkproj]');
      if (proj) { state.project = proj.dataset.tkproj; state.view = 'project'; render(); return; }
      var jump = e.target.closest('[data-tkjump]');
      if (jump) { state.view = jump.dataset.tkjump; state.project = null; render(); return; }
      var chip = e.target.closest('.tk-chip');
      if (chip) { state.filter = chip.dataset.tkfilter; document.querySelectorAll('.tk-chip').forEach(function (c) { c.classList.toggle('active', c === chip); }); renderContent(); return; }
      if (e.target.closest('#tkQuickAddBtn')) { openQA(); return; }
      if (e.target.closest('#tkAddProject')) { addProject(); return; }

      var actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        var rowEl = actBtn.closest('.tk-task'), id = rowEl.dataset.id, act = actBtn.dataset.act;
        if (act === 'toggle') toggle(id, rowEl);
        else if (act === 'snooze') snooze(id);
        else if (act === 'delete') del(id);
      }
    });

    document.getElementById('tkSearch').addEventListener('input', function (e) { state.search = e.target.value; renderContent(); });
    document.getElementById('tkSort').addEventListener('change', function (e) { state.sort = e.target.value; renderContent(); });

    var ov = document.getElementById('tkQaOverlay');
    ov.addEventListener('click', function (e) { if (e.target === ov) closeQA(); });
    var qi = document.getElementById('tkQaInput');
    qi.addEventListener('input', previewQA);
    qi.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { addFromText(qi.value); closeQA(); }
      else if (e.key === 'Escape') closeQA();
    });

    document.addEventListener('keydown', function (e) {
      if (!document.getElementById('view-tasks').classList.contains('active')) return;
      var typing = /input|textarea|select/i.test((e.target.tagName || ''));
      if (e.key === 'n' && !typing) { e.preventDefault(); openQA(); }
      else if (e.key === '/' && !typing) { e.preventDefault(); document.getElementById('tkSearch').focus(); }
    });
  }

  function addProject() {
    var name = prompt('New project name');
    if (name && name.trim()) { projects.push({ id: uid(), name: name.trim(), color: null, createdAt: today() }); save(); render(); }
  }

  /* ── Read model for other surfaces (Home briefing, future AI) ── */
  function projName(t) {
    if (!t.projectId) return '';
    var p = projects.filter(function (x) { return x.id === t.projectId; })[0];
    return p ? p.name : '';
  }
  function briefItem(t) {
    var d = today();
    var over = !!(t.dueDate && t.dueDate < d);
    var dueLabel = '';
    if (t.dueDate) dueLabel = over ? 'Overdue' : (t.dueDate <= addDays(d, 1) ? fmtDate(t.dueDate) : fmtDate(t.dueDate));
    return { id: t.id, title: t.title, priority: t.priority, project: projName(t), dueLabel: dueLabel, overdue: over };
  }

  /* ── Public API ── */
  window.VesonTasks = {
    init: function () {
      if (!document.getElementById('view-tasks')) return;
      load(); seed(); bind(); render();
    },
    refresh: function () { load(); render(); },

    // Compact "what needs attention" surface for Home (and later the AI).
    // Focus = overdue first, then today's tasks, smart-ranked, top 5.
    getBriefing: function () {
      if (!tasks.length) load();
      var od = overdue();
      var focusPool = od.concat(todayList());
      focusPool.sort(function (a, b) { return focusScore(b) - focusScore(a); });
      return {
        focus: focusPool.slice(0, 5).map(briefItem),
        overdueCount: od.length,
        todayCount: todayList().length,
        openCount: tasks.filter(isTodo).length,
        donePct: tasks.length ? Math.round(completed().length / tasks.length * 100) : 0
      };
    },

    // Complete a task from another surface (Home focus list).
    complete: function (id) {
      var t = byId(id); if (!t) return;
      t.status = (t.status === 'done') ? 'todo' : 'done';
      t.completedAt = t.status === 'done' ? today() : null;
      save(); render();
    }
  };
})();
