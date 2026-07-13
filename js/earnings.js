(function () {
  'use strict';

  var SUPABASE_URL = 'https://jmmwqqssqujsiedafqdd.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_0MIMm7jy7QykSBBBOZb5nw_wLaGbnoN';
  var SYNC_KEY = 'veson_sync_code';
  var JOBS_KEY = 'veson_jobs_v1';

  // v1 defaults. User can override by writing veson_jobs_v1 in localStorage
  // (Settings UI will follow later). Rate matches what actually hits the
  // bank on the June '26 payslip (Salaris "Waarde" 17,00, not the base
  // uurloon of 14,71 — the 17,00 already rolls in ORT for evening shifts).
  var DEFAULT_JOBS = [
    {
      id: 'de_gracht',
      name: 'De Gracht',
      team: 'De Gracht Vast',
      hourlyRate: 17.00,
      calcMode: 'flat',
      flatNetRate: 0.919,
      hasLHKorting: true
    }
  ];

  // Swappable per-shift calc. v2 will add a proper cumulative NL loonheffing
  // model with LH-korting + arbeidskorting phase-out; the shape here is
  // designed so v2 slots in without touching callers.
  var calcFns = {
    flat: function (gross, job) {
      var net = gross * (job.flatNetRate || 0.919);
      return { gross: gross, net: net, deductions: gross - net };
    },
    cumulative: function (gross, job) {
      // TODO v2: real NL tables. Falls back to flat for now.
      return calcFns.flat(gross, job);
    }
  };

  function parseTime(dateStr, timeStr) {
    var d = new Date(dateStr + 'T00:00:00');
    var parts = timeStr.split(':').map(Number);
    d.setHours(parts[0], parts[1], 0, 0);
    return d;
  }

  function shiftHours(shift) {
    var start = parseTime(shift.date, shift.start);
    var end = parseTime(shift.date, shift.end);
    if (end <= start) end.setDate(end.getDate() + 1); // crossed midnight
    return (end - start) / 3600000;
  }

  function jobForShift(shift, jobs) {
    var match = jobs.find(function (j) {
      return shift.team && j.team && shift.team.indexOf(j.team) !== -1;
    });
    return match || jobs[0];
  }

  function sumRange(shifts, jobs, fromDate, toDate) {
    var totals = { hours: 0, gross: 0, net: 0 };
    shifts.forEach(function (s) {
      var d = new Date(s.date + 'T00:00:00');
      if (fromDate && d < fromDate) return;
      if (toDate && d > toDate) return;
      var job = jobForShift(s, jobs);
      var hrs = shiftHours(s);
      var gross = hrs * job.hourlyRate;
      var pay = (calcFns[job.calcMode] || calcFns.flat)(gross, job);
      totals.hours += hrs;
      totals.gross += pay.gross;
      totals.net += pay.net;
    });
    return totals;
  }

  // Finance page is scoped to ONE selected month at a time (default: current).
  var financeState = { key: null, data: null, jobs: null, bound: false };

  function currentMonthKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function monthKeyOf(dateStr) { return dateStr ? dateStr.slice(0, 7) : ''; }
  function monthKeyLabel(key) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7);
    return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  }
  function monthBounds(key) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1;
    return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0, 23, 59, 59) };
  }
  function shiftsInMonth(shifts, key) {
    return shifts.filter(function (s) { return monthKeyOf(s.date) === key; });
  }
  // Continuous list of month keys from the earliest shift up to the current
  // month, newest first — so the dropdown has no gaps and always includes now.
  function monthKeyRange(shifts) {
    var cur = currentMonthKey();
    var keys = shifts.map(function (s) { return monthKeyOf(s.date); }).filter(Boolean);
    var minKey = keys.length ? keys.slice().sort()[0] : cur;
    if (minKey > cur) minKey = cur;
    var list = [];
    var d = new Date(+minKey.slice(0, 4), +minKey.slice(5, 7) - 1, 1);
    var end = new Date();
    end = new Date(end.getFullYear(), end.getMonth(), 1);
    while (d <= end) {
      list.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
      d.setMonth(d.getMonth() + 1);
    }
    if (!list.length) list = [cur];
    return list.reverse();
  }

  function loadJobs() {
    var raw = localStorage.getItem(JOBS_KEY);
    if (raw) { try { return JSON.parse(raw); } catch (e) {} }
    return DEFAULT_JOBS;
  }

  function fetchEitjeData(code) {
    var url = SUPABASE_URL + '/rest/v1/eitje_data?code=eq.' +
      encodeURIComponent(code) + '&select=shifts,updated_at';
    return fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY
      }
    }).then(function (res) {
      if (!res.ok) throw new Error('Eitje fetch failed: ' + res.status);
      return res.json();
    }).then(function (rows) {
      return rows.length ? rows[0] : { shifts: [], updated_at: null };
    });
  }

  function startOfDay(d) {
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function fmtMoney(n) {
    return '€' + n.toFixed(2).replace('.', ',');
  }

  function renderCard(data, jobs) {
    var body = document.getElementById('earningsBody');
    if (!body) return;

    var shifts = (data && data.shifts) || [];
    var today = startOfDay(new Date());
    var monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    var yearStart = new Date(today.getFullYear(), 0, 1);

    var todayShift = shifts.find(function (s) {
      return sameDay(new Date(s.date + 'T00:00:00'), today);
    });
    var month = sumRange(shifts, jobs, monthStart, null);
    var ytd = sumRange(shifts, jobs, yearStart, null);

    var parts = [];

    if (todayShift) {
      var job = jobForShift(todayShift, jobs);
      parts.push(
        '<div class="shift-today">' +
          '<span class="shift-label">Today</span>' +
          '<div class="shift-detail">' + todayShift.start + ' → ' + todayShift.end +
            ' <span class="shift-team">' + job.name + '</span>' +
          '</div>' +
        '</div>'
      );
    } else {
      parts.push(
        '<div class="shift-today">' +
          '<span class="shift-label">Today</span>' +
          '<div class="shift-detail muted">No shift</div>' +
        '</div>'
      );
    }

    parts.push(
      '<div class="earnings-grid">' +
        '<div class="earnings-cell">' +
          '<span class="cell-label">This month</span>' +
          '<span class="cell-value">' + fmtMoney(month.net) + '</span>' +
          '<span class="cell-sub">' + month.hours.toFixed(1) + ' hrs · ' +
            fmtMoney(month.gross) + ' gross</span>' +
        '</div>' +
        '<div class="earnings-cell">' +
          '<span class="cell-label">Year to date</span>' +
          '<span class="cell-value">' + fmtMoney(ytd.net) + '</span>' +
          '<span class="cell-sub">' + ytd.hours.toFixed(1) + ' hrs · ' +
            fmtMoney(ytd.gross) + ' gross</span>' +
        '</div>' +
      '</div>'
    );

    var stamp = data && data.updated_at
      ? new Date(data.updated_at).toLocaleString([], {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })
      : '—';
    parts.push('<div class="earnings-stamp">Last synced: ' + stamp + '</div>');

    body.innerHTML = parts.join('');
  }

  function renderMonthSelect(months, selectedKey) {
    var sel = document.getElementById('finMonthSelect');
    if (!sel) return;
    var cur = currentMonthKey();
    sel.innerHTML = months.map(function (k) {
      var label = monthKeyLabel(k) + (k === cur ? ' · This month' : '');
      return '<option value="' + k + '"' + (k === selectedKey ? ' selected' : '') + '>' + label + '</option>';
    }).join('');
  }

  function renderMonthSummary(shifts, jobs, key) {
    var grid = document.getElementById('hoursSummaryGrid');
    var title = document.getElementById('finSummaryTitle');
    if (!grid) return;
    var cur = currentMonthKey();
    if (title) title.textContent = (key === cur ? 'This Month' : monthKeyLabel(key));
    var list = shiftsInMonth(shifts, key);
    if (!list.length) {
      grid.innerHTML = '<p class="empty-state">No shifts in ' + monthKeyLabel(key) + '.</p>';
      return;
    }
    var b = monthBounds(key);
    var tot = sumRange(shifts, jobs, b.start, b.end);
    grid.innerHTML =
      '<div class="earnings-cell">' +
        '<span class="cell-label">Take-home (net)</span>' +
        '<span class="cell-value">' + fmtMoney(tot.net) + '</span>' +
        '<span class="cell-sub">' + tot.hours.toFixed(1) + ' hrs · ' + list.length + (list.length === 1 ? ' shift' : ' shifts') + '</span>' +
      '</div>' +
      '<div class="earnings-cell">' +
        '<span class="cell-label">Gross</span>' +
        '<span class="cell-value">' + fmtMoney(tot.gross) + '</span>' +
        '<span class="cell-sub">before deductions</span>' +
      '</div>';
  }

  function renderMonthShifts(shifts, jobs, key) {
    var tbody = document.getElementById('hoursTableBody');
    var title = document.getElementById('finHistoryTitle');
    if (!tbody) return;
    if (title) title.textContent = 'Shifts · ' + monthKeyLabel(key);
    var list = shiftsInMonth(shifts, key).sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">No shifts this month.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (s) {
      var job = jobForShift(s, jobs);
      var hrs = shiftHours(s);
      var gross = hrs * job.hourlyRate;
      var pay = (calcFns[job.calcMode] || calcFns.flat)(gross, job);
      var dateLabel = new Date(s.date + 'T00:00:00').toLocaleDateString([], {
        weekday: 'short', month: 'short', day: 'numeric'
      });
      return '<tr>' +
        '<td>' + dateLabel + '</td>' +
        '<td>' + s.start + '–' + s.end + '</td>' +
        '<td>' + hrs.toFixed(1) + '</td>' +
        '<td class="muted">' + (s.status || '') + '</td>' +
        '<td>' + fmtMoney(gross) + '</td>' +
        '<td>' + fmtMoney(pay.net) + '</td>' +
      '</tr>';
    }).join('');
  }

  // Render the whole Finance page for the currently-selected month.
  function renderFinance() {
    var shifts = (financeState.data && financeState.data.shifts) || [];
    var jobs = financeState.jobs || loadJobs();
    var months = monthKeyRange(shifts);
    var cur = currentMonthKey();
    if (!financeState.key || months.indexOf(financeState.key) === -1) {
      financeState.key = months.indexOf(cur) !== -1 ? cur : months[0];
    }
    renderMonthSelect(months, financeState.key);
    renderMonthSummary(shifts, jobs, financeState.key);
    renderMonthShifts(shifts, jobs, financeState.key);

    var stamp = document.getElementById('hoursStamp');
    if (stamp) {
      stamp.textContent = 'Last synced: ' + (financeState.data && financeState.data.updated_at
        ? new Date(financeState.data.updated_at).toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
          })
        : '—');
    }
  }

  function bindFinancePicker() {
    if (financeState.bound) return;
    var sel = document.getElementById('finMonthSelect');
    if (!sel) return;
    financeState.bound = true;
    sel.addEventListener('change', function () { financeState.key = sel.value; renderFinance(); });
    function move(delta) { // +1 = older, -1 = newer (list is newest-first)
      var months = monthKeyRange((financeState.data && financeState.data.shifts) || []);
      var i = months.indexOf(financeState.key);
      var ni = i + delta;
      if (i === -1 || ni < 0 || ni >= months.length) return;
      financeState.key = months[ni];
      renderFinance();
    }
    var prev = document.getElementById('finPrev');
    var next = document.getElementById('finNext');
    if (prev) prev.addEventListener('click', function () { move(1); });
    if (next) next.addEventListener('click', function () { move(-1); });
  }

  function showEmpty(msg, withLink) {
    var body = document.getElementById('earningsBody');
    if (!body) return;
    var html = '<p class="empty-state">' + msg;
    if (withLink) {
      html += '<br><span class="link-btn" data-view="settings">Go to Settings →</span>';
    }
    html += '</p>';
    body.innerHTML = html;
  }

  function jobsSummary(jobs) {
    return jobs.map(function (j) {
      return { name: j.name, team: j.team, hourlyRate: j.hourlyRate };
    });
  }
  function roundTotals(t) {
    return { hours: +t.hours.toFixed(1), gross: +t.gross.toFixed(2), net: +t.net.toFixed(2) };
  }

  window.VesonEarnings = {
    // Compact, read-only snapshot for the AI command bar. Resolves a Promise
    // so callers get live Eitje data without re-implementing the fetch/calc.
    getSnapshot: function () {
      var code = localStorage.getItem(SYNC_KEY);
      var jobs = loadJobs();
      if (!code) return Promise.resolve({ hasCode: false, jobs: jobsSummary(jobs) });
      return fetchEitjeData(code).then(function (data) {
        var shifts = (data && data.shifts) || [];
        var today = startOfDay(new Date());
        var monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        var yearStart = new Date(today.getFullYear(), 0, 1);
        var todayShift = shifts.find(function (s) {
          return sameDay(new Date(s.date + 'T00:00:00'), today);
        });
        var upcoming = shifts.filter(function (s) {
          return startOfDay(new Date(s.date + 'T00:00:00')) >= today;
        }).sort(function (a, b) {
          return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
        }).slice(0, 8).map(function (s) {
          var job = jobForShift(s, jobs);
          return { date: s.date, start: s.start, end: s.end, hours: +shiftHours(s).toFixed(1), job: job.name };
        });
        return {
          hasCode: true,
          jobs: jobsSummary(jobs),
          month: roundTotals(sumRange(shifts, jobs, monthStart, null)),
          ytd: roundTotals(sumRange(shifts, jobs, yearStart, null)),
          today: todayShift ? { date: todayShift.date, start: todayShift.start, end: todayShift.end } : null,
          upcoming: upcoming,
          updatedAt: (data && data.updated_at) || null
        };
      }).catch(function () {
        return { hasCode: true, error: true, jobs: jobsSummary(jobs) };
      });
    },
    init: function () {
      var body = document.getElementById('earningsBody');
      if (!body) return;

      var jobs = loadJobs();
      var code = localStorage.getItem(SYNC_KEY);
      if (!code) {
        showEmpty('No sync code set yet.', true);
        return;
      }
      body.innerHTML = '<p class="empty-state">Loading…</p>';
      fetchEitjeData(code).then(function (data) {
        renderCard(data, jobs);
      }).catch(function () {
        showEmpty('Couldn\'t load Eitje data. Try again shortly.', false);
      });
    },
    initHoursPage: function () {
      var tbody = document.getElementById('hoursTableBody');
      var grid = document.getElementById('hoursSummaryGrid');
      if (!tbody || !grid) return;
      bindFinancePicker();

      var jobs = loadJobs();
      var sel = document.getElementById('finMonthSelect');
      var code = localStorage.getItem(SYNC_KEY);
      if (!code) {
        grid.innerHTML = '<p class="empty-state">No sync code set yet.<br><span class="link-btn" data-view="settings">Go to Settings &rarr;</span></p>';
        tbody.innerHTML = '<tr><td colspan="6" class="muted">No sync code set yet.</td></tr>';
        if (sel) sel.innerHTML = '<option>' + monthKeyLabel(currentMonthKey()) + '</option>';
        return;
      }
      tbody.innerHTML = '<tr><td colspan="6" class="muted">Loading…</td></tr>';
      grid.innerHTML = '<p class="empty-state">Loading…</p>';
      fetchEitjeData(code).then(function (data) {
        financeState.data = data;
        financeState.jobs = jobs;
        renderFinance();
      }).catch(function () {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">Couldn\'t load Eitje data. Try again shortly.</td></tr>';
        grid.innerHTML = '<p class="empty-state">Couldn\'t load Eitje data. Try again shortly.</p>';
      });
    }
  };
})();
