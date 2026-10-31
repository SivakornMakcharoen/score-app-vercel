const $ = s => document.querySelector(s);
const HIGH = 100; // จำนวนต่อกิจกรรมที่ถือว่าสูงผิดปกติ (แจ้งเตือนให้ตรวจ)
let rows = [], editSub = null;

async function call(method, path, body) {
  const r = await fetch(path, {method, headers: body ? {"Content-Type":"application/json"} : {}, body: body ? JSON.stringify(body) : undefined, credentials:"same-origin"});
  const j = await r.json().catch(() => null);
  if (r.status === 401 && path !== "/api/admin/login") { showLogin($("#dash").hidden ? "" : "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"); throw new Error("401"); }
  if (!r.ok) throw new Error((j && j.error) || "error");
  return j;
}
function showLogin(m) { $("#dash").hidden = true; $("#login").hidden = false; $("#lerr").textContent = m || ""; }

$("#in").onclick = async () => {
  $("#lerr").textContent = "";
  try { await call("POST", "/api/admin/login", {password: $("#pw").value}); $("#pw").value = ""; await load(); }
  catch (e) { $("#lerr").textContent = String(e.message) === "rate" ? "ลองผิดหลายครั้ง ถูกล็อกชั่วคราว รอ 15 นาที" : "รหัสผ่านไม่ถูกต้อง"; }
};
$("#pw").onkeydown = e => { if (e.key === "Enter") $("#in").click(); };
$("#out").onclick = async () => { try { await call("POST", "/api/admin/logout", {}); } catch (e) {} rows = []; showLogin(""); };
$("#rf").onclick = () => load();

async function load() {
  $("#derr").textContent = "";
  try {
    const j = await call("GET", "/api/admin/list"); rows = j.rows;
    $("#login").hidden = true; $("#dash").hidden = false;
    draw();
  } catch (e) { if (String(e.message) !== "401") $("#derr").textContent = "โหลดข้อมูลไม่สำเร็จ"; }
}
function cell(tr, text, cls) { const td = document.createElement("td"); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); }
function draw() {
  const tb = $("#tb"); tb.replaceChildren();
  const aboCount = {}; rows.forEach(r => aboCount[r.abo4] = (aboCount[r.abo4] || 0) + 1);
  rows.forEach((r, i) => {
    const flags = [];
    if ([r.c1, r.c2, r.c3, r.c4, r.c5].some(x => x >= HIGH)) flags.push("จำนวนสูง");
    if (aboCount[r.abo4] > 1) flags.push("ABO ซ้ำ");
    const tr = document.createElement("tr"); if (flags.length) tr.className = "flag";
    cell(tr, i + 1, "n"); cell(tr, r.nickname); cell(tr, r.abo4);
    const vals = [r.c1, r.c2, r.c3, r.c4, r.c5], td = document.createElement("td"); td.style.display = "flex"; td.style.gap = "6px";
    if (r.id === editSub) {
      const ins = vals.map(v => { const t = document.createElement("td"), inp = document.createElement("input"); inp.type = "number"; inp.min = 0; inp.max = 200; inp.step = 1; inp.value = v; inp.style.minWidth = "70px"; t.className = "n"; t.appendChild(inp); tr.appendChild(t); return inp; });
      cell(tr, "(คำนวณใหม่)", "n"); cell(tr, new Date(r.created_at).toLocaleString("th-TH")); cell(tr, flags.join(", "));
      const ok = document.createElement("button"), no = document.createElement("button");
      ok.className = "sm"; ok.textContent = "บันทึก"; no.className = "sm sec"; no.textContent = "ยกเลิก";
      ok.onclick = () => saveSub(r, ins.map(i => i.value === "" ? NaN : Number(i.value))); no.onclick = () => { editSub = null; draw(); };
      td.append(ok, no);
    } else {
      vals.forEach(x => cell(tr, x, "n")); cell(tr, r.total, "n");
      cell(tr, new Date(r.created_at).toLocaleString("th-TH")); cell(tr, flags.join(", "));
      const ed = document.createElement("button"), b = document.createElement("button");
      ed.className = "sm sec"; ed.textContent = "แก้ไข"; ed.onclick = () => { editSub = r.id; draw(); };
      b.className = "del"; b.textContent = "ลบ"; b.onclick = () => del(r); td.append(ed, b);
    }
    tr.appendChild(td); tb.appendChild(tr);
  });
  $("#sum").textContent = rows.length ? `ทั้งหมด ${rows.length} คน` : "ยังไม่มีข้อมูล";
}
async function saveSub(r, c) {
  $("#derr").textContent = "";
  if (!c.every(x => Number.isInteger(x) && x >= 0 && x <= 200)) { $("#derr").textContent = "ต้องเป็นจำนวนเต็ม 0-200 ทุกช่อง"; return; }
  try { await call("PUT", "/api/admin/submission/" + encodeURIComponent(r.id), {c}); editSub = null; await load(); }
  catch (e) { if (e.message !== "401") $("#derr").textContent = "บันทึกไม่สำเร็จ"; }
}
async function del(r) {
  if (!confirm(`ลบรายการของ "${r.nickname}" (ABO ${r.abo4})? คนนี้จะกรอกใหม่ได้อีกครั้ง`)) return;
  try { await call("DELETE", "/api/admin/submission/" + encodeURIComponent(r.id)); load(); } catch (e) { $("#derr").textContent = "ลบไม่สำเร็จ"; }
}
$("#csv").onclick = () => {
  const safe = v => { let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const head = ["อันดับ","ชื่อเล่น","ABO","เพิ่มรายชื่อ","เข้าเรื่อง","BM+OPP","Begin","Center","รวม","เวลาส่ง"];
  const lines = [head.map(safe).join(",")].concat(rows.map((r, i) => [i + 1, r.nickname, r.abo4, r.c1, r.c2, r.c3, r.c4, r.c5, r.total, r.created_at].map(safe).join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\n")], {type:"text/csv;charset=utf-8"}));
  a.download = "scores.csv"; a.click(); URL.revokeObjectURL(a.href);
};
// ไม่เข้าหน้า Admin อัตโนมัติ: เปิดหน้านี้ทุกครั้งต้องใส่รหัสผ่านใหม่
