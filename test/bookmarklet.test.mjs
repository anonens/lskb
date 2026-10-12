// DOM fixtures reflect the table/cards and survey controls used by the existing Sapaline integration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('src/bookmarklet.js', 'utf8');
const visible = { offsetWidth: 100, offsetHeight: 20, getClientRects: () => [{}] };
async function extract({ mobile = false, hidden = false, periodChanges = false, like = '80%', att = '80,5%', empty = false, headers = ['№', 'Күні', 'Уақыты', 'Мұғалім', 'Поток', 'Ағым', 'Ұнау   %', 'Қатысым %'] } = {}) {
  let dialog = null;
  const values = ['1', '12.10.2026', '10:00', 'Қуаныш Нұрдәулет', '21', 'ГЕОМ-21', like, att];
  const box = { innerHTML: '', isConnected: true, setAttribute() {}, addEventListener() {}, remove() { this.isConnected = false; } };
  const inputValues = { 'Ұнады': '80', 'Орташа': '15', 'Ұнамады': '5', 'Жалпы': '100', 'Қатысты': '80', 'Опрос өтті': '90' };
  const button = { innerText: like, getAttribute: () => null, disabled: false, scrollIntoView() {}, click() {
    const close = { innerText: 'Close', getAttribute: () => 'Close', click() { dialog = null; } };
    dialog = { ...visible, querySelector(selector) { const label = selector.match(/aria-label="([^"]+)"/)?.[1]; return label && label in inputValues ? { value: inputValues[label] } : null; }, querySelectorAll: () => [close] };
    if (periodChanges) body.innerText = 'Live Sabaq · 4-АЙ 2-АПТА';
  } };
  const cells = values.map((v, i) => ({ innerText: v, querySelector: selector => i === 6 && selector.startsWith('button') ? button : null }));
  const tr = { ...(hidden ? { offsetWidth: 0, offsetHeight: 0, getClientRects: () => [] } : visible), children: cells };
  const table = { ...visible, querySelectorAll: selector => selector === 'thead th' ? headers.map(innerText => ({ innerText })) : empty ? [] : [tr] };
  const fields = headers.slice(1).map((h, i) => {
    const el = { children: [], textContent: h };
    el.parentElement = { querySelector: selector => i === 5 && selector.startsWith('button') ? button : selector.startsWith('input') ? { value: values[i + 1] } : null, innerText: h + '\n' + values[i + 1] };
    return el;
  });
  const card = { ...visible, innerText: '№ 1', querySelectorAll: () => fields };
  const body = { innerText: 'Live Sabaq · 4–АЙ 1–АПТА', appendChild() {} };
  const document = { body, hidden: false, activeElement: null, getElementById: () => null, createElement: () => box, querySelectorAll(selector) {
    if (selector === 'table') return mobile ? [] : [table];
    if (selector === '[role=dialog]') return dialog ? [dialog] : [];
    if (selector === '.row-cards > div.rounded-xl') return empty ? [] : [card];
    return [];
  }, dispatchEvent() {} };
  const ctx = vm.createContext({ document, window: {}, location: { hostname: 'sapaline.app', pathname: '/live-sabaq/smart/geometry', href: 'https://sapaline.app/live-sabaq/smart/geometry' }, navigator: {}, setTimeout: fn => fn(), KeyboardEvent: class {}, console });
  await vm.runInContext(source, ctx);
  const raw = box.innerHTML.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)?.[1];
  return { html: box.innerHTML, payload: raw ? JSON.parse(raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) : null, busy: ctx.window.__juz40busy };
}
for (const mobile of [false, true]) {
  const out = await extract({ mobile });
  assert.equal(out.payload.v, 2); assert.equal(out.payload.period, '4-АЙ 1-АПТА');
  assert.equal(out.payload.subject, 'geometry'); assert.equal(out.payload.rows.length, 1);
  assert.equal(out.payload.rows[0].survey.present, '80'); assert.equal(out.payload.rows[0].survey.total, '100');
  assert.equal(out.payload.rows[0].att, '80,5%'); assert.equal(out.busy, false);
}
const attendanceOnly = await extract({ like: '—', att: '0%' });
assert.equal(attendanceOnly.payload.rows[0].survey, null); assert.equal(attendanceOnly.payload.rows[0].att, '0%');
assert.equal((await extract({ empty: true })).payload, null);
assert.equal((await extract({ hidden: true })).payload, null);
const changed = await extract({ periodChanges: true }); assert.equal(changed.payload, null); assert.match(changed.html, /апта өзгерді/);
const columns = await extract({ headers: ['№', 'Күні', 'Уақыты', 'Teacher', 'Поток', 'Ағым', 'Ұнау %', 'Қатысым %'] });
assert.equal(columns.payload, null); assert.match(columns.html, /Кесте бағандары өзгерген/);
console.log('✓ Sapaline table/card extraction, counts, attendance-only export and changed-page guards');
