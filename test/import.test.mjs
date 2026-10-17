import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { validateState, publicView } from '../lib/validate.js';
import { migrateState } from '../lib/migrations.js';

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync('src/merge.js', 'utf8'), ctx);
const seed = JSON.parse(fs.readFileSync('seed/data.json', 'utf8'));
const state = () => structuredClone(seed.state);
const row = (extra = {}) => ({ num: '1', date: '12.10.2026', time: '10:00', teacher: 'Қуаныш Нұрдәулет', agym: 'ГЕОМ-21', survey: { liked: 8, avg: 1, disliked: 1, present: 80, total: 100 }, ...extra });
const payload = rows => ({ source: 'sapaline', subject: 'geometry', line: 'smart', period: '4-АЙ 1-АПТА', rows });
const merge = (st, rows) => ctx.mergeSapa(st, payload(rows), { publish: true });
const result = (st, rep) => st.results[rep.weekId][st.months.find(m => m.id === rep.monthId).assignments.find(a => a.teacherId === 't_kuanysh' && st.streams.find(s => s.id === a.streamId)?.code === 'ГЕОМ-21' && a.subject === 'geo' && a.line === 'SMART').id];

// Different class sizes must use summed counts, not an average of percentages.
let st = state();
let rep = merge(st, [row(), row({ num: '2', time: '11:00', survey: { liked: 3, avg: 2, disliked: 0, present: 10, total: 20 } })]);
let r = result(st, rep);
assert.equal(r.present, 90); assert.equal(r.total, 120); assert.equal(ctx.attendanceOf(r), 75);
assert.equal(r.attendanceLessons, 2); assert.equal(r.attendanceMode, 'weighted');
assert.equal(r.liked, 11); assert.equal(rep.lessons, 2);
assert.equal(st.teachers.filter(t => t.id === 't_kuanysh').length, 1, 'no duplicate teacher');
r.notes = ['Өте жақсы', '- Ұсыныс'];
const aid = st.months.find(m => m.id === rep.monthId).assignments.find(a => st.results[rep.weekId][a.id] === r).id;
st.results[rep.weekId].a_retained = { liked: 9, avg: 1, disliked: 0, notes: ['keep'], src: 'SapaLine' };
st.months.find(m => m.id === rep.monthId).assignments.push({ id: 'a_retained', teacherId: 't_beket', subject: 'geo', streamId: st.streams[0].id, line: 'SMART' });
rep = merge(st, [row(), row()]); r = result(st, rep);
assert.equal(r.present, 80); assert.equal(r.total, 100); assert.equal(r.liked, 8, 'reimport replaces rather than adds');
assert.equal(rep.duplicates, 1); assert.deepEqual([...r.notes], ['Өте жақсы', '- Ұсыныс']);
assert.ok(rep.retained.includes('a_retained')); assert.equal(st.results[rep.weekId].a_retained.liked, 9);
assert.equal(st.results[rep.weekId][aid], r);
// No survey is needed for attendance. Zero attendance is data, not missing.
st = state(); rep = merge(st, [row({ survey: null, att: '0%' }), row({ num: '2', survey: null, att: '60,5 %' })]); r = result(st, rep);
assert.equal(r.attendancePct, 30.25); assert.equal(r.attendanceMode, 'average'); assert.equal(r.liked, undefined);
assert.equal(ctx.attendanceOf(r), 30.25); assert.equal(rep.lessons, 0);
// Mixed availability uses a clearly marked mean of lesson percentages.
st = state(); rep = merge(st, [row(), row({ num: '2', survey: null, att: '50%' })]);
assert.equal(result(st, rep).attendancePct, 65); assert.equal(result(st, rep).total, undefined);
assert.equal(result(st, rep).attendanceMode, 'average');
// Old imports remain usable, without inventing attendance or erasing known attendance.
st = state(); rep = merge(st, [row()]);
rep = merge(st, [row({ survey: { liked: 1, avg: 0, disliked: 0 } })]);
assert.equal(ctx.attendanceOf(result(st, rep)), 80);
// Reversed teacher names find the same identity; SMART and JUNIOR remain separate.
st = state(); rep = merge(st, [row({ teacher: 'Нұрдәулет Қуаныш' })]);
const junior = ctx.mergeSapa(st, { ...payload([row()]), line: 'junior' });
assert.equal(Object.keys(st.results[rep.weekId]).length, 2);
assert.equal(junior.updated, 1);
// A broken copy (empty, an unread survey) is rejected atomically, preserving existing results and weeks.
for (const rows of [[], [row({ survey: { err: 'no dialog' } })], [row({ survey: null, like: '80%' })], [row({ agym: '' })]]) {
  st = state(); const before = JSON.stringify(st);
  assert.throws(() => merge(st, rows), e => e.code === 'bad_import');
  assert.equal(JSON.stringify(st), before);
}
// Odd numbers in SapaLine itself become warnings; the rest is still counted.
st = state(); rep = merge(st, [row({ survey: { liked: 8, avg: 1, disliked: 1, present: 101, total: 100 } }), row({ num: '2', time: '11:00', survey: { liked: 3, avg: 2, disliked: 0, present: 10, total: 20 } })]); r = result(st, rep);
assert.equal(rep.warnings.length, 1); assert.match(rep.warnings[0], /^Қатысты саны \(101\) жалпы саннан \(100\) артық: 12\.10\.2026 10:00 Қуаныш Нұрдәулет — .*ұнатуы саналды$/);
assert.equal(r.liked, 11, 'likes of that lesson still count'); assert.equal(r.lessons, 2);
assert.equal(r.present, 10); assert.equal(r.total, 20); assert.equal(ctx.attendanceOf(r), 50, 'attendance without that lesson');
assert.equal(rep.attendanceMissing.length, 0, 'listed once, as a warning');
st = state(); rep = merge(st, [row({ survey: { liked: 8, avg: 1, disliked: 1, present: 101, total: 100 } })]); r = result(st, rep);
assert.equal(r.liked, 8); assert.equal(ctx.attendanceOf(r), null); assert.equal(rep.warnings.length, 1);
st = state(); rep = merge(st, [row({ survey: { liked: '-2', avg: 1, disliked: 0, present: 80, total: 100 } })]); r = result(st, rep);
assert.match(rep.warnings[0], /Сауалнама саны дұрыс емес \(Ұнады: «-2»\)/); assert.equal(r.liked, undefined); assert.equal(ctx.attendanceOf(r), 80);
assert.equal(rep.missing.length, 0);
st = state(); rep = merge(st, [row({ agym: '' }), row({ num: '2', time: '11:00' })]); r = result(st, rep);
assert.match(rep.warnings[0], /^Мұғалімі немесе ағымы жазылмаған сабақ есепке алынбады: 12\.10\.2026 10:00/); assert.equal(r.liked, 8); assert.equal(r.lessons, 1);
st = state(); rep = merge(st, [row(), row({ survey: { liked: 9, avg: 0, disliked: 0 } })]); r = result(st, rep);
assert.match(rep.warnings[0], /^Бір сабақтың екі түрлі жолы бар, біріншісі алынды/); assert.equal(r.liked, 8); assert.equal(rep.duplicates, 0);
st = state(); rep = merge(st, [row()]); assert.deepEqual([...rep.warnings], [], 'a clean export has no warnings');
// More present than enrolled, typed in the admin panel, is saved as typed.
st = state(); rep = merge(st, [row()]);
Object.assign(result(st, rep), { present: 105, total: 100, attendancePct: 95 });
assert.equal(validateState(st).results[rep.weekId][Object.keys(st.results[rep.weekId])[0]].present, 105);
st = state(); rep = merge(st, [row()]);
const saved = validateState(st), stored = saved.results[rep.weekId][Object.keys(st.results[rep.weekId])[0]];
assert.equal(stored.present, 80); assert.equal(stored.total, 100); assert.equal(stored.attendancePct, 80);
assert.equal(stored.attendanceLessons, 1); assert.equal(stored.attendanceMode, 'weighted');
assert.ok(publicView({ state: saved }).state.results[rep.weekId], 'published attendance reaches visitors');
assert.equal(ctx.attendanceOf({ attendancePct: '' }), null);
assert.equal(ctx.attendanceOf({ attendancePct: 0 }), 0);
assert.equal(ctx.attendanceOf({ present: 0, total: 10 }), 0);
const old = { teachers: [{ id: 't_kuanysh', full: 'Нұрдәулет Қуаныш', display: 'Қуаныш ағай' }, { id: 't_kulakhmet', display: 'Нұрдәулет ағай', full: 'Құлахмет Нұрдәулет Нұрқанатұлы' }] };
migrateState(old); assert.equal(old.teachers[0].display, 'Нұрдәулет ағай'); assert.equal(old.teachers[0].full, 'Қуаныш Нұрдәулет');
assert.equal(old.teachers[1].full, 'Құлахмет Нұрдәулет Нұрқанатұлы');
assert.deepEqual(migrateState(structuredClone(old)), old, 'migration is idempotent');
// Public HTML supports attendance-only rows and a clear missing state.
const app = fs.readFileSync('src/app.js', 'utf8');
vm.runInContext(`var num=v=>Math.max(0,parseInt(v,10)||0), clamp=(v,a,b)=>Math.min(b,Math.max(a,v)), esc=s=>String(s??''), fmtInt=String, fmtPct=v=>v==null?'—':String(v), curPhotos=()=>({}), emblemSVG=()=>'', initials=()=>'', isTip=()=>false, stripTip=s=>s;` + app.slice(app.indexOf('function pctOf('), app.indexOf('function codeOf(')) + app.slice(app.indexOf('function votesHTML('), app.indexOf('function outroHTML(')), ctx);
const entry = { a: { subject: 'geo', line: 'SMART' }, t: { id: 't_kuanysh', display: 'Нұрдәулет ағай' }, s: { code: 'ГЕОМ-21' }, r: { attendancePct: 0 } };
const html = ctx.teacherHTML(saved, entry, 0, '4-АЙ 1-АПТА');
assert.match(html, /Қатысым пайызы/); assert.match(html, /<strong>0%<\/strong>/); assert.ok(!html.includes('NaN'));
assert.match(ctx.attendanceHTML({}), /Дерек әлі енгізілмеген/);
console.log('✓ Import aggregation, safe reimport, attendance, migration and public rendering');
