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

  window.VesonEarnings = {
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
    }
  };
})();
