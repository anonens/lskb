// GET  /api/sapaline            — admin only. Reports whether the service account is configured and,
//                                 when it is, the weeks SapaLine has for each line: { configured, lines }.
// POST /api/sapaline  { subject, line, month, week }
//                                 — logs in to SapaLine with the service account, reads that line's lessons
//                                 for the chosen subject + week, and returns the same JSON the bookmarklet
//                                 makes: { source:'sapaline', v:2, subject, line, period, rows:[…] }.
//                                 The admin page then runs it through the ordinary import (mergeSapa) and the
//                                 admin reviews the report before «Сақтау және жариялау». Nothing is written
//                                 to SapaLine — every request is read-only.
//
// The service account (a read-only SapaLine login) is set on Vercel → Settings → Environment Variables:
//   SAPALINE_EMAIL, SAPALINE_PASSWORD   — required
//   SAPALINE_URL, SAPALINE_ANON_KEY     — optional; default to SapaLine's own public Supabase project
import { readBody, send, fail, httpError, sameOrigin } from '../lib/http.js';
import { isAdmin } from '../lib/auth.js';

const DEFAULT_URL = 'https://vmmmtujfuxrfzsbgoxow.supabase.co';
// SapaLine's public (anon) Supabase key — the same one its own web app ships to every visitor.
// It opens nothing on its own: the service account's email + password are what grant access.
const DEFAULT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtbW10dWpmdXhyZnpzYmdveG93Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NTkzOTAsImV4cCI6MjA5MDQzNTM5MH0.5ZpzPCyppXTKWc1vY5yrselmdYtmdHQqPNfnfBiaKDo';

const LINES = ['smart', 'junior'];
const SUBJECTS = { math: 'math', matematika: 'math', математика: 'math', geo: 'geometry', geom: 'geometry', geometry: 'geometry', геометрия: 'geometry' };

function config() {
  const url = (process.env.SAPALINE_URL || DEFAULT_URL).replace(/\/+$/, '');
  const anon = process.env.SAPALINE_ANON_KEY || DEFAULT_ANON;
  const email = process.env.SAPALINE_EMAIL || '';
  const password = process.env.SAPALINE_PASSWORD || '';
  return { url, anon, email, password, configured: Boolean(email && password) };
}

// One access token is kept per server instance and reused until shortly before it expires.
let cached = { token: null, exp: 0 };

async function login(cfg) {
  const now = Date.now();
  if (cached.token && cached.exp - 60_000 > now) return cached.token;
  let r;
  try {
    r = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: cfg.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cfg.email, password: cfg.password }),
    });
  } catch (e) {
    throw httpError(502, 'SapaLine серверіне қосыла алмадық. Кейінірек қайталаңыз.', 'sapaline_unreachable');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const msg = r.status === 400 ? 'SapaLine логин/құпиясөзі қабылданбады. Vercel → Settings → Environment Variables: SAPALINE_EMAIL, SAPALINE_PASSWORD тексеріңіз.' : 'SapaLine-ға кіру сәтсіз аяқталды.';
    throw httpError(r.status === 400 ? 401 : 502, msg, 'sapaline_login_failed');
  }
  cached = { token: j.access_token, exp: now + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

async function rest(cfg, path, retried) {
  const token = await login(cfg);
  let r;
  try {
    r = await fetch(`${cfg.url}/rest/v1/${path}`, { headers: { apikey: cfg.anon, Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw httpError(502, 'SapaLine серверіне қосыла алмадық. Кейінірек қайталаңыз.', 'sapaline_unreachable');
  }
  if (r.status === 401 && !retried) {
    cached = { token: null, exp: 0 };
    return rest(cfg, path, true);
  }
  if (!r.ok) throw httpError(502, 'SapaLine деректерін оқу сәтсіз аяқталды (' + r.status + ').', 'sapaline_read_failed');
  return r.json();
}

// SapaLine stores a survey as { unady, ortasha, unamady, jalpy, qatysty, … }; the live-updated
// (survey_auto) numbers are the base, a hand-entered survey overrides them key by key.
function mergedSurvey(row) {
  const out = Object.assign({}, row.survey_auto || {});
  const s = row.survey || {};
  for (const k of Object.keys(s)) if (s[k] != null) out[k] = s[k];
  return out;
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toPayloadRow(row) {
  const s = mergedSurvey(row);
  const out = {
    num: String(row.id),
    date: row.lesson_date || '',
    time: String(row.time_from || '').slice(0, 5),
    teacher: String(row.teacher || '').trim(),
    agym: String(row.stream || '').trim(),
  };
  const liked = num(s.unady), avg = num(s.ortasha), disliked = num(s.unamady);
  // Only call it a survey when all three counts are present — a real SapaLine survey always has them.
  if (liked != null && avg != null && disliked != null) out.survey = { liked, avg, disliked };
  const present = num(s.qatysty), total = num(s.jalpy);
  if (present != null) out.present = present;
  if (total != null) out.total = total;
  return out;
}

async function periodsFor(cfg, line) {
  const rows = await rest(cfg, `live_sabaq_periods?division=eq.${line}&select=id,month,week`);
  return (rows || [])
    .map((p) => ({ id: p.id, month: Number(p.month), week: Number(p.week), label: `${p.month}-АЙ ${p.week}-АПТА` }))
    .filter((p) => p.month >= 1 && p.week >= 1)
    .sort((a, b) => b.month * 100 + b.week - (a.month * 100 + a.week));
}

export default async function handler(req, res) {
  try {
    if (!(await isAdmin(req))) throw httpError(401, 'Әкімші ретінде кіріңіз.');
    const cfg = config();

    if (req.method === 'GET') {
      if (!cfg.configured) return send(res, 200, { configured: false });
      const lines = {};
      for (const line of LINES) lines[line] = await periodsFor(cfg, line);
      return send(res, 200, { configured: true, lines });
    }

    if (req.method === 'POST') {
      if (!sameOrigin(req)) throw httpError(403, 'Рұқсат жоқ.');
      if (!cfg.configured) throw httpError(503, 'SapaLine сервистік аккаунты бапталмаған. Vercel → Settings → Environment Variables: SAPALINE_EMAIL және SAPALINE_PASSWORD қосыңыз.', 'sapaline_not_configured');
      const body = await readBody(req, 10_000);
      const subject = SUBJECTS[String(body.subject || '').trim().toLowerCase()];
      const line = String(body.line || '').trim().toLowerCase();
      if (!subject) throw httpError(400, 'Пән белгісіз. «math» немесе «geo» деп жіберіңіз.');
      if (!LINES.includes(line)) throw httpError(400, 'Желі белгісіз. «smart» немесе «junior» деп жіберіңіз.');

      const periods = await periodsFor(cfg, line);
      if (!periods.length) throw httpError(404, 'Бұл желіде SapaLine-да апта табылмады.', 'sapaline_no_periods');
      let period;
      if (body.month != null && body.week != null) {
        period = periods.find((p) => p.month === Number(body.month) && p.week === Number(body.week));
        if (!period) throw httpError(404, 'Таңдалған апта SapaLine-да табылмады.', 'sapaline_no_period');
      } else {
        period = periods[0]; // latest
      }

      const rows = await rest(cfg, `live_sabaq_rows?division=eq.${line}&subject=eq.${subject}&period_id=eq.${period.id}&select=id,position,lesson_date,time_from,teacher,stream,survey,survey_auto&order=position`);
      const payload = {
        source: 'sapaline',
        v: 2,
        subject,
        line,
        period: period.label,
        rows: (rows || []).map(toPayloadRow),
      };
      return send(res, 200, payload);
    }

    res.setHeader('Allow', 'GET, POST');
    throw httpError(405, 'Бұл әдіске рұқсат жоқ.');
  } catch (e) {
    fail(res, e);
  }
}
