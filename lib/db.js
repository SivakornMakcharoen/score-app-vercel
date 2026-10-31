'use strict';
// ตัวเชื่อมฐานข้อมูล Postgres (Neon) สำหรับ Vercel serverless
const { Pool } = require('pg');

let pool, ready;

// หาตัวแปรเชื่อมฐานข้อมูล: Neon บน Vercel อาจตั้งชื่อมีคำนำหน้า เช่น STORAGE_DATABASE_URL
function findUrl() {
  const e = process.env;
  if (e.DATABASE_URL) return e.DATABASE_URL;
  if (e.POSTGRES_URL) return e.POSTGRES_URL;
  const k = Object.keys(e).find(n => /(DATABASE_URL|POSTGRES_URL)$/.test(n) && !/UNPOOLED|NON_POOLING|NO_SSL/.test(n) && /^postgres(ql)?:\/\//.test(e[n]));
  return k ? e[k] : '';
}

function getPool() {
  if (!pool) {
    const cs = findUrl();
    if (!cs) throw new Error('ไม่พบตัวแปรฐานข้อมูล (DATABASE_URL) กรุณาเชื่อม Neon เข้ากับโปรเจกต์แล้ว Redeploy');
    // serverless: ใช้ connection เดียวต่อ instance, ปล่อยเร็วเพื่อไม่ค้าง
    pool = new Pool({ connectionString: cs.replace(/([?&])channel_binding=[^&]*&?/, '$1').replace(/[?&]$/, ''), max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
    pool.on('error', () => {}); // กัน process ล้มเมื่อ connection ที่ว่างอยู่ถูกตัด
  }
  return pool;
}

const SCHEMA = `
  create table if not exists submissions(
    id serial primary key,
    nickname text not null check(char_length(nickname) between 1 and 20),
    abo4 text not null check(abo4 ~ '^[0-9]{4}$'),
    c1 integer not null check(c1 between 0 and 200),
    c2 integer not null check(c2 between 0 and 200),
    c3 integer not null check(c3 between 0 and 200),
    c4 integer not null check(c4 between 0 and 200),
    c5 integer not null check(c5 between 0 and 200),
    total integer generated always as (c1*1 + c2*2 + c3*10 + c4*30 + c5*50) stored,
    created_at timestamptz not null default now());
  create unique index if not exists submissions_one on submissions(lower(nickname), abo4);
  create table if not exists rate_limits(
    k text not null, bucket bigint not null, n integer not null default 0, exp bigint not null,
    primary key(k, bucket));
  create table if not exists admin_sessions(
    token_hash text primary key, exp bigint not null);
`;

async function init() {
  for (let i = 0; ; i++) {
    try { await getPool().query(SCHEMA); return; }
    catch (e) { if (i >= 2) throw e; await new Promise(r => setTimeout(r, 300)); } // กรณี instance เริ่มพร้อมกันแล้วสร้างตารางชนกัน
  }
}

// รับประกันว่าตารางถูกสร้างแล้ว (ทำครั้งเดียวต่อ instance)
async function query(text, params) {
  if (!ready) ready = init().catch(e => { ready = null; throw e; });
  await ready;
  return getPool().query(text, params);
}

module.exports = { query, findUrl };
