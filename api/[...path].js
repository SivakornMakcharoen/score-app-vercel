'use strict';
// API ทั้งหมดของระบบกรอกคะแนน รันเป็น Vercel Function เดียว (ดักทุก /api/*)
const crypto = require('node:crypto');
const { query } = require('../lib/db');

const MAX = 200;                 // เพดานจำนวนต่อกิจกรรม
const API_LIMIT = 60;            // คำขอต่อนาทีต่อ IP (ผู้ใช้หลายคนในที่เดียวกันมักใช้ IP เดียวกัน จึงไม่ตั้งต่ำเกินไป)
const LOGIN_LIMIT = 5;           // ล็อกอินผิดได้กี่ครั้งต่อ 15 นาที
const SESSION_MS = 8 * 3600e3;

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const cleanNick = s => typeof s === 'string' ? s.trim().normalize('NFC') : '';
const nickOk = n => { const len = [...n].length; return len >= 1 && len <= 20 && !/[<>&"\u0000-\u001f]/.test(n); };
const aboOk = a => typeof a === 'string' && /^\d{4}$/.test(a);
const cOk = c => Array.isArray(c) && c.length === 5 && c.every(x => Number.isInteger(x) && x >= 0 && x <= MAX);
const result = r => r && { total: r.total, c: [r.c1, r.c2, r.c3, r.c4, r.c5] };
const isUnique = e => e && e.code === '23505';

function send(res, code, obj, extra = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}
const ipOf = req => String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
const cookieOf = (req, k) => (req.headers.cookie || '').split(';').map(s => s.trim().split('=')).find(p => p[0] === k)?.[1];

function body(req) {
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) throw new Error('invalid');
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { throw new Error('invalid'); } }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('invalid');
  return b;
}

// ---------- rate limit (เก็บใน DB เพราะ serverless ไม่มีหน่วยความจำร่วมกัน) ----------
async function hit(key, windowMs) {
  const bucket = Math.floor(Date.now() / windowMs), exp = (bucket + 1) * windowMs;
  const r = await query(
    'insert into rate_limits(k,bucket,n,exp) values($1,$2,1,$3) on conflict(k,bucket) do update set n = rate_limits.n + 1 returning n',
    [key, bucket, exp]);
  return r.rows[0].n;
}
async function peek(key, windowMs) {
  const r = await query('select n from rate_limits where k = $1 and bucket = $2', [key, Math.floor(Date.now() / windowMs)]);
  return r.rows[0] ? r.rows[0].n : 0;
}
async function cleanup() {
  const now = Date.now();
  await query('delete from rate_limits where exp < $1', [now]);
  await query('delete from admin_sessions where exp < $1', [now]);
}

// ---------- เซสชัน admin (เก็บ hash ของ token ใน DB ออกจากระบบแล้วใช้ต่อไม่ได้จริง) ----------
async function isAdmin(req) {
  const t = cookieOf(req, 'sid');
  if (!t || !/^[0-9a-f]{64}$/.test(t)) return false;
  const r = await query('select exp from admin_sessions where token_hash = $1', [sha(t).toString('hex')]);
  return !!(r.rows[0] && Number(r.rows[0].exp) > Date.now());
}

module.exports = async function handler(req, res) {
  try {
    const url = (req.url || '/').split('?')[0].replace(/\/+$/, ''), m = req.method;
    if (!url.startsWith('/api/')) return send(res, 404, { error: 'not_found' });

    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
    if (ADMIN_PASSWORD.length < 12) { console.error('ADMIN_PASSWORD ต้องยาวอย่างน้อย 12 ตัวอักษร'); return send(res, 500, { error: 'server' }); }

    const ip = ipOf(req);
    if (await hit('api:' + ip, 60e3) > API_LIMIT) return send(res, 429, { error: 'rate' });
    if (Math.random() < 0.02) cleanup().catch(() => {});

    if (m === 'POST' && url === '/api/submit') {
      const b = body(req), n = cleanNick(b.nick);
      if (!nickOk(n) || !aboOk(b.abo) || !cOk(b.c)) return send(res, 400, { error: 'invalid' });
      try {
        const r = await query('insert into submissions(nickname,abo4,c1,c2,c3,c4,c5) values($1,$2,$3,$4,$5,$6,$7) returning *', [n, b.abo, ...b.c]);
        return send(res, 200, result(r.rows[0]));
      } catch (e) {
        if (isUnique(e)) return send(res, 409, { error: 'duplicate' });
        throw e;
      }
    }
    if (m === 'POST' && url === '/api/me') {
      const b = body(req), n = cleanNick(b.nick);
      if (!nickOk(n) || !aboOk(b.abo)) return send(res, 400, { error: 'invalid' });
      const r = await query('select * from submissions where lower(nickname) = lower($1) and abo4 = $2', [n, b.abo]);
      return send(res, 200, result(r.rows[0]) || null);
    }
    if (m === 'POST' && url === '/api/admin/login') {
      const lk = 'login:' + ip, W = 15 * 60e3;
      if (await peek(lk, W) >= LOGIN_LIMIT) return send(res, 429, { error: 'rate' }); // ผิดครบ 5 ครั้ง ถูกล็อก 15 นาที
      const b = body(req);
      if (!crypto.timingSafeEqual(sha(b.password), sha(ADMIN_PASSWORD))) { await hit(lk, W); return send(res, 401, { error: 'bad_login' }); }
      await query('delete from rate_limits where k = $1', [lk]);
      const t = crypto.randomBytes(32).toString('hex');
      await query('insert into admin_sessions(token_hash, exp) values($1,$2)', [sha(t).toString('hex'), Date.now() + SESSION_MS]);
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}` });
    }

    if (!url.startsWith('/api/admin/')) return send(res, 404, { error: 'not_found' });
    if (!(await isAdmin(req))) return send(res, 401, { error: 'unauthorized' });

    if (m === 'POST' && url === '/api/admin/logout') {
      const t = cookieOf(req, 'sid');
      if (t) await query('delete from admin_sessions where token_hash = $1', [sha(t).toString('hex')]);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (m === 'GET' && url === '/api/admin/list') {
      const r = await query('select * from submissions order by total desc, created_at asc');
      return send(res, 200, { rows: r.rows });
    }
    const sub = /^\/api\/admin\/submission\/(\d{1,9})$/.exec(url);
    if (sub && m === 'DELETE') { await query('delete from submissions where id = $1', [+sub[1]]); return send(res, 200, { ok: true }); }
    if (sub && m === 'PUT') { // แก้จำนวนแต่ละกิจกรรม (total คำนวณใหม่เอง)
      const b = body(req);
      if (!cOk(b.c)) return send(res, 400, { error: 'invalid' });
      const r = await query('update submissions set c1=$1,c2=$2,c3=$3,c4=$4,c5=$5 where id = $6', [...b.c, +sub[1]]);
      return send(res, 200, { ok: r.rowCount > 0 });
    }
    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    if (e.message === 'invalid') return send(res, 400, { error: 'invalid' });
    console.error(e);
    return send(res, 500, { error: 'server' });
  }
};
