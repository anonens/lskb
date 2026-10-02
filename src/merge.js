/* Merges one SapaLine week into the site state (in place) and returns a report.
   payload is what the "JUZ40 · SapaLine" bookmarklet (and the weekly task) produce:
   { subject: 'math' | 'geometry', line: 'smart', period: '3-АЙ 4-АПТА',
     rows: [{ date, time, teacher, potok, agym, like, survey: { liked, avg, disliked } }] }
   Per teacher + stream the week's survey counts are summed over every lesson that has a survey;
   the page then shows like% = liked / (liked + avg + disliked).
   A missing month / week / teacher / stream / assignment is created (a new month copies the last
   month's "who teaches where" list). Notes the admin already wrote for that week are kept. */
function mergeSapa(state, payload, opts) {
  opts = opts || {};
  var makeId = opts.uid || function (p) { return p + '_' + Math.random().toString(36).slice(2, 9); };
  function fail(msg) { var e = new Error(msg); e.code = 'bad_import'; throw e; }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function int(v) { var n = parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10); return isNaN(n) ? 0 : n; }
  function find(arr, fn) { for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return arr[i]; return null; }
  function idFree(prefix, wanted) {
    var used = {};
    state.months.forEach(function (m) { used[m.id] = 1; m.weeks.forEach(function (w) { used[w.id] = 1; }); });
    return used[wanted] ? makeId(prefix) : wanted;
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) fail('Бұл SapaLine деректеріне ұқсамайды: «rows» тізімі жоқ.');
  var subj = norm(payload.subject);
  var subject = /^(geo|geom|geometry|геометрия)$/.test(subj) ? 'geo' : /^(math|mat|matematika|математика)$/.test(subj) ? 'math' : null;
  if (!subject) {
    var codes = payload.rows.map(function (r) { return norm(r && r.agym); }).join(' ');
    subject = /геом/.test(codes) ? 'geo' : /мат/.test(codes) ? 'math' : null;
  }
  if (!subject) fail('Пән анықталмады: SapaLine-да Математика немесе Геометрия бетін ашып көшіріңіз.');
  var pm = /(\d+)\s*-\s*АЙ\s*(\d+)\s*-\s*АПТА/i.exec(String(payload.period || ''));
  if (!pm) fail('Апта анықталмады: кезең «3-АЙ 4-АПТА» түрінде болуы керек.');
  var monN = +pm[1], weekN = +pm[2];
  var period = monN + '-АЙ ' + weekN + '-АПТА';
  var lineName = String(payload.line || 'smart').trim().toUpperCase() || 'SMART';
  var report = { subject: subject, period: period, created: [], added: [], missing: [], lines: [], lessons: 0, updated: 0 };

  // month + week
  var month = find(state.months, function (m) { return norm(m.label) === norm(monN + '-АЙ'); });
  if (!month) {
    var prev = state.months[state.months.length - 1];
    month = { id: idFree('m', 'm_' + monN), label: monN + '-АЙ', weeks: [], assignments: [] };
    if (prev) month.assignments = prev.assignments.map(function (a) { return { id: makeId('a'), teacherId: a.teacherId, subject: a.subject, streamId: a.streamId, line: a.line || 'SMART' }; });
    state.months.push(month);
    report.created.push('ай ' + month.label + (prev ? ' (тізім ' + prev.label + ' айынан көшірілді)' : ''));
  }
  var week = find(month.weeks, function (w) { return norm(w.label) === norm(weekN + '-АПТА'); });
  if (!week) {
    week = { id: idFree('w', 'w_' + monN + '_' + weekN), label: weekN + '-АПТА', published: false };
    month.weeks.push(week);
    month.weeks.sort(function (a, b) { var x = /(\d+)/.exec(a.label), y = /(\d+)/.exec(b.label); return (x ? +x[1] : 99) - (y ? +y[1] : 99); });
    report.created.push('апта ' + period);
  }
  report.weekId = week.id; report.monthId = month.id;

  // lookups
  var byName = {};
  state.teachers.forEach(function (t) {
    [t.sapa, t.full].forEach(function (n) { if (n) byName[norm(n)] = t; });
    var two = String(t.full || '').trim().split(/\s+/).slice(0, 2).join(' ');
    if (two && !byName[norm(two)]) byName[norm(two)] = t;
  });
  var byCode = {};
  state.streams.forEach(function (s) { if (s.code) byCode[norm(s.code)] = s; });

  var acc = {}, order = [], dates = {};
  payload.rows.forEach(function (r) {
    r = r || {};
    var name = String(r.teacher || '').replace(/\s+/g, ' ').trim(), code = String(r.agym || '').replace(/\s+/g, ' ').trim();
    var s = r.survey;
    var counts = s && !s.err ? { liked: int(s.liked), avg: int(s.avg), disliked: int(s.disliked) } : null;
    if (!name || !code || !counts || counts.liked + counts.avg + counts.disliked === 0) {
      report.missing.push([r.date, r.time, name || '?'].filter(Boolean).join(' '));
      return;
    }
    var t = byName[norm(name)];
    if (!t) {
      var parts = name.split(' '), given = parts.length > 1 ? parts[1] : parts[0];
      var female = /(қызы|кызы|ова|ева|ина|ская)$/i.test(parts[0]);
      t = { id: makeId('t'), full: name, display: given + (female ? ' апай' : ' ағай'), sapa: name };
      state.teachers.push(t); byName[norm(name)] = t;
      report.added.push('мұғалім ' + name + ' → «' + t.display + '» (атын, фотосын тексеріңіз)');
    } else if (!t.sapa) {
      t.sapa = name;
    }
    var st = byCode[norm(code)];
    if (!st) {
      st = { id: makeId('s'), code: code, name: '' };
      state.streams.push(st); byCode[norm(code)] = st;
      report.added.push('поток ' + code);
    }
    var a = find(month.assignments, function (x) { return x.teacherId === t.id && x.subject === subject && x.streamId === st.id; });
    if (!a) {
      a = { id: makeId('a'), teacherId: t.id, subject: subject, streamId: st.id, line: lineName };
      month.assignments.push(a);
      report.added.push(month.label + ': ' + t.display + ' · ' + st.code);
    }
    if (!acc[a.id]) { acc[a.id] = { liked: 0, avg: 0, disliked: 0, lessons: 0 }; order.push(a.id); dates[a.id] = {}; }
    var c = acc[a.id];
    c.liked += counts.liked; c.avg += counts.avg; c.disliked += counts.disliked; c.lessons += 1;
    if (r.date) dates[a.id][r.date] = 1;
    report.lessons += 1;
  });

  if (!state.results[week.id]) state.results[week.id] = {};
  var res = state.results[week.id];
  // replace this subject's SapaLine numbers for the week; keep notes the admin already wrote,
  // and leave rows that were typed in by hand (their source is not SapaLine) as they are
  month.assignments.forEach(function (a) {
    var old = res[a.id];
    if (a.subject !== subject || acc[a.id] || !old || !/^SapaLine/.test(old.src || '')) return;
    if (old.notes && old.notes.length) res[a.id] = { notes: old.notes };
    else delete res[a.id];
  });
  function dkey(d) { var m = /^(\d{1,2})\.(\d{1,2})/.exec(d); return m ? (+m[2]) * 100 + (+m[1]) : 9999; }
  order.forEach(function (id) {
    var c = acc[id], before = res[id] || {};
    var ds = Object.keys(dates[id]).sort(function (x, y) { return dkey(x) - dkey(y); });
    res[id] = { liked: c.liked, avg: c.avg, disliked: c.disliked, lessons: c.lessons, notes: before.notes || [], src: 'SapaLine · ' + period + (ds.length ? ' · ' + ds.join(', ') : '') };
    var a = find(month.assignments, function (x) { return x.id === id; });
    var t = find(state.teachers, function (x) { return x.id === a.teacherId; });
    var st = find(state.streams, function (x) { return x.id === a.streamId; });
    var T = c.liked + c.avg + c.disliked;
    report.lines.push({ code: st ? st.code : '', name: t ? t.display : '', liked: c.liked, avg: c.avg, disliked: c.disliked, lessons: c.lessons, pct: T ? 100 * c.liked / T : null });
  });
  if (!Object.keys(res).length) delete state.results[week.id];
  report.updated = order.length;
  if (opts.publish && order.length) week.published = true;
  report.published = !!week.published;
  return report;
}
