const ACTS = [["เพิ่มรายชื่อ Online/Onsite",1],["เข้าเรื่อง",2],["BM + OPP Online/Onsite",10],["มา Begin Online/Onsite",30],["มา Center",50]];
const MAX = 200, KEY = "score_state_v1";
const $ = s => document.querySelector(s), app = $("#app"), modal = $("#modal");
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const score = c => c.reduce((a, n, i) => a + n * ACTS[i][1], 0);
const fresh = () => ({step:1, nick:"", abo:"", c:[0,0,0,0,0], done:null});
let S; try { S = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch (e) { S = fresh(); }
if (!Array.isArray(S.c) || S.c.length !== 5) S.c = [0,0,0,0,0];
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const go = n => { S.step = n; save(); render(); };
const err = t => { const e = $("#err"); if (e) e.textContent = t; };
const busy = x => document.querySelectorAll(".btn").forEach(b => b.disabled = x);
const msg = e => {
  const m = String(e && e.message || e);
  if (m.includes("duplicate")) return "ชื่อเล่นและรหัส ABO นี้ส่งข้อมูลไปแล้ว ไม่สามารถส่งซ้ำได้";
  if (m.includes("not_allowed")) return "ไม่พบชื่อเล่นและรหัส ABO นี้ในรายชื่อผู้มีสิทธิ์ ตรวจสอบอีกครั้งหรือติดต่อผู้จัดงาน";
  if (m.includes("rate")) return "ส่งถี่เกินไป รอสักครู่แล้วลองใหม่";
  if (m.includes("invalid")) return "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง";
  return "เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
};
async function api(path, body) {
  const r = await fetch(path, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
  const t = await r.json().catch(() => null);
  if (!r.ok) throw new Error((t && t.error) || "error");
  return t;
}
function render() { if (S.done) S.step = 4; [null, p1, p2, p3, p4][S.step](); }

function p1() {
  app.innerHTML = `<h1>! ทุกคนกรอกได้ครั้งเดียว !</h1><section class="card">
    <div class="warn"><b>โปรดอ่านก่อนเริ่ม</b><ul>
      <li>ทุกคนกรอกได้ <b>ครั้งเดียวเท่านั้น</b></li>
      <li>เมื่อกดยืนยันส่งแล้ว <b>แก้ไขหรือกรอกซ้ำไม่ได้</b></li>
      <li>ตรวจสอบชื่อเล่นและรหัส ABO 4 ตัวท้ายให้ถูกต้อง</li>
      <li>กรอกจำนวนให้ตรงกับความเป็นจริงก่อนกด SUBMIT</li></ul></div>
    <label class="chk"><input type="checkbox" id="ok"> ฉันอ่านและเข้าใจแล้ว</label>
    <button class="btn" id="go" disabled>Start</button></section>`;
  $("#ok").onchange = e => $("#go").disabled = !e.target.checked;
  $("#go").onclick = () => go(2);
}

function p2() {
  app.innerHTML = `<section class="card"><h2>ข้อมูลของคุณ</h2>
    <label>ชื่อเล่น<input type="text" id="nick" maxlength="20" autocomplete="off" value="${esc(S.nick)}"></label>
    <label>รหัส ABO 4 ตัวท้าย<input id="abo" maxlength="4" inputmode="numeric" autocomplete="off" value="${esc(S.abo)}"></label>
    <p class="err" id="err"></p><button class="btn" id="next">Next</button></section>`;
  $("#abo").oninput = e => e.target.value = e.target.value.replace(/\D/g, "");
  $("#next").onclick = async () => {
    const n = $("#nick").value.trim(), a = $("#abo").value;
    if (!n || n.length > 20 || /[<>&"]/.test(n)) return err("กรอกชื่อเล่นไม่เกิน 20 ตัวอักษร และห้ามใช้เครื่องหมาย < > & \"");
    if (!/^\d{4}$/.test(a)) return err("รหัส ABO ต้องเป็นตัวเลข 4 หลัก");
    S.nick = n; S.abo = a; save(); busy(true);
    try { const r = await api("/api/me", {nick:n, abo:a}); if (r) { S.done = r; save(); return render(); } go(3); }
    catch (e) { busy(false); err(msg(e)); }
  };
}

function p3() {
  S.c = S.c.map(n => Math.min(MAX, Math.max(0, n | 0)));
  app.innerHTML = `<section class="card"><h2>กรอกจำนวนกิจกรรม</h2>` + ACTS.map((a, i) =>
    `<div class="row"><div class="lbl">${a[0]}<small>(${a[1]} คะแนน/1 จำนวน)</small></div>
     <button class="rb" data-i="${i}" data-d="1" aria-label="เพิ่ม ${a[0]}">+</button>
     <button class="rb" data-i="${i}" data-d="-1" aria-label="ลด ${a[0]}">−</button>
     <input class="num" id="n${i}" readonly value="${S.c[i]}" aria-label="จำนวน ${a[0]}"></div>`).join("") +
    `<p class="tot">คะแนนรวมเบื้องต้น <b id="tot">${score(S.c)}</b></p><p class="err" id="err"></p>
     <button class="btn" id="sub">SUBMIT</button></section>`;
  app.querySelectorAll(".rb").forEach(b => b.onclick = () => {
    const i = +b.dataset.i; S.c[i] = Math.min(MAX, Math.max(0, S.c[i] + +b.dataset.d));
    $("#n" + i).value = S.c[i]; $("#tot").textContent = score(S.c); save();
  });
  $("#sub").onclick = confirmBox;
}

function confirmBox() {
  modal.innerHTML = `<div class="card" role="dialog" aria-modal="true"><h2>ยืนยันการส่งข้อมูล</h2>
    <p><b>${esc(S.nick)}</b> (ABO ${esc(S.abo)})<br>คะแนนรวม <b>${score(S.c)}</b></p>
    <p class="warn">ส่งแล้ว <b>แก้ไขหรือส่งซ้ำไม่ได้</b> ตรวจสอบให้แน่ใจก่อนกดยืนยัน</p><p class="err" id="merr"></p>
    <div class="btns"><button class="btn ghost" id="no">ยกเลิก</button><button class="btn" id="yes">ยืนยัน</button></div></div>`;
  modal.hidden = false; $("#no").focus();
  $("#no").onclick = () => modal.hidden = true;
  $("#yes").onclick = async () => {
    busy(true);
    try { S.done = await api("/api/submit", {nick:S.nick, abo:S.abo, c:S.c}); S.c = [0,0,0,0,0]; save(); modal.hidden = true; render(); }
    catch (e) {
      if (String(e.message).includes("duplicate")) { try { S.done = await api("/api/me", {nick:S.nick, abo:S.abo}); save(); modal.hidden = true; return render(); } catch (x) {} }
      busy(false); $("#merr").textContent = msg(e);
    }
  };
}

function p4() {
  const d = S.done;
  app.innerHTML = `<section class="card center"><div class="ok">✓</div><h2>บันทึกเรียบร้อยแล้ว</h2><p>${esc(S.nick)}</p>
    <p class="big">คะแนนรวมทั้งหมด <b>${Number(d.total)}</b></p>
    <table>${ACTS.map((a, i) => `<tr><td>${a[0]}</td><td>${Number(d.c[i])} × ${a[1]}</td><td>${Number(d.c[i]) * a[1]}</td></tr>`).join("")}</table>
    <p class="note">คุณกรอกได้ครั้งเดียว ไม่สามารถแก้ไขหรือส่งซ้ำได้</p></section>`;
}
render();
