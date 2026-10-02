/* "JUZ40 · SapaLine" bookmarklet. Runs on a SapaLine "Live Sabaq" page (e.g. /live-sabaq/smart/math),
   reads every lesson of the week shown (table layout on a wide screen, cards on a narrow one), opens each
   lesson's survey from the "Ұнау %" cell, reads Ұнады / Орташа / Ұнамады and closes it again.
   It never types anything into SapaLine. The result is JSON for the admin panel's import window.
   Built into a javascript: URL by the build scripts (comments and indentation are stripped, so every
   statement must end with a semicolon). */
(async function () {
  var D = document, W = window;
  if (W.__juz40busy) { return; }
  var BOX = 'juz40-sapa-box';
  var old = D.getElementById(BOX); if (old) { old.remove(); }
  var box = D.createElement('div'); box.id = BOX;
  box.setAttribute('style', 'position:fixed;z-index:2147483647;top:16px;right:16px;width:380px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;background:#0d1a52;color:#e8f0ff;font:14px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.45);padding:16px;text-align:left');
  D.body.appendChild(box);
  var stop = false, json = '';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var btn = function (x, label, main) { return '<button type="button" data-x="' + x + '" style="cursor:pointer;border:0;border-radius:999px;padding:9px 15px;margin:12px 8px 0 0;font-family:inherit;font-size:13px;font-weight:700;' + (main ? 'background:#93c2ff;color:#0d1a52' : 'background:rgba(232,240,255,.12);color:#e8f0ff') + '">' + label + '</button>'; };
  var show = function (html, buttons) { box.innerHTML = '<div style="font-weight:800;letter-spacing:.03em;margin-bottom:8px">JUZ40 · SapaLine</div><div>' + html + '</div><div>' + (buttons || '') + '</div>'; };
  var done = function (b) { if (b) { b.textContent = 'Көшірілді ✓'; } };
  box.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-x]') : null; if (!b) { return; }
    var x = b.getAttribute('data-x');
    if (x === 'close') { stop = true; box.remove(); return; }
    if (x === 'stop') { stop = true; return; }
    if (x === 'copy') {
      var ta = D.getElementById('juz40-json');
      var fallback = function () { try { ta.focus(); ta.select(); if (D.execCommand('copy')) { done(b); } } catch (e) {} };
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(json).then(function () { done(b); }, fallback); } else { fallback(); }
    }
  });

  if (!/(^|\.)sapaline\.app$/.test(location.hostname) || !/^\/live-sabaq\//.test(location.pathname)) {
    show('Бұл батырма SapaLine-дағы <b>Live Sabaq</b> бетінде жұмыс істейді. Математика немесе Геометрия бетін ашып, аптаны таңдап, қайта басыңыз.', btn('close', 'Жабу'));
    return;
  }
  var seg = location.pathname.split('/').filter(Boolean);
  var line = seg[1] || 'smart', subjRaw = (seg[2] || '').toLowerCase();
  var subject = /geo/.test(subjRaw) ? 'geometry' : /math/.test(subjRaw) ? 'math' : subjRaw;
  var pm = /Live Sabaq\s*·\s*(\d+)\s*-\s*АЙ\s*(\d+)\s*-\s*АПТА/.exec(D.body.innerText || '');
  if (!pm) {
    show('Апта табылмады. Бет толық жүктелгенін күтіп, қайта басыңыз.', btn('close', 'Жабу'));
    return;
  }
  var period = pm[1] + '-АЙ ' + pm[2] + '-АПТА';

  var sleep = function (ms) {
    return new Promise(function (res) {
      var end = Date.now() + ms;
      if (!D.hidden) { setTimeout(res, ms); return; }
      var ch = new MessageChannel();
      ch.port1.onmessage = function () { if (Date.now() >= end) { ch.port1.close(); res(); } else { ch.port2.postMessage(0); } };
      ch.port2.postMessage(0);
    });
  };
  var waitFor = async function (fn, t) { var t0 = Date.now(); while (Date.now() - t0 < t) { var v = fn(); if (v) { return v; } await sleep(100); } return null; };
  var vis = function (e) { return !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length)); };
  var txt = function (e) { return e ? (e.innerText || '').trim() : ''; };

  var items = [];
  var table = Array.prototype.find.call(D.querySelectorAll('table'), function (t) { return vis(t) && Array.prototype.some.call(t.querySelectorAll('thead th'), function (th) { return txt(th) === 'Ұнау %'; }); });
  if (table) {
    var ths = Array.prototype.map.call(table.querySelectorAll('thead th'), txt);
    var col = function (n) { return ths.indexOf(n); };
    var C = { date: col('Күні'), time: col('Уақыты'), teacher: col('Мұғалім'), potok: col('Поток'), agym: col('Ағым'), like: col('Ұнау %'), att: col('Қатысым %') };
    Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (tr) {
      if (tr.children.length < ths.length - 1) { return; }
      var cell = function (i) { return i >= 0 ? tr.children[i] : null; };
      var val = function (i) {
        var c = cell(i); if (!c) { return null; }
        var inp = c.querySelector('input,textarea,select'); if (inp) { return (inp.value || '').trim(); }
        var b = c.querySelector('button[data-cell]'); return txt(b || c);
      };
      var likeCell = cell(C.like);
      items.push({ num: txt(cell(0)).replace(/[^\d]/g, ''), date: val(C.date), time: val(C.time), teacher: val(C.teacher), potok: val(C.potok), agym: val(C.agym), like: val(C.like), att: val(C.att), likeBtn: likeCell ? likeCell.querySelector('button[data-cell]') : null });
    });
  } else {
    var fieldEl = function (card, name) {
      var lab = Array.prototype.find.call(card.querySelectorAll('*'), function (e) { return e.children.length === 0 && (e.textContent || '').trim() === name; });
      if (!lab) { return null; }
      var c = lab.parentElement;
      for (var i = 0; i < 4 && c; i++) {
        var inp = c.querySelector('input, textarea, select'), b = c.querySelector('button[data-cell]');
        if (inp || b) { return { inp: inp, btn: b }; }
        var t = (c.innerText || '').replace(name, '').trim(); if (t) { return { txt: t }; }
        c = c.parentElement;
      }
      return null;
    };
    var cval = function (card, n) { var f = fieldEl(card, n); if (!f) { return null; } if (f.inp) { return f.inp.value; } if (f.btn) { return txt(f.btn); } return f.txt || null; };
    Array.prototype.forEach.call(D.querySelectorAll('.row-cards > div.rounded-xl'), function (card) {
      var lf = fieldEl(card, 'Ұнау %');
      items.push({ num: ((card.innerText || '').match(/№\s*(\d+)/) || [])[1], date: cval(card, 'Күні'), time: cval(card, 'Уақыты'), teacher: cval(card, 'Мұғалім'), potok: cval(card, 'Поток'), agym: cval(card, 'Ағым'), like: cval(card, 'Ұнау %'), att: cval(card, 'Қатысым %'), likeBtn: lf && lf.btn });
    });
  }
  items = items.filter(function (r) { return r.teacher || r.agym; });
  if (!items.length) {
    show('Бұл аптада сабақ табылмады. Бет толық жүктелгенін күтіп, қайта басыңыз.', btn('close', 'Жабу'));
    return;
  }

  var surveyDlg = function () { return Array.prototype.find.call(D.querySelectorAll('[role=dialog]'), function (d) { return vis(d) && d.querySelector('input[aria-label="Ұнады"]'); }); };
  var readSurvey = async function (b) {
    b.scrollIntoView({ block: 'center' }); await sleep(120);
    b.click();
    var dlg = await waitFor(surveyDlg, 6000);
    if (!dlg) { return { err: 'no dialog' }; }
    if (D.activeElement && D.activeElement.blur) { D.activeElement.blur(); }
    var get = function (l) { var i = dlg.querySelector('input[aria-label="' + l + '"]'); return i ? i.value : null; };
    var r = { liked: get('Ұнады'), avg: get('Орташа'), disliked: get('Ұнамады'), total: get('Жалпы'), present: get('Қатысты'), polled: get('Опрос өтті') };
    var close = Array.prototype.find.call(dlg.querySelectorAll('button'), function (x) { return txt(x) === 'Close' || x.getAttribute('aria-label') === 'Close'; });
    if (close) { close.click(); } else { D.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
    await waitFor(function () { return !surveyDlg(); }, 4000); await sleep(150);
    return r;
  };

  W.__juz40busy = true;
  try {
    for (var i = 0; i < items.length; i++) {
      if (stop) { break; }
      show('Оқылып жатыр: <b>' + (i + 1) + ' / ' + items.length + '</b> сабақ…<br><span style="opacity:.7">Бетті жаппаңыз және ештеңе баспаңыз.</span>', btn('stop', 'Тоқтату'));
      var it = items[i];
      if (it.likeBtn && /\d/.test(it.like || '')) { it.survey = await readSurvey(it.likeBtn); }
    }
  } finally { W.__juz40busy = false; }
  if (stop) { if (box.isConnected) { show('Тоқтатылды.', btn('close', 'Жабу')); } return; }

  var rows = items.map(function (r) { return { num: r.num, date: r.date, time: r.time, teacher: r.teacher, potok: r.potok, agym: r.agym, like: r.like, att: r.att, survey: r.survey || null }; });
  var payload = { source: 'sapaline', v: 1, subject: subject, line: line, period: period, url: location.href, at: new Date().toISOString(), rows: rows };
  json = JSON.stringify(payload);
  var withS = rows.filter(function (r) { return r.survey && !r.survey.err; }).length;
  var miss = rows.filter(function (r) { return !(r.survey && !r.survey.err); });
  var subjName = subject === 'geometry' ? 'Геометрия' : subject === 'math' ? 'Математика' : subject;
  show('<b>' + esc(subjName) + ' · ' + esc(period) + '</b><br>' + rows.length + ' сабақ, сауалнамасы бар: <b>' + withS + '</b>' +
    (miss.length ? '<br><span style="opacity:.75">Сауалнамасыз: ' + esc(miss.slice(0, 6).map(function (r) { return r.date + ' ' + r.teacher; }).join('; ')) + (miss.length > 6 ? ' …' : '') + '</span>' : '') +
    '<br><br>«Көшіру» басып, JUZ40 әкімші панеліндегі <b>SapaLine-нан импорттау</b> терезесіне қойыңыз.' +
    '<textarea id="juz40-json" readonly style="display:block;width:100%;box-sizing:border-box;height:72px;margin-top:10px;border-radius:10px;border:1px solid rgba(232,240,255,.25);background:rgba(0,0,0,.25);color:#e8f0ff;font:11px/1.35 ui-monospace,Menlo,monospace;padding:8px">' + esc(json) + '</textarea>',
    btn('copy', 'Көшіру', true) + btn('close', 'Жабу'));
})();
