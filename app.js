/* 식단·운동 기록 — standalone app.
   Records live only on this device (IndexedDB). Nothing goes to a server, except photos you ask it to read,
   which go to the Anthropic API with your own key. */
(() => {
"use strict";

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (k in n && typeof v !== "string") n[k] = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}
const SVGNS = "http://www.w3.org/2000/svg";
function sv(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
}
const field = (id, label, control, cls) => h("div", { class: "field" + (cls ? " " + cls : "") }, h("label", { for: id }, label), control);
/* line icons drawn on a 24-unit grid, stroked with the current text colour */
const ICONS = {
  dumbbell: "M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11",
  bolt: "M13 2.8 5.2 13.4h6.1l-1 7.8 8.5-11.3h-6.3z",
  moon: "M19.6 14.6A8 8 0 0 1 9.4 4.4a7.7 7.7 0 1 0 10.2 10.2z",
};
function icon(name) {
  const s = sv("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
  s.append(sv("path", { d: ICONS[name] }));
  return s;
}

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isYmd = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const fromYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = fromYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((fromYmd(b) - fromYmd(a)) / 86400000);
const weekday = s => fromYmd(s).getDay();
const mondayOf = s => addDays(s, -((weekday(s) + 6) % 7));
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const fmtDay = s => { const d = fromYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`; };
const fmtDayLong = s => { const d = fromYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`; };
const fmtMD = s => { const d = fromYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
const fmtDM = s => { const d = fromYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const num = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v.trim().replace(",", ".")); return Number.isFinite(n) ? n : null; }
  return null;
};
const str = (v, max = 300) => typeof v === "string" ? v.slice(0, max) : "";
const inRange = (raw, lo, hi) => { const n = num(raw); return n == null || n < lo || n > hi ? null : n; };
const clampInt = (v, lo, hi) => v == null ? null : Math.max(lo, Math.min(hi, Math.round(v)));
const fmtInt = n => Math.round(n).toLocaleString("ko-KR");
const MINUS = "−";
const fmtSigned = (n, d) => (n < -0.0049 ? MINUS : n > 0.0049 ? "+" : "") + Math.abs(n).toFixed(d);
const sumOf = (arr, key) => arr.reduce((a, x) => a + (num(x[key]) || 0), 0);
const round1 = v => Math.round(v * 10) / 10;
const round2 = v => Math.round(v * 100) / 100;
const isPlainObj = v => !!v && typeof v === "object" && !Array.isArray(v);

/* ---------- units: stored in kg, entered and shown in kg or lb. 1 lb = 0.45359237 kg exactly. ---------- */
const LB = 0.45359237;
const okUnit = u => (u === "lb" ? "lb" : "kg");
const toKg = (v, u) => (v == null ? null : u === "lb" ? v * LB : v);
const fromKg = (kg, u) => (kg == null ? null : u === "lb" ? kg / LB : kg);
function unitToggle(current, onPick, disabled, label) {
  const btns = ["kg", "lb"].map(u => h("button", { type: "button", class: "seg-btn", "aria-pressed": String(u === current), disabled }, u));
  btns.forEach((b, i) => b.addEventListener("click", () => {
    if (b.getAttribute("aria-pressed") === "true") return;
    btns.forEach((o, j) => o.setAttribute("aria-pressed", String(j === i)));
    onPick(i ? "lb" : "kg");
  }));
  return h("span", { class: "seg", role: "group", "aria-label": label }, btns);
}

/* ---------- small device settings (not records): API key, model, last backup ---------- */
const LS = { key: "dietlog.apiKey", model: "dietlog.model", backup: "dietlog.lastBackup", hint: "dietlog.hideInstallHint" };
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } };

/* ---------- the plan ---------- */
const GYM = {
  A: { title: "상체", day: "화", items: [
    { id: "bench", g: "A1", name: "벤치프레스 (바벨 또는 덤벨)", sets: 3, lo: 6, hi: 10 },
    { id: "pulldown", g: "A2", name: "랫풀다운", sets: 3, lo: 8, hi: 12 },
    { id: "ohp", g: "B1", name: "시티드 덤벨 숄더프레스", sets: 3, lo: 8, hi: 12 },
    { id: "cablerow", g: "B2", name: "시티드 케이블 로우", sets: 3, lo: 8, hi: 12 },
    { id: "lateral", g: "C1", name: "사이드 레터럴 레이즈", sets: 2, lo: 12, hi: 20 },
    { id: "pushdown", g: "C2", name: "케이블 푸시다운", sets: 2, lo: 10, hi: 15 },
    { id: "curl", g: "C3", name: "덤벨 컬", sets: 2, lo: 10, hi: 15 },
  ] },
  B: { title: "전신", day: "목", note: "다리는 적당히: 금요일에 러닝이 있어요.", items: [
    { id: "legpress", g: "A1", name: "레그프레스", sets: 3, lo: 10, hi: 12, note: "2–3회 여유 남기기" },
    { id: "inclinedb", g: "A2", name: "인클라인 덤벨 프레스", sets: 3, lo: 8, hi: 12 },
    { id: "dbrow", g: "B1", name: "원암 덤벨 로우", sets: 3, lo: 8, hi: 12, note: "한 팔씩" },
    { id: "legcurl", g: "B2", name: "레그컬", sets: 3, lo: 10, hi: 15 },
    { id: "pullup", g: "C1", name: "어시스트 풀업 또는 뉴트럴 그립 랫풀다운", sets: 3, lo: 8, hi: 12 },
    { id: "facepull", g: "C2", name: "페이스풀", sets: 2, lo: 12, hi: 20 },
    { id: "deadbug", g: "C3", name: "데드버그 또는 플랭크", sets: 2, lo: 30, hi: 45, unit: "s", bw: true },
  ] },
  C: { title: "하체", day: "토", note: "가장 무거운 날: 일요일은 휴식이에요. 천국의 계단은 가볍게.", items: [
    { id: "squat", g: "A", name: "바벨 백스쿼트 (또는 핵스쿼트·레그프레스)", sets: 3, lo: 5, hi: 8, note: "2–3분 휴식" },
    { id: "rdl", g: "B", name: "루마니안 데드리프트", sets: 3, lo: 8, hi: 10, note: "2분 휴식" },
    { id: "bss", g: "C1", name: "불가리안 스플릿 스쿼트", sets: 2, lo: 8, hi: 12, note: "한 다리씩" },
    { id: "pushup", g: "C2", name: "푸시업 (또는 덤벨 벤치프레스)", sets: 3, lo: 8, hi: 15, bw: true },
    { id: "calf", g: "D1", name: "스탠딩 카프레이즈", sets: 3, lo: 10, hi: 15 },
    { id: "knee", g: "D2", name: "행잉 니레이즈 또는 케이블 크런치", sets: 2, lo: 10, hi: 15, bw: true },
  ] },
};
function planForWeekday(w) {
  if (w === 1 || w === 3 || w === 5) return { kind: "run" };
  if (w === 2) return { kind: "gym", key: "A" };
  if (w === 4) return { kind: "gym", key: "B" };
  if (w === 6) return { kind: "gym", key: "C" };
  return { kind: "rest" };
}
const planFor = d => planForWeekday(weekday(d));
const planLabel = p => p.kind === "run" ? "러닝하는 날" : p.kind === "gym" ? `헬스 ${p.key} · ${GYM[p.key].title}` : "휴식 + 주간 점검";
const planShort = p => p.kind === "run" ? "러닝" : p.kind === "gym" ? `헬스 ${p.key}` : "휴식";
const repLabel = ex => `${ex.sets} × ${ex.lo}–${ex.hi}${ex.unit === "s" ? "초" : "회"}`;

/* ---------- state ---------- */
const state = {
  store: null, sample: null,
  photo: { ok: false, accept: "image/*" },
  docs: new Map(), loaded: false, readOnly: false,
  today: ymd(new Date()), selected: ymd(new Date()),
  draft: null, gymTimer: null,
};
const canWrite = () => !!state.store && !state.readOnly;
const isFuture = d => d > state.today;

function docsOf(kind) {
  const out = [];
  for (const [id, d] of state.docs) if (d && d.kind === kind) out.push(Object.assign({ id }, d));
  return out;
}
function settings() {
  const x = state.docs.get("settings") || {};
  return {
    kcal: num(x.kcalTarget), protein: num(x.proteinTarget), fat: num(x.fatTarget), carbs: num(x.carbTarget),
    rateMin: num(x.rateMin) ?? 0.45, rateMax: num(x.rateMax) ?? 0.9, step: num(x.stepKcal) ?? 150,
    bodyUnit: okUnit(x.bodyUnit), liftUnit: okUnit(x.liftUnit),
  };
}
const bu = () => settings().bodyUnit;
const fmtMass = (kg, dp = 1) => (kg == null ? "—" : fromKg(kg, bu()).toFixed(dp));
const fmtRate = perWeekKg => `주 ${fmtSigned(fromKg(perWeekKg, bu()), 2)} ${bu()}`;
const fmtBand = kg => { const u = bu(); return fromKg(kg, u).toFixed(u === "lb" ? 1 : 2).replace(/0$/, "").replace(/\.$/, ""); };
const mealsOn = d => docsOf("meal").filter(m => m.date === d).sort((a, b) => str(a.time).localeCompare(str(b.time)));

let trendCache = null;
function trendSeries() {
  if (trendCache) return trendCache;
  const ws = docsOf("weight").filter(w => isYmd(w.date) && num(w.kg) > 20 && num(w.kg) < 400).sort((a, b) => a.date.localeCompare(b.date));
  let t = null;
  trendCache = ws.map(w => { const kg = num(w.kg); t = t == null ? kg : t + 0.1 * (kg - t); return { date: w.date, kg, trend: t }; });
  return trendCache;
}
function trendAt(d) { const s = trendSeries().filter(p => p.date <= d); return s.length ? s[s.length - 1] : null; }
/* kg per week: least-squares line through the raw weigh-ins of the 14 days ending at d.
   Fitting the raw points avoids the smoothed trend's start-up lag; the first rate needs two weeks of data. */
function rateAt(d) {
  const upTo = trendSeries().filter(p => p.date <= d);
  const since = upTo.length ? daysBetween(upTo[0].date, d) : 0;
  const pts = upTo.filter(p => daysBetween(p.date, d) <= 13);
  if (pts.length < 8 || since < 13) return { n: pts.length, since, perWeek: null };
  const xs = pts.map(p => -daysBetween(p.date, d)), ys = pts.map(p => p.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  return { n: pts.length, since, perWeek: sxx ? (sxy / sxx) * 7 : null };
}
const rateWait = r => r.since < 13
  ? `주간 속도는 체중 기록 2주 뒤부터 나와요 (지금 ${r.since + 1}일째).`
  : `주간 속도를 보려면 최근 14일 중 8번 이상 기록이 필요해요 (지금 ${r.n}번).`;
function verdictAt(d) {
  const st = settings(), r = rateAt(d);
  if (r.perWeek == null) return { code: "data", label: "데이터 부족", r };
  const loss = -r.perWeek;
  if (loss < st.rateMin) return { code: "cut", label: `하루 ${fmtInt(st.step)} kcal 줄이기`, r };
  if (loss > st.rateMax) return { code: "add", label: `하루 ${fmtInt(st.step)} kcal 늘리기`, r };
  return { code: "hold", label: "그대로 유지", r };
}
/* the plan starts on the first day anything was logged (or today), so earlier days never count as missed.
   A meal plan is dated to its Monday, which is not a log, so it never moves the start. */
function planStart() {
  let min = null;
  for (const d of state.docs.values()) if (d && d.kind !== "mealplan" && isYmd(d.date) && (min == null || d.date < min)) min = d.date;
  return min && min < state.today ? min : state.today;
}
const anySet = log => !!log && typeof log === "object" && Object.values(log).some(a => Array.isArray(a) && a.some(x => x && num(x.reps) > 0));
function sessionDone(d) {
  const p = planFor(d);
  if (p.kind === "run") { const r = state.docs.get("run_" + d); return !!r && (num(r.minutes) > 0 || num(r.km) > 0); }
  if (p.kind === "gym") { const g = state.docs.get("gym_" + d); return !!g && (anySet(g.log) || num(g.stepmill) > 0); }
  return false;
}
function lastSets(exId, before) {
  const gs = docsOf("gym").filter(g => isYmd(g.date) && g.date < before).sort((a, b) => b.date.localeCompare(a.date));
  for (const g of gs) {
    const arr = g.log && g.log[exId];
    if (Array.isArray(arr) && arr.some(x => x && num(x.reps) > 0)) return { date: g.date, sets: arr, unit: okUnit(g.units && g.units[exId]) };
  }
  return null;
}
const setW = x => num(x && (x.w ?? x.kg));
const topHit = (ex, sets) => Array.isArray(sets) && sets.length >= ex.sets && sets.slice(0, ex.sets).every(x => x && num(x.reps) >= ex.hi);
function fmtSets(sets, ex, unit) {
  const done = sets.filter(x => x && num(x.reps) > 0);
  const parts = done.map(x => { const w = setW(x); return (w != null ? `${+w.toFixed(2)}×` : ex.bw ? "맨몸×" : "") + num(x.reps) + (ex.unit === "s" ? "초" : ""); });
  return parts.join(", ") + (done.some(x => setW(x) != null) ? " " + unit : "");
}

/* ---------- storage on this device: IndexedDB, or localStorage where IndexedDB is unavailable ---------- */
const DB_NAME = "diet-log", DB_STORE = "docs", LS_DOCS = "dietlog.docs";
function idbBackend() {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { dbp = null; reject(e); return; }
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE); };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      db.onclose = () => { dbp = null; };
      resolve(db);
    };
    req.onerror = () => { dbp = null; reject(req.error || new Error("open failed")); };
  }));
  const once = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      let t, out;
      try { t = db.transaction(DB_STORE, mode); } catch (e) { rej(e); return; }
      try { out = fn(t.objectStore(DB_STORE)); } catch (e) { try { t.abort(); } catch (_) { /* already finished */ } rej(e); return; }
      t.oncomplete = () => res(out && typeof out.get === "function" ? out.get() : undefined);
      t.onerror = () => rej(t.error || new Error("transaction failed"));
      t.onabort = () => rej(t.error || new Error("transaction aborted"));
    });
  };
  /* iOS can drop the database connection while the app sits in the background: reopen once and retry */
  const run = async (mode, fn) => {
    try { return await once(mode, fn); }
    catch (e) {
      if (e && (e.name === "InvalidStateError" || e.name === "UnknownError" || e.name === "TransactionInactiveError")) { dbp = null; return once(mode, fn); }
      throw e;
    }
  };
  return open().then(() => ({
    kind: "indexeddb",
    loadAll: () => run("readonly", s => {
      const m = new Map(), cur = s.openCursor();
      cur.onsuccess = () => { const c = cur.result; if (c) { m.set(String(c.key), c.value); c.continue(); } };
      return { get: () => m };
    }),
    put: (id, v) => run("readwrite", s => { s.put(v, id); }),
    remove: id => run("readwrite", s => { s.delete(id); }),
    putMany: list => run("readwrite", s => { for (const [id, v] of list) s.put(v, id); }),
  }));
}
function lsBackend() {
  localStorage.setItem("dietlog.probe", "1");
  localStorage.removeItem("dietlog.probe");
  const read = () => { try { const o = JSON.parse(localStorage.getItem(LS_DOCS) || "{}"); return isPlainObj(o) ? o : {}; } catch (e) { return {}; } };
  const write = o => localStorage.setItem(LS_DOCS, JSON.stringify(o));
  return {
    kind: "localstorage",
    loadAll: async () => new Map(Object.entries(read())),
    put: async (id, v) => { const o = read(); o[id] = v; write(o); },
    remove: async id => { const o = read(); delete o[id]; write(o); },
    putMany: async list => { const o = read(); for (const [id, v] of list) o[id] = v; write(o); },
  };
}
async function openStore() {
  if (window.indexedDB) {
    try { return await idbBackend(); }
    catch (e) { /* e.g. private browsing in some browsers: fall back to localStorage below */ }
  }
  return lsBackend();
}
/* records saved by the localStorage fallback move into IndexedDB once it works */
async function migrateLocal(store, docs) {
  let raw = null;
  try { raw = localStorage.getItem(LS_DOCS); } catch (e) { return docs; }
  if (!raw) return docs;
  let obj = null;
  try { obj = JSON.parse(raw); } catch (e) { return docs; }
  const add = Object.entries(isPlainObj(obj) ? obj : {}).filter(([id, v]) => !docs.has(id) && isPlainObj(v));
  if (add.length) { await store.putMany(add); for (const [id, v] of add) docs.set(id, v); }
  try { localStorage.removeItem(LS_DOCS); } catch (e) { /* ignore */ }
  return docs;
}
const storeErr = e => Object.assign(new Error((e && e.message) || "store error"), {
  code: e && e.name === "QuotaExceededError" ? "quota_exceeded" : typeof (e && e.code) === "string" ? e.code : "unavailable",
});
const bc = "BroadcastChannel" in window ? new BroadcastChannel("diet-log") : null;
let persistAsked = false;
function askPersist() {
  if (persistAsked || !(navigator.storage && navigator.storage.persist)) return;
  persistAsked = true;
  navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
}
function changed() { trendCache = null; renderAll(); }
async function storePut(id, body) {
  try { await state.store.put(id, body); } catch (e) { throw storeErr(e); }
  state.docs.set(id, body);
  changed();
  if (bc) bc.postMessage("changed");
  askPersist();
}
async function storeRemove(id) {
  try { await state.store.remove(id); } catch (e) { throw storeErr(e); }
  state.docs.delete(id);
  changed();
  if (bc) bc.postMessage("changed");
}
const keepObjects = m => { const out = new Map(); for (const [id, v] of m) if (isPlainObj(v)) out.set(id, v); return out; };

/* ---------- writes: one at a time per document ---------- */
const pendingBodies = new Map(), writers = new Map();
function save(id, body) {
  pendingBodies.set(id, body);
  const running = writers.get(id);
  if (running) { running.again = true; return running.p; }
  const job = { again: false };
  writers.set(id, job);
  job.p = (async () => {
    try {
      do { job.again = false; await storePut(id, pendingBodies.get(id)); } while (job.again);
      pendingBodies.delete(id);
    } catch (e) { writeFailed(e); throw e; }
    finally { writers.delete(id); }
  })();
  return job.p;
}
function saveSettings(patch) {
  const cur = state.docs.get("settings") || {};
  return save("settings", Object.assign({ kind: "settings" }, cur, patch, { updatedAt: new Date().toISOString() }));
}
function removeDoc(id) { return storeRemove(id).catch(e => { writeFailed(e); throw e; }); }
function writeFailed(e) {
  toast(e && e.code === "quota_exceeded"
    ? "저장 공간이 부족해요. 백업을 내보낸 뒤 휴대폰 저장 공간을 확보하고 다시 시도하세요."
    : "저장하지 못했어요. 다시 시도하세요. 계속되면 앱을 완전히 닫았다가 다시 여세요.");
}

/* ---------- status + toast ---------- */
function setStatus(msg, tone) {
  const el = $("#status");
  el.textContent = msg || "";
  el.hidden = !msg;
  el.className = "status" + (tone === "bad" ? " bad" : "");
}
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

/* ---------- rendering ---------- */
function renderAll() {
  renderHeader();
  renderInstallHint();
  renderSummary();
  renderMeals();
  renderWeight();
  renderUpNext();
  renderBody();
  renderInbody();
  renderWeek();
  renderTargets();
  renderData();
  renderTodayPlan();
  renderDiet();
  if (!trainingBusy()) renderTraining();
}

function renderHeader() {
  const d = state.selected, p = planFor(d);
  $("#date").textContent = fmtDayLong(d);
  $("#rel").textContent = d === state.today ? "오늘" : d === addDays(state.today, -1) ? "어제" : d === addDays(state.today, 1) ? "내일" : "";
  $("#todayBtn").hidden = d === state.today;
  $("#nextBtn").disabled = daysBetween(state.today, d) >= 7;
  const chip = $("#planChip");
  chip.className = "chip " + p.kind;
  chip.textContent = planLabel(p);
}

function renderSummary() {
  const st = settings(), d = state.selected, ms = mealsOn(d);
  renderHero(ms, st);

  const tp = trendAt(d), v = verdictAt(d);
  $("#trendV").textContent = tp ? fmtMass(tp.trend) : "—";
  $("#trendU").textContent = " " + st.bodyUnit;
  $("#trendSub").textContent = !tp ? "아직 체중 기록이 없어요"
    : v.r.perWeek == null ? (v.r.since < 13 ? `14일째부터 주간 속도가 보여요 (지금 ${v.r.since + 1}일째)` : `기록 8번이 필요해요 (14일 중 ${v.r.n}번)`)
    : `${fmtRate(v.r.perWeek)} · 최근 14일`;
  $("#tTrend").dataset.v = v.code;
  drawSpark(d);

  const mon = mondayOf(d), start = planStart();
  let done = 0;
  const pips = $("#weekPips");
  pips.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const day = addDays(mon, i), p = planFor(day), ok = p.kind !== "rest" && sessionDone(day);
    if (ok) done++;
    const cls = p.kind === "rest" ? "rest" : ok ? "done" : day < state.today && day >= start ? "missed" : "";
    pips.append(h("span", { class: "pip " + cls }));
  }
  $("#weekV").textContent = String(done);
}
/* today's hero: the kcal total, then one bar segment per meal so you can see which meal used the budget */
function renderHero(ms, st) {
  const total = sumOf(ms, "kcal"), target = st.kcal;
  $("#kcalV").textContent = fmtInt(total);
  $(".hero").toggleAttribute("data-over", !!(target && total > target * 1.03));
  const sub = $("#kcalSub");
  sub.replaceChildren();
  if (!target) sub.append("식단 탭에서 하루 목표를 계산해 적용하면 남은 양이 보여요");
  else if (total <= target) sub.append("목표 ", h("b", null, `${fmtInt(target)} kcal`), " 중 ", h("b", null, `${fmtInt(target - total)} kcal`), " 남았어요");
  else sub.append("목표 ", h("b", null, `${fmtInt(target)} kcal`), "보다 ", h("b", null, `${fmtInt(total - target)} kcal`), " 더 먹었어요");

  const bar = $("#budget"), scale = Math.max(target || 0, total);
  bar.replaceChildren();
  if (scale > 0) {
    let i = 0;
    for (const m of ms) {
      const k = num(m.kcal) || 0;
      if (k <= 0) continue;
      const seg = h("i", { class: "bseg s" + (i++ % 3) });
      seg.style.width = (k / scale) * 100 + "%";
      bar.append(seg);
    }
    if (target && total > target) {
      const at = (target / scale) * 100;
      const over = h("i", { class: "bover" }), tick = h("i", { class: "btick" });
      over.style.left = at + "%"; over.style.width = 100 - at + "%";
      tick.style.left = `calc(${at}% - 1px)`;
      bar.append(over, tick);
    }
  }
  bar.setAttribute("aria-label", ms.length
    ? `식사 ${ms.length}번, 합계 ${fmtInt(total)} kcal` + (target ? `, 목표 ${fmtInt(target)} kcal` : "")
    : "아직 식사 기록이 없어요");

  const prot = sumOf(ms, "protein"), pt = st.protein;
  $("#protV").textContent = fmtInt(prot);
  $("#protT").textContent = pt ? ` / ${fmtInt(pt)} g` : " g";
  $("#protBar").style.width = (pt ? Math.min(100, (prot / pt) * 100) : 0) + "%";
  $("#protSub").textContent = !pt ? "단백질 목표도 식단 탭에서 계산할 수 있어요"
    : prot < pt ? `${fmtInt(pt - prot)} g 더 먹으면 단백질 목표예요` : "단백질 목표를 채웠어요";
  const more = $("#macroMore");
  more.hidden = !(st.carbs || st.fat);
  if (!more.hidden) {
    more.replaceChildren(
      h("span", null, "탄수화물 ", h("b", null, fmtInt(sumOf(ms, "carbs"))), st.carbs ? ` / ${fmtInt(st.carbs)} g` : " g"),
      h("span", null, "지방 ", h("b", null, fmtInt(sumOf(ms, "fat"))), st.fat ? ` / ${fmtInt(st.fat)} g` : " g"));
  }
}
/* the trend tile's sparkline: the last three weeks of the smoothed weight */
function drawSpark(d) {
  const svg = $("#trendSpark");
  svg.replaceChildren();
  const pts = trendSeries().filter(p => p.date <= d).slice(-21);
  svg.toggleAttribute("hidden", pts.length < 2);
  if (pts.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { lo = Math.min(lo, p.trend); hi = Math.max(hi, p.trend); }
  const span = Math.max(hi - lo, 0.4), mid = (hi + lo) / 2;
  const xy = (p, i) => [(i / (pts.length - 1)) * 96 + 2, 15 - ((p.trend - mid) / span) * 22];
  svg.append(sv("path", { d: pts.map((p, i) => (i ? "L" : "M") + xy(p, i).map(n => n.toFixed(2)).join(",")).join(""), class: "spark-line", "vector-effect": "non-scaling-stroke" }));
}

function renderMeals() {
  const d = state.selected, list = $("#mealList"), ms = mealsOn(d);
  list.replaceChildren();
  if (!ms.length) {
    list.append(h("p", { class: "empty" },
      !state.loaded ? "기록을 불러오는 중…"
      : isFuture(d) ? "아직 오지 않은 날이에요."
      : d === state.today ? (state.photo.ok ? "오늘은 아직 기록이 없어요. 사진으로 기록하거나 직접 입력하세요." : "오늘은 아직 기록이 없어요. ‘직접 입력’으로 기록하세요. 사진도 붙일 수 있어요.")
      : "이 날은 기록된 식사가 없어요."));
  }
  for (const m of ms) list.append(mealRow(m));
  const writable = canWrite() && !isFuture(d);
  $("#photoBtn").hidden = !state.photo.ok;
  $("#photoBtn").disabled = !writable;
  $("#addBtn").disabled = !writable;
  $("#mealHint").textContent = state.photo.ok
    ? "잘 추정하려면 먹기 전에 위에서, 숟가락이나 젓가락이 보이게 찍으세요. 기름·소스·실제로 먹은 양은 메모로 남겨 주세요."
    : "사진으로 칼로리를 추정하려면 계획 탭 → ‘데이터와 AI’에 Anthropic API 키를 넣으세요. 키가 없어도 직접 입력할 때 사진을 붙여 둘 수 있어요.";
}
function mealRow(m) {
  const kcal = num(m.kcal) || 0, prot = num(m.protein) || 0;
  const hasImg = typeof m.thumb === "string" && m.thumb.startsWith("data:image/");
  const thumb = hasImg
    ? h("img", { class: "thumb", src: m.thumb, alt: "" })
    : h("span", { class: "thumb ph", "aria-hidden": "true" }, str(m.time, 5) || "—");
  const src = m.source === "chat" ? "채팅으로 기록" : m.source === "photo" ? "사진으로 추정" : m.source === "plan" ? "식단대로 기록" : "직접 입력";
  const conf = ({ low: "신뢰도 낮음", medium: "신뢰도 보통", high: "신뢰도 높음" })[m.confidence] || "";
  const det = h("details", { class: "meal" },
    h("summary", null,
      thumb,
      h("span", { class: "m-main" },
        h("span", { class: "m-name" }, str(m.name, 80) || "식사"),
        h("span", { class: "m-meta" }, [hasImg ? str(m.time, 5) : "", src, conf].filter(Boolean).map(t => h("span", null, t)))),
      h("span", { class: "m-num" },
        h("span", null, h("b", { class: "num" }, fmtInt(kcal)), h("span", { class: "u" }, "kcal")),
        h("span", { class: "p" }, `단백질 ${fmtInt(prot)} g`))));
  const body = h("div", { class: "m-body" });
  if (Array.isArray(m.items) && m.items.length) {
    body.append(h("ul", { class: "items" }, m.items.slice(0, 20).map(it => h("li", null,
      h("span", null, str(it && it.food, 80) || "항목", it && str(it.amount, 60) ? h("span", { class: "muted" }, " · " + str(it.amount, 60)) : null),
      h("span", { class: "num muted" }, `${fmtInt(num(it && it.kcal) || 0)} kcal · ${fmtInt(num(it && it.protein) || 0)} g`)))));
  }
  const macros = [num(m.carbs) != null ? `탄수화물 ${fmtInt(num(m.carbs))} g` : "", num(m.fat) != null ? `지방 ${fmtInt(num(m.fat))} g` : ""].filter(Boolean).join(" · ");
  if (macros) body.append(h("p", { class: "small muted" }, macros));
  if (str(m.assumptions)) body.append(h("p", { class: "small" }, "추정 근거: " + str(m.assumptions)));
  if (str(m.note)) body.append(h("p", { class: "small" }, "메모: " + str(m.note)));
  if (canWrite()) body.append(h("div", null, h("button", { class: "btn danger small", type: "button", onclick: () => confirmDelete(m) }, "식사 삭제")));
  det.append(body);
  return det;
}

/* training */
function trainingBusy() {
  const a = document.activeElement, box = $("#trainingCard");
  const typing = a && box.contains(a) && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA");
  const dirty = state.draft && state.draft.rev !== state.draft.savedRev && state.draft.date === state.selected;
  return !!(typing || dirty);
}
function emptyLog(plan, log) {
  const out = {};
  for (const ex of plan.items) {
    const src = log && Array.isArray(log[ex.id]) ? log[ex.id] : [];
    out[ex.id] = Array.from({ length: ex.sets }, (_, i) => {
      const x = src[i] || {};
      return { w: inRange(x.w ?? x.kg, 0, 1000), reps: inRange(x.reps, 0, 600) };
    });
  }
  return out;
}
function unitFor(doc, exId, d) {
  const u = doc && doc.units && doc.units[exId];
  if (u === "kg" || u === "lb") return u;
  const last = lastSets(exId, d);
  return last ? last.unit : settings().liftUnit;
}
const backupDue = () => {
  if (!state.docs.size) return false;
  const t = new Date(lsGet(LS.backup) || 0).getTime();
  return !(t > 0) || Date.now() - t > 6.5 * 86400000;
};
function renderTraining() {
  const d = state.selected, p = planFor(d), box = $("#trainingBody");
  box.replaceChildren();
  const chip = $("#trainingChip");
  chip.className = "chip " + p.kind;
  chip.textContent = p.kind === "gym" ? `${GYM[p.key].day} · 헬스 ${p.key}` : p.kind === "run" ? `${DOW[weekday(d)]} · 러닝` : "일 · 휴식";
  $("#trainingH").textContent = p.kind === "gym" ? `운동 · ${GYM[p.key].title}` : p.kind === "run" ? "운동 · 러닝" : "운동 · 휴식";
  if (p.kind === "gym") renderGym(box, d, p.key);
  else if (p.kind === "run") renderRun(box, d);
  else box.append(h("p", null, "휴식일이에요. 가벼운 산책은 좋아요. 2분만 주간 점검을 해 보세요. 판정은 아래 ‘이번 주’에 있고, 규칙은 미리 정해 둔 것이니 하루 체중이 아니라 규칙을 따르세요."
    + (backupDue() ? " 점검하는 김에 계획 탭에서 백업도 내보내 두세요." : "")));
}
function renderGym(box, d, key) {
  const plan = GYM[key], doc = state.docs.get("gym_" + d);
  const units = {};
  for (const ex of plan.items) units[ex.id] = unitFor(doc, ex.id, d);
  state.draft = { date: d, key, log: emptyLog(plan, doc && doc.log), units, stepmill: inRange(doc && doc.stepmill, 0, 300), rev: 0, savedRev: 0 };
  const ro = !canWrite() || isFuture(d);
  box.append(h("p", { class: "flow small" },
    h("b", null, "천국의 계단 5분 가볍게"), " → 웨이트 약 45분 → ", h("b", null, "천국의 계단 15분"),
    plan.note ? h("span", { class: "muted" }, " · " + plan.note) : null));
  box.append(h("p", { class: "small muted" }, "세트마다 1–3회 여유를 남기고 멈추세요. 짝지은 운동(A1/A2)은 번갈아 하며 사이에 60–90초, 큰 운동은 2–3분 쉬세요. 기구 단위가 다르면 운동마다 kg/lb를 바꾸세요."));
  for (const ex of plan.items) {
    const last = lastSets(ex.id, d), up = last && topHit(ex, last.sets);
    const sets = h("div", { class: "sets" });
    const wInputs = [];
    for (let i = 0; i < ex.sets; i++) {
      const cur = state.draft.log[ex.id][i];
      const wIn = h("input", { id: `w-${ex.id}-${i}`, inputmode: "decimal", autocomplete: "off", placeholder: ex.bw ? "맨몸" : units[ex.id],
        "aria-label": `${ex.name} ${i + 1}세트 무게`, value: cur.w ?? "", disabled: ro,
        oninput: e => setVal(ex.id, i, "w", e.target.value, 0, 1000) });
      wInputs.push(wIn);
      sets.append(h("div", { class: "set" },
        h("span", { class: "n" }, String(i + 1)),
        wIn,
        h("input", { id: `rp-${ex.id}-${i}`, inputmode: "numeric", autocomplete: "off", placeholder: ex.unit === "s" ? "초" : "회",
          "aria-label": `${ex.name} ${i + 1}세트 ${ex.unit === "s" ? "초" : "횟수"}`, value: cur.reps ?? "", disabled: ro,
          oninput: e => setVal(ex.id, i, "reps", e.target.value, 0, 600) })));
    }
    const toggle = unitToggle(units[ex.id], u => {
      state.draft.units[ex.id] = u;
      if (!ex.bw) wInputs.forEach(inp => { inp.placeholder = u; });
      markDirty();
    }, ro, `${ex.name} 무게 단위`);
    box.append(h("div", { class: "ex" },
      h("div", { class: "ex-head" },
        h("span", { class: "tag" }, ex.g),
        h("span", { class: "ex-name" }, ex.name)),
      h("div", { class: "ex-sub" },
        h("span", { class: "muted num small" }, repLabel(ex)),
        toggle),
      h("div", { class: "ex-meta small" },
        h("span", { class: "muted" }, last ? `지난번 (${fmtDM(last.date)}): ${fmtSets(last.sets, ex, last.unit)}` : "아직 이전 기록이 없어요"),
        up ? h("span", { class: "chip up" }, ex.bw ? "범위 상단 도달: 더 어렵게" : "범위 상단 도달: 무게 올리기") : null,
        ex.note ? h("span", { class: "muted" }, ex.note) : null),
      sets));
  }
  box.append(h("div", { class: "row stepmill" },
    h("label", { for: "stepmillIn" }, "천국의 계단 총 시간 (분)"),
    h("input", { id: "stepmillIn", inputmode: "numeric", autocomplete: "off", placeholder: "20", value: state.draft.stepmill ?? "", disabled: ro,
      oninput: e => { state.draft.stepmill = inRange(e.target.value, 0, 300); markDirty(); } })));
  box.append(h("p", { id: "gymSaved", class: "small muted", "aria-live": "polite" },
    ro ? (isFuture(d) ? "그날이 되면 기록할 수 있어요." : "") : doc ? "저장됨. 입력하면 바로 저장돼요." : "입력하면 바로 저장돼요."));
}
function setVal(exId, i, fieldName, raw, lo, hi) {
  if (!state.draft) return;
  state.draft.log[exId][i][fieldName] = inRange(raw, lo, hi);
  markDirty();
}
function markDirty() {
  const d = state.draft;
  d.rev++;
  const s = $("#gymSaved"); if (s) s.textContent = "저장 중…";
  clearTimeout(state.gymTimer);
  state.gymTimer = setTimeout(flushGym, 700);
}
function flushGym() {
  clearTimeout(state.gymTimer); state.gymTimer = null;
  const d = state.draft;
  if (!d || d.rev === d.savedRev || !canWrite()) return;
  const rev = d.rev, log = {};
  for (const exId in d.log) {
    const u = d.units[exId];
    log[exId] = d.log[exId].map(x => ({ w: x.w, reps: x.reps, kg: x.w == null ? null : round2(toKg(x.w, u)) }));
  }
  const body = JSON.parse(JSON.stringify({ kind: "gym", date: d.date, day: d.key, log, units: d.units, stepmill: d.stepmill ?? null, updatedAt: new Date().toISOString() }));
  save("gym_" + d.date, body).then(() => {
    d.savedRev = Math.max(d.savedRev, rev);
    if (state.draft === d && d.rev === d.savedRev) { const s = $("#gymSaved"); if (s) s.textContent = "저장됨."; }
  }).catch(() => { const s = $("#gymSaved"); if (s && state.draft === d) s.textContent = "저장하지 못했어요. 아무 칸이나 다시 고쳐 보세요."; });
}
function renderRun(box, d) {
  const r = state.docs.get("run_" + d) || {};
  const ro = !canWrite() || isFuture(d);
  box.append(h("p", { class: "small muted" }, weekday(d) === 1
    ? "일요일에 쉬어서 다리가 가벼울 거예요."
    : "웨이트 다음 날 러닝이에요. 다리가 무거우면 건너뛰지 말고 가볍게 뛰세요."));
  if (state.photo.ok && !ro) {
    box.append(h("div", { class: "row run-photo" },
      h("button", { class: "btn primary", type: "button", onclick: openRunPhoto }, "NRC 캡처로 기록"),
      h("span", { class: "small muted" }, "또는 아래에 직접 입력")));
  }
  const minutes = h("input", { id: "runMin", inputmode: "numeric", autocomplete: "off", placeholder: "30", value: num(r.minutes) ?? "", disabled: ro });
  const km = h("input", { id: "runKm", inputmode: "decimal", autocomplete: "off", placeholder: "4.5", value: num(r.km) ?? "", disabled: ro });
  const effort = h("select", { id: "runEffort", disabled: ro },
    [["easy", "가볍게"], ["moderate", "보통"], ["hard", "힘들게"]].map(([v, t]) => h("option", { value: v, selected: (r.effort || "easy") === v }, t)));
  const note = h("input", { id: "runNote", autocomplete: "off", placeholder: "선택", value: str(r.note, 200), disabled: ro });
  const btn = h("button", { class: "btn primary", type: "submit", disabled: ro }, r.date ? "러닝 수정" : "러닝 저장");
  const msg = h("p", { class: "small muted wide", "aria-live": "polite" }, ro && isFuture(d) ? "그날이 되면 기록할 수 있어요." : r.date ? "저장됨." : "");
  const form = h("form", { class: "run-form" },
    field("runMin", "시간 (분)", minutes), field("runKm", "거리 (km)", km), field("runEffort", "강도", effort),
    field("runNote", "메모", note, "wide"), h("div", null, btn), msg);
  form.addEventListener("submit", e => {
    e.preventDefault();
    const mins = inRange(minutes.value, 0, 600), dist = inRange(km.value, 0, 100);
    if (mins == null && dist == null) { msg.textContent = "시간이나 거리를 입력하세요."; return; }
    btn.disabled = true; msg.textContent = "저장 중…";
    save("run_" + d, Object.assign({}, r, { kind: "run", date: d, minutes: mins, km: dist, effort: effort.value, note: note.value.trim().slice(0, 200), source: r.source || "manual", updatedAt: new Date().toISOString() }))
      .then(() => { msg.textContent = "저장됨."; })
      .catch(() => { msg.textContent = "저장하지 못했어요. 다시 시도하세요."; })
      .finally(() => { btn.disabled = false; });
  });
  box.append(form);
}

/* run from a screenshot (Nike Run Club summary) */
function parseDuration(s) {
  const m = typeof s === "string" && s.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const secs = m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
  return secs > 0 ? Math.round(secs / 6) / 10 : null;
}
function parsePace(s) {
  const m = typeof s === "string" && s.trim().match(/^(\d{1,2})\s*['′:]\s*(\d{2})/);
  return m ? (+m[1]) + (+m[2]) / 60 : null;
}
function runPrompt() {
  return [
    "Read this running app screenshot, for example a Nike Run Club run summary. It may be in Korean or English.",
    "Copy only values that are shown on screen. Never estimate or calculate a missing value: use null.",
    "Reply with only a JSON object of this shape:",
    '{"date":"YYYY-MM-DD or null","km":0,"duration":"time exactly as shown, e.g. 31:08 or 1:02:31, or null","pace":"average pace as shown, e.g. 6\'12\\", or null","kcal":0,"avgHr":0}',
    "Give a date only if the full date is visible on screen; otherwise null. If distance is in miles, give km (miles × 1.609).",
    'If the screenshot is not a run summary, reply {"error":"not a run"}.',
  ].join("\n");
}
function runResultForm(out, r) {
  const km = inRange(r.km, 0, 100);
  const pace = parsePace(r.pace);
  let mins = parseDuration(r.duration), minsNote = "";
  if (mins == null && km && pace) { mins = round1(pace * km); minsNote = "시간은 페이스 × 거리로 계산했어요."; }
  const d0 = isYmd(r.date) && r.date <= state.today ? r.date : (isFuture(state.selected) ? state.today : state.selected);
  const date = h("input", { id: "rDate", type: "date", value: d0, max: state.today });
  const minI = h("input", { id: "rMin", inputmode: "decimal", autocomplete: "off", value: mins ?? "" });
  const kmI = h("input", { id: "rKm", inputmode: "decimal", autocomplete: "off", value: km ?? "" });
  const effort = h("select", { id: "rEffort" }, [["easy", "가볍게"], ["moderate", "보통"], ["hard", "힘들게"]].map(([v, t]) => h("option", { value: v }, t)));
  const extras = [str(r.pace, 12) ? `페이스 ${str(r.pace, 12)}/km` : "", inRange(r.avgHr, 30, 230) ? `평균 심박 ${Math.round(num(r.avgHr))}` : "", inRange(r.kcal, 0, 5000) ? `${Math.round(num(r.kcal))} kcal` : ""].filter(Boolean).join(" · ");
  const note = h("input", { id: "rNote", autocomplete: "off", value: extras });
  const warn = h("p", { class: "small muted wide", "aria-live": "polite" });
  const msg = h("p", { class: "small muted wide", "aria-live": "polite" }, minsNote);
  const btn = h("button", { class: "btn primary", type: "submit" }, "러닝 저장");
  const showWarn = () => { warn.textContent = state.docs.has("run_" + date.value) ? `${fmtDay(date.value)}에 저장된 러닝을 대체해요.` : ""; };
  date.addEventListener("change", showWarn);
  showWarn();
  const form = h("form", { class: "est-grid" },
    field("rDate", "날짜", date), field("rEffort", "강도", effort), field("rMin", "시간 (분)", minI), field("rKm", "거리 (km)", kmI),
    field("rNote", "메모", note, "wide"), warn, h("div", { class: "wide row" }, btn), msg);
  form.addEventListener("submit", e => {
    e.preventDefault();
    const d = date.value, m = inRange(minI.value, 0, 600), k = inRange(kmI.value, 0, 100);
    if (!isYmd(d) || d > state.today) { msg.textContent = "미래가 아닌 날짜를 고르세요."; return; }
    if (m == null && k == null) { msg.textContent = "시간이나 거리를 입력하세요."; return; }
    btn.disabled = true; sheetBusy = true; msg.textContent = "저장 중…";
    save("run_" + d, {
      kind: "run", date: d, minutes: m, km: k, effort: effort.value, note: note.value.trim().slice(0, 200),
      pace: str(r.pace, 12) || null, avgHr: inRange(r.avgHr, 30, 230), kcal: inRange(r.kcal, 0, 5000),
      source: "photo", updatedAt: new Date().toISOString(),
    }).then(() => { sheetBusy = false; closeSheet(true); toast("러닝을 저장했어요."); })
      .catch(() => { sheetBusy = false; btn.disabled = false; msg.textContent = "저장하지 못했어요. 다시 시도하세요."; });
  });
  out.replaceChildren(form);
  out.hidden = false;
}
function openRunPhoto() {
  let blob = null, previewUrl = null, ctl = null;
  openSheet("캡처로 러닝 기록", panel => {
    const file = h("input", { id: "rFile", type: "file", accept: state.photo.accept, class: "file-input" });
    const pick = h("label", { for: "rFile", class: "btn" }, "캡처 선택");
    const img = h("img", { class: "preview", alt: "고른 러닝 캡처", hidden: true });
    const go = h("button", { class: "btn primary", type: "button", disabled: true }, "러닝 읽기");
    const stop = h("button", { class: "btn", type: "button", hidden: true }, "중지");
    const msg = h("p", { class: "small muted", "aria-live": "polite" }, "Nike Run Club의 러닝 요약 화면을 쓰세요. 캡처는 내 API 키로 Claude에 보내서 숫자만 읽고, 숫자만 저장해요.");
    const out = h("div", { class: "estimate", hidden: true });
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      go.disabled = true; out.hidden = true; msg.textContent = "캡처를 준비하는 중…";
      try {
        blob = (await prepImage(f)).blob;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        img.src = previewUrl; img.hidden = false;
        go.disabled = false; msg.textContent = "‘러닝 읽기’를 누르세요.";
      } catch (e) { msg.textContent = "이미지를 읽지 못했어요. PNG나 JPEG 캡처로 해 보세요."; }
    });
    stop.addEventListener("click", () => { if (ctl) ctl.abort(); });
    go.addEventListener("click", async () => {
      if (!blob || !state.sample) return;
      ctl = new AbortController();
      go.disabled = true; stop.hidden = false; out.hidden = true; sheetBusy = true;
      msg.textContent = "러닝 기록을 읽는 중…";
      try {
        const res = await state.sample.json(runPrompt(), { images: [blob], maxTokens: 800, signal: ctl.signal });
        if (res.error) { msg.textContent = "러닝 요약 화면이 아닌 것 같아요. 러닝 직후의 요약 화면으로 해 보세요."; return; }
        runResultForm(out, res);
        msg.textContent = "숫자를 확인한 뒤 저장하세요.";
      } catch (e) {
        msg.textContent = e && e.code === "cancelled" ? "중지했어요." : sampleCopy(e && e.code, e && e.detail);
      } finally { go.disabled = !blob; stop.hidden = true; sheetBusy = false; ctl = null; }
    });
    panel.append(h("div", { class: "row" }, file, pick), img, h("div", { class: "row" }, go, stop), msg, out);
  }, () => { if (ctl) ctl.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl); });
}

/* weight */
function pickBodyUnit(u) {
  if (!canWrite()) return;
  saveSettings({ bodyUnit: u }).catch(() => {});
}
function renderWeight() {
  const d = state.selected, w = state.docs.get("weight_" + d), inp = $("#kgInput"), u = bu();
  const ro = !canWrite() || isFuture(d);
  $("#kgUnit").replaceChildren(unitToggle(u, pickBodyUnit, !canWrite(), "체중 단위"));
  if (document.activeElement !== inp && !inp.dataset.dirty) {
    let v = "";
    if (w && num(w.kg)) {
      const e = w.entered;
      v = e && e.unit === u && num(e.value) != null ? String(num(e.value)) : fromKg(num(w.kg), u).toFixed(1);
    }
    inp.value = v;
  }
  inp.placeholder = u === "lb" ? "0.0 lb" : "0.0 kg";
  inp.setAttribute("aria-label", `아침 체중 (${u})`);
  $("#kgLabel").textContent = d === state.today ? "오늘 아침 체중" : `${fmtDay(d)} 아침 체중`;
  inp.disabled = ro; $("#kgSave").disabled = ro;
  const tpDay = trendAt(d);
  $("#weighinNote").textContent = w && num(w.kg)
    ? (tpDay ? `저장됨. 추세 ${fmtMass(tpDay.trend)} ${u} · 그래프는 몸 탭에 있어요.` : "저장됨.")
    : isFuture(d) ? "그날이 되면 기록할 수 있어요." : "일어나서 화장실에 다녀온 뒤, 먹고 마시기 전에 재세요. 매일 같은 체중계로요.";
  $("#legend").hidden = !drawChart();
  const tp = trendAt(d), r = rateAt(d), stats = $("#weightStats");
  stats.replaceChildren();
  if (!tp) { stats.textContent = "일어나서 화장실에 다녀온 뒤, 먹고 마시기 전에 매일 같은 체중계로 재세요."; return; }
  stats.append("추세 ", h("b", { class: "num" }, `${fmtMass(tp.trend)} ${u}`));
  if (r.perWeek == null) stats.append(" · " + rateWait(r));
  else {
    stats.append(" · 최근 14일 속도 ", h("b", { class: "num" }, fmtRate(r.perWeek)),
      ` (체중 기록에 맞춘 직선) · 하루 약 ${(r.perWeek < 0 ? MINUS : "+") + fmtInt(Math.abs((r.perWeek / 7) * 7700))} kcal의 에너지 수지${u === "lb" ? " (1 lb ≈ 3,500 kcal 가정)" : " (1 kg ≈ 7,700 kcal 가정)"}.`);
  }
}
let lastChartWidth = 0;
function drawChart() {
  const box = $("#chart");
  box.replaceChildren();
  const u = bu(), end = state.selected, all = trendSeries();
  let start = addDays(end, -41);
  if (all.length && all[0].date > start) start = all[0].date;
  if (daysBetween(start, end) < 13) start = addDays(end, -13);
  const spanDays = daysBetween(start, end);
  const pts = all.filter(p => p.date >= start && p.date <= end).map(p => ({ date: p.date, kg: fromKg(p.kg, u), trend: fromKg(p.trend, u) }));
  if (!pts.length) {
    box.append(h("p", { class: "empty" }, all.length ? "이 날까지 6주 동안 체중 기록이 없어요." : "오늘 탭에 첫 아침 체중을 기록하면 추세선이 시작돼요."));
    return false;
  }
  const W = Math.max(260, Math.floor(box.clientWidth || 320)), H = 180, L = 38, R = 44, T = 14, B = 24;
  lastChartWidth = W;
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { lo = Math.min(lo, p.kg, p.trend); hi = Math.max(hi, p.kg, p.trend); }
  const minSpan = u === "lb" ? 3.5 : 1.6;
  const span = Math.max(hi - lo + minSpan * 0.375, minSpan), mid = (lo + hi) / 2;
  lo = mid - span / 2; hi = mid + span / 2;
  const step = [0.5, 1, 2, 5, 10, 20].find(s => span / s <= 6) || 50;
  const x = dd => L + (daysBetween(start, dd) / spanDays) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `${fmtMD(start)}부터 ${fmtMD(end)}까지 아침 체중과 추세 (${u})` });
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    svg.append(sv("line", { x1: L, x2: W - R, y1: y(v).toFixed(1), y2: y(v).toFixed(1), class: "grid-l" }));
    const t = sv("text", { x: L - 6, y: (y(v) + 4).toFixed(1), "text-anchor": "end", class: "axis" });
    t.textContent = step < 1 ? v.toFixed(1) : String(Math.round(v));
    svg.append(t);
  }
  [[start, "start"], [addDays(start, Math.round(spanDays / 2)), "middle"], [end, "end"]].forEach(([dd, anchor]) => {
    const t = sv("text", { x: x(dd).toFixed(1), y: H - 6, "text-anchor": anchor, class: "axis" });
    t.textContent = fmtDM(dd);
    svg.append(t);
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.trend).toFixed(1)}`).join("");
  /* tie each weigh-in to the trend: amber when the scale read above the trend, green when below */
  for (const p of pts) {
    const px = x(p.date).toFixed(1);
    if (Math.abs(y(p.kg) - y(p.trend)) >= 1) svg.append(sv("line", { x1: px, x2: px, y1: y(p.kg).toFixed(1), y2: y(p.trend).toFixed(1), class: p.kg > p.trend ? "float" : "sink" }));
  }
  if (pts.length > 1) svg.append(sv("path", { d: line, class: "trend" }));
  for (const p of pts) svg.append(sv("circle", { cx: x(p.date).toFixed(1), cy: y(p.kg).toFixed(1), r: 3.2, class: "dot" }));
  const last = pts[pts.length - 1];
  svg.append(sv("circle", { cx: x(last.date).toFixed(1), cy: y(last.trend).toFixed(1), r: 5, class: "end" }));
  const lbl = sv("text", { x: (x(last.date) + 8).toFixed(1), y: (y(last.trend) + 4).toFixed(1), "text-anchor": "start", class: "endlabel" });
  lbl.textContent = last.trend.toFixed(1);
  svg.append(lbl);
  const guide = sv("line", { x1: 0, x2: 0, y1: T, y2: H - B, class: "guide", visibility: "hidden" });
  const hit = sv("rect", { x: L, y: 0, width: W - L - R, height: H - B, fill: "transparent" });
  svg.append(guide, hit);
  const tip = h("div", { class: "tip", hidden: true });
  const show = ev => {
    const rect = svg.getBoundingClientRect(), px = (ev.clientX - rect.left) * (W / rect.width);
    let best = null, bd = Infinity;
    for (const p of pts) { const dist = Math.abs(x(p.date) - px); if (dist < bd) { bd = dist; best = p; } }
    if (!best) return;
    guide.setAttribute("x1", x(best.date)); guide.setAttribute("x2", x(best.date)); guide.setAttribute("visibility", "visible");
    tip.textContent = `${fmtDay(best.date)} · ${best.kg.toFixed(1)} ${u} · 추세 ${best.trend.toFixed(1)}`;
    tip.hidden = false;
    const tx = x(best.date) * (rect.width / W), tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(rect.width - tw, tx - tw / 2)) + "px";
  };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", () => { tip.hidden = true; guide.setAttribute("visibility", "hidden"); });
  box.append(svg, tip);
  return true;
}

/* views (hash routing: #today, #diet, #training, #body, #plan) */
const VIEWS = ["today", "diet", "training", "body", "plan"];
const currentView = () => { const n = location.hash.slice(1); return VIEWS.includes(n) ? n : "today"; };
function showView(scrollTop) {
  const v = currentView();
  for (const n of VIEWS) {
    $("#view-" + n).hidden = n !== v;
    const tab = $("#tab-" + n);
    if (n === v) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
  }
  if (v === "body") $("#legend").hidden = !drawChart();
  if (v === "plan") renderStorageInfo();
  if (scrollTop) window.scrollTo(0, 0);
}
function renderUpNext() {
  const d = state.selected, p = planFor(d), done = sessionDone(d);
  $("#upnextH").textContent = d === state.today ? "오늘의 운동" : `${fmtDay(d)} 운동`;
  let text;
  if (p.kind === "gym") {
    const g = GYM[p.key];
    text = done ? `헬스 ${p.key} · ${g.title} 기록이 있어요. 열어서 확인하거나 세트를 추가하세요.`
      : `헬스 ${p.key} · ${g.title}: ${g.items.length}가지 운동, 천국의 계단 포함 약 70분.`;
  } else if (p.kind === "run") {
    text = done ? "러닝을 기록했어요." : state.photo.ok ? "러닝하는 날이에요. NRC 캡처로 기록하거나 시간을 입력하세요." : "러닝하는 날이에요. 뛰고 나서 시간과 거리를 입력하세요.";
  } else text = "휴식일이에요. 이번 주 판정은 운동 탭에 있어요." + (backupDue() ? " 오늘은 백업도 내보내 두세요 (계획 탭 → 데이터와 AI)." : "");
  $("#upnextText").textContent = text;
  const ico = $("#upnextIco");
  ico.className = "up-ico " + p.kind;
  ico.replaceChildren(icon(p.kind === "gym" ? "dumbbell" : p.kind === "run" ? "bolt" : "moon"));
  $("#upnextGo").textContent = p.kind === "rest" ? "주간 보기" : done ? "보기" : "열기";
}

/* week */
function renderWeek() {
  const mon = mondayOf(state.selected), sun = addDays(mon, 6), thisWeek = mon === mondayOf(state.today), start = planStart();
  $("#weekH").textContent = thisWeek ? "이번 주" : `${fmtMD(mon)} 주`;
  const list = $("#weekDays");
  list.replaceChildren();
  let done = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i), p = planFor(d), ok = p.kind !== "rest" && sessionDone(d);
    if (ok) done++;
    const st = p.kind === "rest" ? (d <= state.today ? "점검" : "휴식")
      : ok ? "완료" : d < start ? "—" : d < state.today ? "놓침" : d === state.today ? "오늘" : "예정";
    list.append(h("li", { class: "wd" + (d === state.selected ? " sel" : "") },
      h("button", { class: "wd-btn", type: "button", "aria-label": `${fmtDay(d)}: ${planLabel(p)}, ${st}`, onclick: () => select(d) },
        h("span", { class: "wd-day" }, DOW[weekday(d)]),
        h("span", { class: "wd-plan" }, planShort(p)),
        h("span", { class: "wd-st st-" + ({ "완료": "done", "놓침": "missed", "오늘": "today" }[st] || "other") }, st))));
  }
  const past = [];
  for (let i = 0; i < 7; i++) { const d = addDays(mon, i); if (d <= state.today) past.push(d); }
  const mealDays = past.filter(d => mealsOn(d).length);
  const avg = key => mealDays.length ? mealDays.reduce((a, d) => a + sumOf(mealsOn(d), key), 0) / mealDays.length : null;
  const weighIns = past.filter(d => state.docs.has("weight_" + d)).length;
  $("#weekStats").replaceChildren(...[
    "운동 ", h("b", { class: "num" }, `${done}/6회`), " · 체중 기록 ", h("b", { class: "num" }, `${weighIns}/${past.length || 7}일`),
    ...(mealDays.length
      ? [" · 기록한 ", `${mealDays.length}일`, " 평균 ", h("b", { class: "num" }, `${fmtInt(avg("kcal"))} kcal`), ", 단백질 ", h("b", { class: "num" }, `${fmtInt(avg("protein"))} g`)]
      : [" · 아직 식사 기록 없음"]),
  ]);
  const finished = sun <= state.today;
  const end = finished ? sun : (state.selected <= state.today ? state.selected : state.today);
  const v = verdictAt(end), st = settings(), u = st.bodyUnit;
  const chip = $("#verdictChip");
  chip.className = "chip " + v.code;
  chip.textContent = v.code === "data" ? "데이터 부족"
    : finished ? v.label
    : ({ cut: "지금까지: 목표보다 느림", add: "지금까지: 목표보다 빠름", hold: "지금까지: 목표 범위" })[v.code];
  $("#ruleText").textContent =
    `미리 정한 규칙 (일요일에 적용): 최근 14일 감량 속도가 주 ${fmtBand(st.rateMin)} ${u}보다 느리면 하루 약 ${fmtInt(st.step)} kcal 덜 먹고, ` +
    `주 ${fmtBand(st.rateMax)} ${u}보다 빠르면 하루 약 ${fmtInt(st.step)} kcal 더 먹어요. 그 사이면 그대로 유지해요.` +
    (v.r.perWeek != null ? ` 현재: ${fmtRate(v.r.perWeek)}.` : " " + rateWait(v.r));
}

/* inbody (weight, skeletal muscle and body fat are stored in kg and shown in the body-weight unit) */
const IB_FIELDS = [
  { key: "weight", label: "체중", mass: true, lo: 20, hi: 400, dp: 1 },
  { key: "smm", label: "골격근량", mass: true, lo: 5, hi: 100, dp: 1, better: 1 },
  { key: "fatMass", label: "체지방량", mass: true, lo: 0, hi: 200, dp: 1, better: -1 },
  { key: "pbf", label: "체지방률", unit: "%", lo: 1, hi: 75, dp: 1, better: -1 },
  { key: "bmi", label: "BMI", unit: "", lo: 10, hi: 80, dp: 1 },
  { key: "bmr", label: "기초대사량", unit: "kcal", lo: 500, hi: 4000, dp: 0 },
  { key: "visceral", label: "내장지방 레벨", unit: "", lo: 1, hi: 30, dp: 0, better: -1 },
  { key: "score", label: "인바디 점수", unit: "점", lo: 0, hi: 120, dp: 0, better: 1 },
];
const IB = Object.fromEntries(IB_FIELDS.map(f => [f.key, f]));
const ibUnit = f => (f.mass ? bu() : f.unit);
const inbodies = () => docsOf("inbody").filter(r => isYmd(r.date)).sort((a, b) => a.date.localeCompare(b.date));
const ibVal = (r, key) => { const f = IB[key], v = num(r && r[key]); return v == null || v < f.lo || v > f.hi ? null : v; };
const ibShow = (r, key) => { const v = ibVal(r, key); return v == null ? null : IB[key].mass ? fromKg(v, bu()) : v; };
const fmtIB = (v, f) => (v == null ? "—" : f.dp ? v.toFixed(f.dp) : fmtInt(v));

function renderInbody() {
  const box = $("#inbodyBody"), list = inbodies(), writable = canWrite(), u = bu();
  $("#ibPhotoBtn").hidden = !state.photo.ok;
  $("#ibPhotoBtn").disabled = !writable;
  $("#ibAddBtn").disabled = !writable;
  box.replaceChildren();
  if (!list.length) {
    box.append(h("p", { class: "empty" }, !state.loaded ? "기록을 불러오는 중…"
      : state.photo.ok ? "아직 인바디 기록이 없어요. 결과지를 찍어서 기록하거나 숫자를 직접 입력하세요."
      : "아직 인바디 기록이 없어요. 결과지를 보고 숫자를 직접 입력하세요. API 키를 넣으면 결과지 사진도 읽어 줘요."));
    return;
  }
  const last = list[list.length - 1], prev = list.length > 1 ? list[list.length - 2] : null;
  box.append(h("p", { class: "small muted" }, `최근 검사 ${fmtDay(last.date)}` + (prev ? ` · 이전 검사 ${fmtDay(prev.date)}` : "") + (str(last.note) ? ` · ${str(last.note, 80)}` : "")));
  const grid = h("div", { class: "ib-grid" });
  for (const key of ["smm", "fatMass", "pbf", "weight"]) {
    const f = IB[key], v = ibShow(last, key), p = prev ? ibShow(prev, key) : null, unit = ibUnit(f);
    let delta = prev ? "—" : "첫 검사", cls = "";
    if (v != null && p != null) {
      const dlt = v - p;
      delta = `${fmtSigned(dlt, f.dp)} ${key === "pbf" ? "%p" : unit}`;
      if (f.better && Math.abs(dlt) >= 0.05) cls = dlt * f.better > 0 ? "good" : "bad";
    }
    grid.append(h("div", { class: "ib-stat" },
      h("span", { class: "k" }, f.label),
      h("span", { class: "v" }, fmtIB(v, f), v != null ? h("small", null, " " + unit) : null),
      h("span", { class: "d " + cls }, delta)));
  }
  box.append(grid);
  const minor = h("p", { class: "ib-minor" });
  for (const key of ["score", "visceral", "bmr", "bmi"]) {
    const f = IB[key], v = ibShow(last, key);
    if (v != null) minor.append(h("span", null, f.label + " ", h("b", null, fmtIB(v, f) + (f.unit ? (f.unit === "점" ? "점" : " " + f.unit) : ""))));
  }
  if (minor.childNodes.length) box.append(minor);
  if (list.length >= 2) box.append(h("div", { class: "ib-charts" }, miniChart(list, "smm", "m", `골격근량 (${u})`), miniChart(list, "fatMass", "f", `체지방량 (${u})`)));
  else box.append(h("p", { class: "small muted mt-10" }, "다음 검사부터 변화를 비교할 수 있어요."));
  const rows = list.slice().reverse().slice(0, 12);
  box.append(h("div", { class: "table-wrap" }, h("table", { class: "ib-table" },
    h("caption", null, `무게 단위: ${u}`),
    h("thead", null, h("tr", null, ["날짜", "체중", "골격근", "체지방", "체지방률", "점수", ""].map(t => h("th", { scope: "col" }, t)))),
    h("tbody", null, rows.map(r => h("tr", null,
      h("td", null, fmtDM(r.date)),
      ["weight", "smm", "fatMass", "pbf", "score"].map(k => h("td", null, fmtIB(ibShow(r, k), IB[k]))),
      h("td", null, writable ? h("button", { class: "xbtn", type: "button", "aria-label": `${fmtDay(r.date)} 인바디 기록 삭제`, onclick: () => confirmDeleteInbody(r) }, "×") : null)))))));
}
function miniChart(list, key, cls, title, get) {
  const wrap = h("div", { class: "mini" }, h("h3", null, title));
  const val = get || (r => ibShow(r, key));
  const pts = list.map(r => ({ date: r.date, v: val(r) })).filter(p => p.v != null);
  if (pts.length < 2) { wrap.append(h("p", { class: "small muted" }, "이 값이 있는 검사가 두 번 필요해요.")); return wrap; }
  const W = 360, H = 100, L = 8, R = 46, T = 14, B = 20;
  const d0 = pts[0].date, span = Math.max(1, daysBetween(d0, pts[pts.length - 1].date));
  let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  const padV = Math.max(0.5, (hi - lo) * 0.3); lo -= padV; hi += padV;
  const x = d => L + (daysBetween(d0, d) / span) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${title}: ` + pts.map(p => `${fmtDM(p.date)} ${p.v.toFixed(1)}`).join(", ") });
  svg.append(sv("line", { x1: L, x2: W - R, y1: H - B, y2: H - B, class: "base" }));
  svg.append(sv("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join(""), class: "ln " + cls }));
  for (const p of pts) svg.append(sv("circle", { cx: x(p.date).toFixed(1), cy: y(p.v).toFixed(1), r: 3.5, class: "pt " + cls }));
  const last = pts[pts.length - 1];
  const lab = sv("text", { x: (x(last.date) + 8).toFixed(1), y: (y(last.v) + 4).toFixed(1), class: "lab" });
  lab.textContent = last.v.toFixed(1);
  const a1 = sv("text", { x: L, y: H - 4, class: "ax" }); a1.textContent = fmtDM(pts[0].date);
  const a2 = sv("text", { x: W - R, y: H - 4, "text-anchor": "end", class: "ax" }); a2.textContent = fmtDM(last.date);
  svg.append(lab, a1, a2);
  wrap.append(svg);
  return wrap;
}
function inbodyPrompt() {
  return [
    "Read the printed values on this InBody body composition result sheet. It may be in Korean or English.",
    "Korean labels: 체중 = weight, 골격근량 = skeletal muscle mass, 체지방량 = body fat mass, 체지방률 = percent body fat, BMI, 기초대사량 = basal metabolic rate, 내장지방레벨 = visceral fat level, 인바디점수 = InBody score. The test date is printed near the top of the sheet.",
    "Copy only numbers that are printed and legible. Never estimate, calculate or guess a value that is missing: use null for it.",
    "If the sheet is in pounds, convert weight, smm and fatMass to kg.",
    "Reply with only a JSON object of this shape:",
    '{"date":"YYYY-MM-DD or null","weight":0,"smm":0,"fatMass":0,"pbf":0,"bmi":0,"bmr":0,"visceral":0,"score":0,"unreadable":["names of values you could not read, in Korean"]}',
    'If the photo is not an InBody or similar body composition result sheet, reply {"error":"not a result sheet"}.',
  ].join("\n");
}
function cleanInbody(r) {
  const out = { date: isYmd(r.date) && r.date <= state.today ? r.date : null };
  for (const f of IB_FIELDS) { const v = num(r[f.key]); out[f.key] = v == null || v < f.lo || v > f.hi ? null : v; }
  out.unreadable = Array.isArray(r.unreadable) ? r.unreadable.filter(s => typeof s === "string").slice(0, 8).map(s => s.slice(0, 40)) : [];
  return out;
}
/* data holds kg for mass fields; the form shows and takes them in the body-weight unit */
function inbodyForm(container, data, source) {
  const u = bu();
  const defDate = data.date || (isFuture(state.selected) ? state.today : state.selected);
  const date = h("input", { id: "ibDate", type: "date", value: defDate, max: state.today });
  const inputs = {};
  const fields = IB_FIELDS.map(f => {
    let pre = data[f.key];
    if (pre != null && f.mass && u === "lb") pre = round1(fromKg(pre, u));
    const inp = h("input", { id: "ib-" + f.key, inputmode: "decimal", autocomplete: "off", value: pre ?? "", placeholder: f.key === "pbf" ? "비우면 자동 계산" : "" });
    inputs[f.key] = inp;
    const unit = ibUnit(f);
    return field("ib-" + f.key, f.label + (unit ? ` (${unit})` : ""), inp);
  });
  const note = h("input", { id: "ibNote", autocomplete: "off", placeholder: "예: 오전 7시, 운동 전, 공복", value: str(data.note, 120) });
  const warn = h("p", { class: "small muted wide", "aria-live": "polite" });
  const msg = h("p", { class: "small muted wide", "aria-live": "polite" });
  const btn = h("button", { class: "btn primary", type: "submit" }, "인바디 결과 저장");
  const showWarn = () => {
    const parts = [];
    if (state.docs.has("inbody_" + date.value)) parts.push(`${fmtDay(date.value)}에 저장된 결과를 대체해요.`);
    if (data.unreadable && data.unreadable.length) parts.push(`읽지 못한 항목: ${data.unreadable.join(", ")}. 필요하면 결과지를 보고 채워 주세요.`);
    warn.textContent = parts.join(" ");
  };
  date.addEventListener("change", showWarn);
  showWarn();
  const form = h("form", { class: "est-grid" }, field("ibDate", "검사 날짜", date), ...fields, field("ibNote", "메모 (측정 조건)", note, "wide"), warn, h("div", { class: "wide row" }, btn), msg);
  form.addEventListener("submit", e => {
    e.preventDefault();
    const d = date.value;
    if (!isYmd(d) || d > state.today) { msg.textContent = "미래가 아닌 검사 날짜를 고르세요."; return; }
    const vals = {};
    for (const f of IB_FIELDS) {
      const raw = inputs[f.key].value.trim();
      let v = raw === "" ? null : num(raw);
      if (v != null && f.mass) v = toKg(v, u);
      if (raw !== "" && (v == null || v < f.lo || v > f.hi)) { msg.textContent = `${f.label} 값이 이상해요. 결과지와 비교해 보세요.`; inputs[f.key].focus(); return; }
      vals[f.key] = v == null ? null : f.mass && u === "lb" ? round2(v) : round1(v);
    }
    if (vals.weight == null && vals.smm == null && vals.fatMass == null) { msg.textContent = "체중, 골격근량, 체지방량 중 하나 이상 입력하세요."; return; }
    if (vals.pbf == null && vals.weight && vals.fatMass != null) vals.pbf = round1((vals.fatMass / vals.weight) * 100);
    btn.disabled = true; sheetBusy = true; msg.textContent = "저장 중…";
    save("inbody_" + d, Object.assign({ kind: "inbody", date: d }, vals, { note: note.value.trim().slice(0, 120), source, createdAt: new Date().toISOString() }))
      .then(() => { sheetBusy = false; closeSheet(true); toast("인바디 결과를 저장했어요."); })
      .catch(() => { sheetBusy = false; btn.disabled = false; msg.textContent = "저장하지 못했어요. 다시 시도하세요."; });
  });
  container.replaceChildren(form);
  container.hidden = false;
}
function openInbodyManual() {
  openSheet("인바디 결과 직접 입력", panel => {
    const box = h("div");
    inbodyForm(box, {}, "manual");
    panel.append(box);
  });
}
function openInbodyPhoto() {
  let blob = null, previewUrl = null, ctl = null;
  openSheet("결과지 사진으로 인바디 기록", panel => {
    const file = h("input", { id: "ibFile", type: "file", accept: state.photo.accept, class: "file-input" });
    const pick = h("label", { for: "ibFile", class: "btn" }, "사진 선택 또는 촬영");
    const img = h("img", { class: "preview", alt: "고른 인바디 결과지", hidden: true });
    const go = h("button", { class: "btn primary", type: "button", disabled: true }, "결과지 읽기");
    const stop = h("button", { class: "btn", type: "button", hidden: true }, "중지");
    const msg = h("p", { class: "small muted", "aria-live": "polite" }, "결과지 전체가 평평하고 초점이 맞게 찍어 주세요. 사진은 내 API 키로 Claude에 보내서 인쇄된 숫자만 읽고, 사진은 저장하지 않아요.");
    const out = h("div", { class: "estimate", hidden: true });
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      go.disabled = true; out.hidden = true; msg.textContent = "사진을 준비하는 중…";
      try {
        blob = (await prepImage(f)).blob;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        img.src = previewUrl; img.hidden = false;
        go.disabled = false; msg.textContent = "‘결과지 읽기’를 누르세요.";
      } catch (e) { msg.textContent = "이미지를 읽지 못했어요. JPEG나 PNG로 해 보세요."; }
    });
    stop.addEventListener("click", () => { if (ctl) ctl.abort(); });
    go.addEventListener("click", async () => {
      if (!blob || !state.sample) return;
      ctl = new AbortController();
      go.disabled = true; stop.hidden = false; out.hidden = true; sheetBusy = true;
      msg.textContent = "결과지를 읽는 중… 최대 1분 걸릴 수 있어요.";
      try {
        const res = await state.sample.json(inbodyPrompt(), { images: [blob], maxTokens: 800, signal: ctl.signal });
        if (res.error) { msg.textContent = "인바디 결과지가 아닌 것 같아요. 다른 사진으로 해 보세요."; return; }
        inbodyForm(out, cleanInbody(res), "photo");
        msg.textContent = "숫자를 하나씩 결과지와 비교한 뒤 저장하세요.";
      } catch (e) {
        msg.textContent = e && e.code === "cancelled" ? "중지했어요." : sampleCopy(e && e.code, e && e.detail);
      } finally { go.disabled = !blob; stop.hidden = true; sheetBusy = false; ctl = null; }
    });
    panel.append(h("div", { class: "row" }, file, pick), img, h("div", { class: "row" }, go, stop), msg, out);
  }, () => { if (ctl) ctl.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl); });
}
function confirmDeleteInbody(r) {
  openSheet("이 인바디 기록을 삭제할까요?", panel => {
    const msg = h("p", { class: "small muted", "aria-live": "polite" });
    const del = h("button", { class: "btn danger", type: "button" }, "기록 삭제");
    const keep = h("button", { class: "btn", type: "button", onclick: () => closeSheet(true) }, "취소");
    del.addEventListener("click", () => {
      sheetBusy = true; del.disabled = true;
      removeDoc(r.id).then(() => { sheetBusy = false; closeSheet(true); toast("인바디 기록을 삭제했어요."); })
        .catch(() => { sheetBusy = false; del.disabled = false; msg.textContent = "삭제하지 못했어요. 다시 시도하세요."; });
    });
    panel.append(h("p", null, `${fmtDay(r.date)} 인바디 기록이 삭제돼요.`), h("div", { class: "row" }, del, keep), msg);
  });
}

/* targets and units */
function renderTargets() {
  const st = settings(), u = st.bodyUnit;
  const put = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v == null ? "" : String(v); el.disabled = !canWrite(); };
  put("#sKcal", st.kcal); put("#sProt", st.protein); put("#sCarb", st.carbs); put("#sFat", st.fat);
  put("#sBodyUnit", st.bodyUnit); put("#sLiftUnit", st.liftUnit);
  put("#sMin", fmtBand(st.rateMin)); put("#sMax", fmtBand(st.rateMax)); put("#sStep", st.step);
  $("#sMinU").textContent = `${u}/주`; $("#sMaxU").textContent = `${u}/주`;
  $("#sSave").disabled = !canWrite();
  const g = (label, v) => (v ? `${label} ${fmtInt(v)} g` : "");
  $("#targetsSub").textContent = (st.kcal || st.protein)
    ? [st.kcal ? fmtInt(st.kcal) + " kcal" : "칼로리 목표 없음", g("단백질", st.protein) || "단백질 목표 없음", g("탄수화물", st.carbs), g("지방", st.fat),
      `주 ${fmtBand(st.rateMin)}–${fmtBand(st.rateMax)} ${u} 감량`, `체중 ${u}, 운동 ${st.liftUnit}`].filter(Boolean).join(" · ")
    : `아직 설정하지 않았어요 · 체중 ${u}, 운동 ${st.liftUnit}`;
}

/* plan reference */
function buildPlan() {
  const body = $("#planBody");
  const sec = (title, ...kids) => h("section", { class: "sec" }, h("div", { class: "sec-head" }, h("h2", null, title)), h("div", { class: "box pad" }, ...kids));
  const exList = key => h("ul", { class: "ex-list" }, GYM[key].items.map(ex => h("li", null,
    h("span", { class: "g" }, ex.g), h("span", null, ex.name, ex.note ? h("span", { class: "muted" }, ` · ${ex.note}`) : null),
    h("span", { class: "sr" }, repLabel(ex)))));
  body.append(
    sec("한 주 구성",
      h("ol", { class: "plan-week" }, [1, 2, 3, 4, 5, 6, 0].map(w => h("li", null, h("b", null, DOW[w]), h("span", null, planLabel(planForWeekday(w)))))),
      h("ul", null,
        h("li", null, "헬스는 약 70분이에요. 천국의 계단 5분 가볍게 → 웨이트 약 45분 → 천국의 계단 15분. 유산소가 웨이트에 지장을 주지 않도록 웨이트를 먼저 해요."),
        h("li", null, "세트마다 1–3회 여유를 남기고 멈추세요. 큰 운동은 2–3분 쉬고, 짝지은 운동(A1/A2)은 번갈아 하며 사이에 60–90초 쉬세요."),
        h("li", null, "모든 세트가 반복 범위 상단에 닿으면 다음엔 가장 작은 단위로 무게를 올리세요. 운동 탭에서 알려 줘요."),
        h("li", null, "기구가 파운드면 운동마다 kg/lb를 바꿔서 기록하세요. 운동별로 마지막에 쓴 단위를 기억해요."),
        h("li", null, "바벨 스쿼트·벤치·RDL이 처음이면 첫 2–3주는 머신이나 덤벨로 가볍게 동작부터 익히세요."))),
    sec("매일",
      h("ul", null,
        h("li", null, "일어나서 화장실에 다녀온 뒤, 먹고 마시기 전에 체중을 재서 기록하세요."),
        h("li", null, "칼로리가 있는 건 모두 기록하세요. 사진으로 추정하거나(API 키 필요) 직접 입력하면 돼요."),
        h("li", null, "단백질 목표를 채우세요 (아래 ‘목표와 단위’에서 설정)."),
        h("li", null, "7시간 이상 자세요.")),
      h("h3", { class: "mt-14" }, "잘 추정되는 식사 사진"),
      h("ul", null,
        h("li", null, "먹기 전에 위에서 찍으세요. 음식이 높이 쌓였으면 비스듬한 사진도 한 장."),
        h("li", null, "크기를 가늠할 수 있게 숟가락, 젓가락, 손이 보이게 찍으세요."),
        h("li", null, "음료, 소스, 반찬도 화면에 담으세요."),
        h("li", null, "카메라로 안 보이는 건 메모로 남기세요. 기름, 설탕, 소스, 실제로 먹은 양이요."),
        h("li", null, "포장 식품은 영양성분표를 찍으세요."))),
    sec(`헬스 A · ${GYM.A.title} (화)`, exList("A")),
    sec(`헬스 B · ${GYM.B.title} (목)`, h("p", { class: "small muted" }, GYM.B.note), exList("B")),
    sec(`헬스 C · ${GYM.C.title} (토)`, h("p", { class: "small muted" }, GYM.C.note), exList("C")),
    sec("인바디 검사",
      h("ul", null,
        h("li", null, "매번 같은 방법으로 재세요. 먹기 전·운동 전, 화장실에 다녀온 뒤, 몇 분 서 있다가, 가능하면 같은 시간대에요."),
        h("li", null, "4주에 한 번 정도면 충분해요. 결과지 사진으로 기록하면 저장 전에 숫자를 확인할 수 있어요."),
        h("li", null, "체중만 보지 말고 골격근량과 체지방량을 같이 보세요. 체지방이 줄면서 근육이 유지되면 잘 되고 있는 거예요."))),
    sec("러닝 (월·수·금)",
      h("ul", null,
        h("li", null, "수요일과 금요일은 웨이트 다음 날이에요. 다리가 무거운 날은 건너뛰지 말고 가볍게 뛰세요."),
        h("li", null, "러닝이 끝나면 시간과 거리를 입력하세요. API 키를 넣었다면 NRC 요약 화면 캡처로 기록할 수도 있어요."),
        h("li", null, "시간과 거리만 있어도 한 주가 채워지는 게 보여요."))));
}

/* ---------- dialogs ---------- */
let sheetReturn = null, sheetCleanup = null, sheetBusy = false;
function openSheet(title, build, cleanup) {
  const sheet = $("#sheet"), panel = $("#sheetPanel");
  sheetReturn = document.activeElement;
  sheetCleanup = cleanup || null;
  sheetBusy = false;
  panel.replaceChildren(h("div", { class: "sheet-head" },
    h("h3", { id: "sheetTitle" }, title),
    h("button", { class: "iconbtn", type: "button", "aria-label": "닫기", onclick: () => closeSheet(true) }, "×")));
  build(panel);
  sheet.hidden = false;
  const first = panel.querySelector(".file-input, input, textarea, select, .btn.primary");
  if (first) first.focus();
}
function closeSheet(force) {
  if (sheetBusy && !force) return;
  const sheet = $("#sheet");
  if (sheet.hidden) return;
  if (sheetCleanup) { try { sheetCleanup(); } catch (e) { /* ignore */ } }
  sheetCleanup = null; sheetBusy = false;
  sheet.hidden = true;
  $("#sheetPanel").replaceChildren();
  if (sheetReturn && document.contains(sheetReturn)) sheetReturn.focus();
}
const defaultTime = () => state.selected === state.today ? nowHM() : "12:00";
const newMealId = (d, t) => `meal_${d}_${(t || "00:00").slice(0, 5).replace(":", "")}_${Math.random().toString(36).slice(2, 7).padEnd(5, "0")}`;

function openManual() {
  openSheet("식사 직접 입력", panel => {
    let thumb = null;
    const name = h("input", { id: "mName", autocomplete: "off", placeholder: "예: 김치찌개와 밥" });
    const time = h("input", { id: "mTime", type: "time", value: defaultTime() });
    const kcal = h("input", { id: "mKcal", inputmode: "numeric", autocomplete: "off" });
    const prot = h("input", { id: "mProt", inputmode: "numeric", autocomplete: "off" });
    const carbs = h("input", { id: "mCarb", inputmode: "numeric", autocomplete: "off", placeholder: "선택" });
    const fat = h("input", { id: "mFat", inputmode: "numeric", autocomplete: "off", placeholder: "선택" });
    const file = h("input", { id: "mFile", type: "file", accept: "image/*", class: "file-input" });
    const pick = h("label", { for: "mFile", class: "btn small" }, "사진 붙이기 (선택)");
    const img = h("img", { class: "preview thumb-prev", alt: "붙인 식사 사진", hidden: true });
    const msg = h("p", { class: "small muted", "aria-live": "polite" });
    const btn = h("button", { class: "btn primary", type: "submit" }, "식사 저장");
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try { thumb = (await prepImage(f)).thumb; img.src = thumb; img.hidden = false; msg.textContent = ""; }
      catch (e) { thumb = null; img.hidden = true; msg.textContent = "이미지를 읽지 못했어요. JPEG나 PNG로 해 보세요."; }
    });
    const form = h("form", { class: "est-grid" },
      field("mName", "메뉴", name, "wide"), field("mTime", "시간", time), field("mKcal", "칼로리 (kcal)", kcal),
      field("mProt", "단백질 (g)", prot), field("mCarb", "탄수화물 (g)", carbs), field("mFat", "지방 (g)", fat),
      h("div", { class: "wide row" }, file, pick), img,
      h("div", { class: "wide row" }, btn), msg);
    form.addEventListener("submit", e => {
      e.preventDefault();
      const k = inRange(kcal.value, 0, 8000);
      if (!name.value.trim() || k == null) { msg.textContent = "메뉴 이름과 칼로리를 입력하세요."; return; }
      sheetBusy = true; btn.disabled = true; msg.textContent = "저장 중…";
      const t = time.value || defaultTime();
      const body = {
        kind: "meal", date: state.selected, time: t.slice(0, 5), name: name.value.trim().slice(0, 80),
        kcal: Math.round(k), protein: clampInt(inRange(prot.value, 0, 400), 0, 400) ?? 0,
        carbs: clampInt(inRange(carbs.value, 0, 1000), 0, 1000), fat: clampInt(inRange(fat.value, 0, 500), 0, 500),
        source: "manual", createdAt: new Date().toISOString(),
      };
      if (thumb) body.thumb = thumb;
      save(newMealId(state.selected, t), body)
        .then(() => { sheetBusy = false; closeSheet(true); toast("식사를 저장했어요."); })
        .catch(() => { sheetBusy = false; btn.disabled = false; msg.textContent = "저장하지 못했어요. 다시 시도하세요."; });
    });
    panel.append(form);
  });
}
function confirmDelete(m) {
  openSheet("이 식사를 삭제할까요?", panel => {
    const msg = h("p", { class: "small muted", "aria-live": "polite" });
    const del = h("button", { class: "btn danger", type: "button" }, "식사 삭제");
    const keep = h("button", { class: "btn", type: "button", onclick: () => closeSheet(true) }, "취소");
    del.addEventListener("click", () => {
      sheetBusy = true; del.disabled = true;
      removeDoc(m.id).then(() => { sheetBusy = false; closeSheet(true); toast("식사를 삭제했어요."); })
        .catch(() => { sheetBusy = false; del.disabled = false; msg.textContent = "삭제하지 못했어요. 다시 시도하세요."; });
    });
    panel.append(h("p", null, `${fmtDay(m.date)} 기록에서 ‘${str(m.name, 80) || "식사"}’ 식사를 삭제해요.`), h("div", { class: "row" }, del, keep), msg);
  });
}

/* photo → estimate */
function canvasFor(src, w, hh, max) {
  const k = Math.min(1, max / Math.max(w, hh));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k));
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c;
}
/* 1568 px on the long edge: larger photos are scaled down by the API anyway, so sending more only costs time */
async function prepImage(file) {
  const img = await decodeImage(file);
  try {
    const blob = await new Promise((res, rej) => canvasFor(img.src, img.w, img.hh, 1568).toBlob(b => b ? res(b) : rej(new Error("encode")), "image/jpeg", 0.85));
    const thumb = canvasFor(img.src, img.w, img.hh, 160).toDataURL("image/jpeg", 0.62);
    return { blob, thumb };
  } finally { img.done(); }
}
function estimatePrompt(note) {
  const n = note.trim().slice(0, 400);
  return [
    "Estimate the nutrition of one meal from the attached photo, for a personal food log.",
    "The person lives in South Korea, so dishes are often Korean. Count rice, soup or stew, and each side dish (banchan) as separate items.",
    n ? `The person's note, which you should trust over the photo for amounts and cooking: ${n}` : "There is no note. Assume typical home or restaurant amounts of oil and sauce.",
    "Write name, every items[].food, every items[].amount and assumptions in natural Korean.",
    "Reply with only a JSON object of this shape:",
    '{"name":"짧은 메뉴 이름","items":[{"food":"음식 이름","amount":"예: 1공기 (약 210 g)","kcal":0,"protein":0}],"kcal":0,"protein":0,"carbs":0,"fat":0,"confidence":"low|medium|high","assumptions":"가정한 양, 기름, 소스를 한 문장으로"}',
    "Total kcal and protein must equal the sum of the items. Use whole numbers; protein, carbs and fat are grams.",
    'If the photo shows no food or drink, reply {"error":"not food"}.',
  ].join("\n");
}
function cleanEstimate(r) {
  const items = Array.isArray(r.items) ? r.items.slice(0, 20).map(it => ({
    food: str(it && it.food, 80) || "항목", amount: str(it && it.amount, 60),
    kcal: clampInt(num(it && it.kcal), 0, 5000) ?? 0, protein: clampInt(num(it && it.protein), 0, 400) ?? 0,
  })) : [];
  return {
    name: str(r.name, 80) || "식사", items,
    kcal: clampInt(num(r.kcal) ?? items.reduce((a, b) => a + b.kcal, 0), 0, 8000),
    protein: clampInt(num(r.protein) ?? items.reduce((a, b) => a + b.protein, 0), 0, 400),
    carbs: clampInt(num(r.carbs), 0, 1000), fat: clampInt(num(r.fat), 0, 500),
    confidence: ["low", "medium", "high"].includes(r.confidence) ? r.confidence : "medium",
    assumptions: str(r.assumptions, 240),
  };
}
function openPhoto() {
  let blob = null, thumb = null, previewUrl = null, ctl = null;
  openSheet("사진으로 식사 기록", panel => {
    const file = h("input", { id: "pFile", type: "file", accept: state.photo.accept, class: "file-input" });
    const pick = h("label", { for: "pFile", class: "btn" }, "사진 선택 또는 촬영");
    const img = h("img", { class: "preview", alt: "고른 식사 사진", hidden: true });
    const time = h("input", { id: "pTime", type: "time", value: defaultTime() });
    const note = h("textarea", { id: "pNote", rows: 2, placeholder: "사진에 안 보이는 것: 기름, 소스, 설탕, 실제로 먹은 양" });
    const go = h("button", { class: "btn primary", type: "button", disabled: true }, "추정하기");
    const stop = h("button", { class: "btn", type: "button", hidden: true }, "중지");
    const msg = h("p", { class: "small muted", "aria-live": "polite" }, "사진을 고르면 시작해요. 사진은 내 API 키로 Claude에 보내 추정하고, 이 휴대폰에는 작은 미리보기만 저장해요.");
    const out = h("div", { class: "estimate", hidden: true });

    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      go.disabled = true; out.hidden = true; msg.textContent = "사진을 준비하는 중…";
      try {
        const prep = await prepImage(f);
        blob = prep.blob; thumb = prep.thumb;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        img.src = previewUrl; img.hidden = false;
        go.disabled = false; msg.textContent = "가려진 게 있으면 메모를 남기고 ‘추정하기’를 누르세요.";
      } catch (e) { msg.textContent = "이미지를 읽지 못했어요. JPEG나 PNG로 해 보세요."; }
    });
    stop.addEventListener("click", () => { if (ctl) ctl.abort(); });
    go.addEventListener("click", async () => {
      if (!blob || !state.sample) return;
      ctl = new AbortController();
      go.disabled = true; stop.hidden = false; out.hidden = true; sheetBusy = true;
      msg.textContent = "생각하는 중… 최대 1분 걸릴 수 있어요.";
      try {
        const res = await state.sample.json(estimatePrompt(note.value), { images: [blob], maxTokens: 2000, signal: ctl.signal });
        if (res.error) { msg.textContent = "음식이나 음료 사진이 아닌 것 같아요. 다른 사진으로 해 보세요."; return; }
        showEstimate(out, cleanEstimate(res), note, time, () => thumb);
        msg.textContent = "숫자를 확인하고, 틀린 건 고친 뒤 저장하세요.";
      } catch (e) {
        msg.textContent = e && e.code === "cancelled" ? "중지했어요." : sampleCopy(e && e.code, e && e.detail);
      } finally { go.disabled = !blob; stop.hidden = true; sheetBusy = false; ctl = null; }
    });
    panel.append(
      h("div", { class: "row" }, file, pick), img,
      h("div", { class: "est-grid" }, field("pTime", "시간", time), field("pNote", "메모 (선택)", note, "wide")),
      h("div", { class: "row" }, go, stop), msg, out);
  }, () => { if (ctl) ctl.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl); });
}
function showEstimate(out, est, noteEl, timeEl, getThumb) {
  const name = h("input", { id: "eName", autocomplete: "off", value: est.name });
  const kcal = h("input", { id: "eKcal", inputmode: "numeric", autocomplete: "off", value: est.kcal ?? "" });
  const prot = h("input", { id: "eProt", inputmode: "numeric", autocomplete: "off", value: est.protein ?? "" });
  const carbs = h("input", { id: "eCarb", inputmode: "numeric", autocomplete: "off", value: est.carbs ?? "" });
  const fat = h("input", { id: "eFat", inputmode: "numeric", autocomplete: "off", value: est.fat ?? "" });
  const msg = h("p", { class: "small muted", "aria-live": "polite" });
  const btn = h("button", { class: "btn primary", type: "button" }, "식사 저장");
  btn.addEventListener("click", () => {
    const k = inRange(kcal.value, 0, 8000);
    if (k == null) { msg.textContent = "칼로리에 숫자를 입력하세요."; return; }
    btn.disabled = true; sheetBusy = true; msg.textContent = "저장 중…";
    const t = timeEl.value || defaultTime();
    const body = {
      kind: "meal", date: state.selected, time: t.slice(0, 5), name: name.value.trim().slice(0, 80) || est.name,
      items: est.items, kcal: Math.round(k), protein: clampInt(inRange(prot.value, 0, 400), 0, 400) ?? 0,
      carbs: clampInt(inRange(carbs.value, 0, 1000), 0, 1000), fat: clampInt(inRange(fat.value, 0, 500), 0, 500),
      confidence: est.confidence, assumptions: est.assumptions, note: noteEl.value.trim().slice(0, 300),
      source: "photo", createdAt: new Date().toISOString(),
    };
    const th = getThumb();
    if (th) body.thumb = th;
    save(newMealId(state.selected, t), body)
      .then(() => { sheetBusy = false; closeSheet(true); toast("식사를 저장했어요."); })
      .catch(() => { sheetBusy = false; btn.disabled = false; msg.textContent = "저장하지 못했어요. 다시 시도하세요."; });
  });
  const confText = ({ low: "낮음", medium: "보통", high: "높음" })[est.confidence] || "보통";
  out.replaceChildren(
    h("div", { class: "est-grid" },
      field("eName", "메뉴", name, "wide"), field("eKcal", "칼로리 (kcal)", kcal), field("eProt", "단백질 (g)", prot),
      field("eCarb", "탄수화물 (g)", carbs), field("eFat", "지방 (g)", fat)),
    est.items.length ? h("ul", { class: "items" }, est.items.map(it => h("li", null,
      h("span", null, it.food, it.amount ? h("span", { class: "muted" }, " · " + it.amount) : null),
      h("span", { class: "num muted" }, `${fmtInt(it.kcal)} kcal · ${fmtInt(it.protein)} g`)))) : null,
    h("p", { class: "small muted" }, `추정치, 신뢰도 ${confText}.${est.assumptions ? " 추정 근거: " + est.assumptions : ""}`),
    h("div", { class: "row" }, btn), msg);
  out.hidden = false;
}

/* ---------- photo reading: the Anthropic Messages API, called from this page with the user's own key ---------- */
const AI_URL = "https://api.anthropic.com/v1/messages";
const MODEL_IDS = ["claude-sonnet-5-5", "claude-haiku-5-5"];
const AI_SYSTEM = "You read photos for a personal diet and training log used in South Korea. Follow the instructions exactly. Reply with one JSON object only: no prose before or after it, no markdown code fences.";
const aiKey = () => (lsGet(LS.key) || "").trim();
const aiModel = () => (lsGet(LS.model) || "").trim() || MODEL_IDS[0];
const aiErr = (code, extra) => Object.assign(new Error(code), { code }, extra || {});
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(",") + 1)); };
    r.onerror = () => rej(r.error || new Error("read"));
    r.readAsDataURL(blob);
  });
}
function parseJsonLoose(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try { return JSON.parse(t); } catch (e) { /* try the outermost braces next */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* give up */ } }
  return null;
}
/* an error body from the API, before or during a stream, as one of the codes sampleCopy explains */
function mapApiError(status, body) {
  const err = (body && body.error) || {}, type = err.type || "", message = String(err.message || "");
  if (status === 401 || type === "authentication_error") return aiErr("bad_key");
  if (/credit balance/i.test(message)) return aiErr("no_credit");
  if (status === 403 || type === "permission_error") return aiErr("forbidden");
  if (status === 404 || type === "not_found_error") return aiErr("no_model");
  if (status === 413 || type === "request_too_large") return aiErr("too_large");
  if (status === 429 || type === "rate_limit_error") return aiErr("rate_limited");
  if (status === 529 || status >= 500 || type === "overloaded_error" || type === "api_error") return aiErr("overloaded");
  return aiErr("bad_request", { detail: message.slice(0, 160) });
}
function postMessages({ body, signal, key }) {
  return fetch(AI_URL, {
    method: "POST", signal, cache: "no-store", referrerPolicy: "no-referrer",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  }).catch(e => {
    if (e && e.name === "AbortError") throw aiErr("cancelled");
    throw aiErr(navigator.onLine === false ? "offline" : "network");
  });
}
async function callClaude({ content, maxTokens, signal, model, key }) {
  const res = await postMessages({ signal, key, body: { model, max_tokens: maxTokens, system: AI_SYSTEM, messages: [{ role: "user", content }] } });
  let body = null;
  try { body = await res.json(); } catch (e) { if (e && e.name === "AbortError") throw aiErr("cancelled"); body = null; }
  if (!res.ok) throw mapApiError(res.status, body);
  if (!body) throw aiErr("empty_completion");
  return body;
}
/* streamed version for long answers (a week of meals takes a minute or two): text arrives as server-sent events,
   so the page can show progress, and a slow phone connection is never idle long enough to be dropped */
async function callClaudeStream({ content, maxTokens, signal, model, key, system, onText }) {
  const res = await postMessages({ signal, key, body: { model, max_tokens: maxTokens, system, stream: true, messages: [{ role: "user", content }] } });
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch (e) { if (e && e.name === "AbortError") throw aiErr("cancelled"); }
    throw mapApiError(res.status, body);
  }
  let text = "", stop = null;
  const usage = { input: 0, output: 0 };
  const handle = block => {
    let data = "";
    for (const line of block.split("\n")) if (line.startsWith("data:")) data += line.slice(5).replace(/^ /, "");
    if (!data) return;
    let ev = null;
    try { ev = JSON.parse(data); } catch (e) { return; }
    if (!isPlainObj(ev)) return;
    if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta" && typeof ev.delta.text === "string") {
      text += ev.delta.text;
      if (onText) onText(text);
    } else if (ev.type === "message_start" && ev.message && ev.message.usage) {
      const u = ev.message.usage;
      usage.input = (num(u.input_tokens) || 0) + (num(u.cache_read_input_tokens) || 0) + (num(u.cache_creation_input_tokens) || 0);
    } else if (ev.type === "message_delta") {
      if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
      if (ev.usage && num(ev.usage.output_tokens) != null) usage.output = num(ev.usage.output_tokens);
    } else if (ev.type === "error") throw mapApiError(0, ev);
  };
  const feed = (() => {
    let buf = "";
    return (chunk, last) => {
      buf += chunk.replace(/\r/g, "");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); handle(block); }
      if (last && buf.trim()) { handle(buf); buf = ""; }
    };
  })();
  try {
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader(), dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        feed(dec.decode(value, { stream: true }), false);
      }
      feed(dec.decode(), true);
    } else feed(await res.text(), true);
  } catch (e) {
    if (e && e.code) throw e;
    if ((e && e.name === "AbortError") || (signal && signal.aborted)) throw aiErr("cancelled");
    throw aiErr(navigator.onLine === false ? "offline" : "network");
  }
  return { text, stop, usage };
}
async function aiJson(prompt, opts = {}) {
  const key = aiKey();
  if (!key) throw aiErr("no_key");
  const content = [];
  for (const b of opts.images || []) content.push({ type: "image", source: { type: "base64", media_type: b.type || "image/jpeg", data: await blobToBase64(b) } });
  content.push({ type: "text", text: prompt });
  const body = await callClaude({ content, maxTokens: opts.maxTokens || 2000, signal: opts.signal, model: aiModel(), key });
  if (body.stop_reason === "refusal") throw aiErr("refused");
  const text = Array.isArray(body.content) ? body.content.filter(c => c && c.type === "text").map(c => c.text).join("") : "";
  if (!text.trim()) throw aiErr("empty_completion");
  const out = parseJsonLoose(text);
  if (!isPlainObj(out)) throw aiErr(body.stop_reason === "max_tokens" ? "truncated" : "invalid_json");
  return out;
}
function sampleCopy(code, detail) {
  return ({
    no_key: "API 키가 없어요. 계획 탭 → ‘데이터와 AI’에서 넣으세요.",
    bad_key: "API 키가 맞지 않아요. 계획 탭 → ‘데이터와 AI’에서 키를 확인하세요.",
    forbidden: "이 키로는 이 요청을 할 수 없어요. Claude Console에서 키 권한을 확인하세요.",
    no_model: "모델을 찾을 수 없어요. 계획 탭 → ‘데이터와 AI’에서 다른 모델을 고르세요.",
    no_credit: "API 크레딧이 부족해요. Claude Console에서 충전한 뒤 다시 시도하세요.",
    too_large: "사진이 너무 커요. 다른 사진으로 해 보세요.",
    rate_limited: "지금 요청이 너무 많아요. 잠시 후 다시 시도하세요.",
    overloaded: "Anthropic 서버가 바빠요. 잠시 후 다시 시도하세요.",
    offline: "인터넷에 연결되어 있지 않아요. 연결된 뒤 다시 시도하세요. 직접 입력은 오프라인에서도 돼요.",
    network: "Anthropic에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도하세요.",
    refused: "이 사진은 처리할 수 없어요. 다른 사진을 쓰거나 메모를 추가하세요.",
    empty_completion: "결과가 오지 않았어요. 다시 시도하세요.",
    invalid_json: "결과를 읽을 수 없었어요. 다시 시도하세요.",
    truncated: "결과가 중간에 끊겼어요. 다시 시도하세요.",
    invalid_plan: "식단을 제대로 만들지 못했어요. 다시 시도하세요.",
    bad_request: "요청이 거절됐어요." + (detail ? ` (${detail})` : ""),
  })[code] || "처리하는 중에 문제가 생겼어요. 다시 시도하세요.";
}
const maskKey = k => (k.length > 16 ? `${k.slice(0, 10)}…${k.slice(-4)}` : "••••");
function wireAi() {
  const keyIn = $("#aiKey"), sel = $("#aiModel"), custom = $("#aiModelCustom"), wrap = $("#aiModelCustomWrap"), msg = $("#aiMsg");
  const cur = aiModel(), known = MODEL_IDS.includes(cur);
  sel.value = known ? cur : "custom";
  custom.value = known ? "" : cur;
  wrap.hidden = sel.value !== "custom";
  sel.addEventListener("change", () => { wrap.hidden = sel.value !== "custom"; if (!wrap.hidden) custom.focus(); });
  $("#aiForm").addEventListener("submit", e => {
    e.preventDefault();
    const k = keyIn.value.trim();
    const model = sel.value === "custom" ? custom.value.trim() : sel.value;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/.test(model)) { msg.textContent = "모델 ID를 확인하세요. 예: claude-sonnet-5-5"; return; }
    if (k && (/\s/.test(k) || k.length < 20)) { msg.textContent = "키를 다시 확인하세요. 공백 없이 전체를 붙여 넣어야 해요."; return; }
    if ((k && !lsSet(LS.key, k)) || !lsSet(LS.model, model)) { msg.textContent = "이 브라우저에 저장하지 못했어요."; return; }
    keyIn.value = "";
    state.photo.ok = !!aiKey();
    msg.textContent = k ? (k.startsWith("sk-ant-") ? "키를 저장했어요. ‘연결 확인’으로 한 번 시험해 보세요." : "저장했어요. 다만 Anthropic 키는 보통 sk-ant- 로 시작해요.") : "모델을 저장했어요.";
    renderAll();
  });
  $("#aiTest").addEventListener("click", async () => {
    const key = aiKey(), btn = $("#aiTest");
    if (!key) return;
    btn.disabled = true; msg.textContent = "확인하는 중…";
    try {
      await callClaude({ content: [{ type: "text", text: "Reply with the word OK." }], maxTokens: 5, model: aiModel(), key });
      msg.textContent = `연결됐어요. ${aiModel()} 모델로 사진을 읽을 수 있어요.`;
    } catch (e) { msg.textContent = sampleCopy(e && e.code, e && e.detail); }
    finally { btn.disabled = !aiKey(); }
  });
  $("#aiClear").addEventListener("click", () => {
    lsSet(LS.key, null);
    state.photo.ok = false;
    msg.textContent = "키를 지웠어요. 사진 읽기가 꺼졌어요.";
    renderAll();
  });
}

/* ---------- diet: daily targets worked out from my profile ---------- */
const ACTIVITY = [
  { v: 1.2, label: "거의 안 움직여요 (운동 안 함)" },
  { v: 1.375, label: "가볍게 움직여요 (주 1–3회 운동)" },
  { v: 1.55, label: "보통이에요 (주 3–5회 운동)" },
  { v: 1.725, label: "많이 움직여요 (주 6–7회 운동)" },
  { v: 1.9, label: "아주 많이 움직여요 (몸 쓰는 일 + 운동)" },
];
const RATES = [0.25, 0.5, 0.75, 1];
const PROT_GPK = [1.6, 1.8, 2, 2.2];
const FAT_PCT = [20, 25, 30];
const KCAL_PER_KG = 7700;   /* the usual estimate of the energy in 1 kg of body weight lost */
const CARB_RNI = 130;       /* g a day: the carbohydrate RNI in the Korean dietary reference intakes */
const pickOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
function profile() {
  const x = state.docs.get("profile") || {};
  const age = inRange(x.age, 18, 90);
  return {
    sex: x.sex === "m" || x.sex === "f" ? x.sex : null,
    age: age == null ? null : Math.round(age),
    heightCm: inRange(x.heightCm, 120, 230),
    weightKg: inRange(x.weightKg, 30, 300),
    goalKg: inRange(x.goalKg, 30, 300),
    activity: pickOf(num(x.activity), ACTIVITY.map(a => a.v), 1.55),
    rateKg: pickOf(num(x.rateKg), RATES, 0.5),
    proteinGpk: pickOf(num(x.proteinGpk), PROT_GPK, 1.8),
    fatPct: pickOf(num(x.fatPct), FAT_PCT, 25),
    tdeeSource: x.tdeeSource === "observed" ? "observed" : "formula",
    prefs: isPlainObj(x.prefs) ? x.prefs : {},
  };
}
const anyProfile = p => !!(p.sex || p.age || p.heightCm);
function saveProfile(patch) {
  const cur = state.docs.get("profile") || {};
  return save("profile", Object.assign({ kind: "profile" }, cur, patch, { updatedAt: new Date().toISOString() }));
}
/* body weight for the targets: the morning-weight trend, else the last InBody weight, else what was typed in the profile */
function weightFor(d, p) {
  const tp = trendAt(d);
  if (tp) return { kg: tp.trend, from: "아침 체중 추세" };
  const ib = inbodies().filter(r => r.date <= d && ibVal(r, "weight") != null).pop();
  if (ib) return { kg: ibVal(ib, "weight"), from: `인바디 ${fmtMD(ib.date)}` };
  if (p.weightKg != null) return { kg: p.weightKg, from: "직접 넣은 체중" };
  return null;
}
/* an InBody basal rate from the last 8 weeks beats the formula; an older one describes a heavier body */
function recentBmr(d) {
  const ib = inbodies().filter(r => r.date <= d && daysBetween(r.date, d) <= 56 && ibVal(r, "bmr") != null).pop();
  return ib ? { kcal: ibVal(ib, "bmr"), date: ib.date } : null;
}
/* maintenance seen in my own records: average logged intake minus the energy of the weight change.
   Needs 10 of the last 14 days logged (800 kcal or more) and the 14-day weight rate. */
function observedTdee(d) {
  const end = d >= state.today ? addDays(state.today, -1) : d;
  let n = 0, sum = 0;
  for (let i = 0; i < 14; i++) { const k = sumOf(mealsOn(addDays(end, -i)), "kcal"); if (k >= 800) { n++; sum += k; } }
  const r = rateAt(end);
  if (n < 10 || r.perWeek == null) return { n, r, tdee: null };
  return { n, r, tdee: Math.round((sum / n - (r.perWeek * KCAL_PER_KG) / 7) / 10) * 10 };
}
/* Mifflin-St Jeor (or a recent InBody BMR) × activity − the deficit for the chosen weekly loss, never below 1,500 / 1,200 kcal.
   Protein from body weight (the goal weight when it is lower), fat as a share of calories, carbohydrate takes the rest. */
function computeTargets(p, d) {
  const w = weightFor(d, p), need = [];
  if (!p.sex) need.push("성별");
  if (!p.age) need.push("나이");
  if (!p.heightCm) need.push("키");
  if (!w) need.push("체중");
  if (need.length) return { ok: false, need };
  const ib = recentBmr(d);
  const bmr = ib ? ib.kcal : 10 * w.kg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "f" ? -161 : 5);
  const formula = bmr * p.activity, obs = observedTdee(d);
  const useObs = p.tdeeSource === "observed" && obs.tdee != null;
  const tdee = useObs ? obs.tdee : formula;
  const deficit = (p.rateKg * KCAL_PER_KG) / 7, floor = p.sex === "f" ? 1200 : 1500;
  const raw = Math.round((tdee - deficit) / 10) * 10, kcal = Math.max(raw, floor);
  const protKg = p.goalKg != null && p.goalKg < w.kg ? p.goalKg : w.kg;
  const protein = Math.round(protKg * p.proteinGpk), fat = Math.round((kcal * p.fatPct) / 900);
  const carbs = Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4));
  return { ok: true, w, ib, bmr, formula, obs, useObs, tdee, deficit, floor, raw, kcal, protKg, protein, fat, carbs,
    pct: { protein: (400 * protein) / kcal, carbs: (400 * carbs) / kcal, fat: (900 * fat) / kcal } };
}
/* the targets a meal plan is built for: what is saved, with fat and carbohydrate filled in when only kcal and protein are */
function fullTargets() {
  const st = settings();
  if (!st.kcal || !st.protein) return null;
  const fat = st.fat ?? Math.round((st.kcal * 25) / 900);
  const carbs = st.carbs ?? Math.max(0, Math.round((st.kcal - 4 * st.protein - 9 * fat) / 4));
  return { kcal: Math.round(st.kcal), protein: Math.round(st.protein), fat: Math.round(fat), carbs: Math.round(carbs) };
}
function macroBar(p, c, f) {
  const parts = [["p", 4 * p], ["c", 4 * c], ["f", 9 * f]], tot = parts.reduce((a, x) => a + x[1], 0) || 1;
  const bar = h("div", { class: "mbar", "aria-hidden": "true" });
  for (const [cls, v] of parts) { const i = h("i", { class: cls }); i.style.width = (v / tot) * 100 + "%"; bar.append(i); }
  return bar;
}
function renderDiet() {
  renderDietTargets();
  renderMealPlan();
}
function renderDietTargets() {
  const box = $("#dtBody"), chip = $("#dtChip"), edit = $("#dtEdit");
  const p = profile(), st = settings(), u = bu(), t = computeTargets(p, state.selected);
  edit.textContent = anyProfile(p) ? "정보 수정" : "정보 입력";
  edit.disabled = !canWrite();
  box.replaceChildren();
  if (!t.ok) {
    chip.hidden = true;
    box.append(
      h("p", null, anyProfile(p) ? `${t.need.join(", ")} 정보가 더 필요해요.` : "성별, 나이, 키를 넣으면 하루 목표 칼로리와 탄수화물·단백질·지방 양을 계산해요."),
      h("p", { class: "small muted" }, t.need.includes("체중")
        ? "체중은 아침 체중 기록의 추세를 써요. 오늘 탭에서 체중을 기록하거나 ‘정보 입력’에서 지금 체중을 넣으세요."
        : "체중은 아침 체중 추세를 쓰니까, 살이 빠지면 목표도 같이 바뀌어요."));
    return;
  }
  const applied = st.kcal === t.kcal && st.protein === t.protein && st.fat === t.fat && st.carbs === t.carbs;
  chip.hidden = false;
  chip.className = "chip" + (applied ? " hold" : "");
  chip.textContent = applied ? "적용 중" : st.kcal ? `지금 목표 ${fmtInt(st.kcal)} kcal` : "아직 적용 안 함";
  const macro = (cls, k, g, pc) => h("li", { class: cls },
    h("span", { class: "k" }, k), h("span", { class: "v num" }, fmtInt(g), h("small", null, "g")), h("span", { class: "pc num" }, `${Math.round(pc)}%`));
  const calc = h("div", { class: "dt-calc" },
    t.useObs
      ? h("p", null, "내 기록으로 본 유지 칼로리 ", h("b", null, `${fmtInt(t.tdee)} kcal`))
      : h("p", null, t.ib ? `인바디 기초대사량 ${fmtInt(t.bmr)} kcal (${fmtMD(t.ib.date)})` : `기초대사량 ${fmtInt(t.bmr)} kcal (Mifflin-St Jeor 공식)`,
        ` × 활동량 ${p.activity} = 유지 칼로리 `, h("b", null, `${fmtInt(t.formula)} kcal`)),
    h("p", null, `− 주 ${fmtBand(p.rateKg)} ${u} 감량분 하루 ${fmtInt(t.deficit)} kcal = `, h("b", null, `${fmtInt(t.raw)} kcal`), t.raw < t.floor ? ` → 하한선 ${fmtInt(t.floor)} kcal` : ""),
    h("p", null, `단백질 ${round1(t.protKg)} kg × ${p.proteinGpk} g · 지방은 칼로리의 ${p.fatPct}% · 나머지는 탄수화물`),
    h("p", null, `체중 ${fmtMass(t.w.kg)} ${u} (${t.w.from})` + (t.protKg !== t.w.kg ? " · 단백질은 목표 체중 기준" : "")));
  const o = t.obs;
  const obsEl = o.tdee != null
    ? h("div", { class: "dt-obs" },
      h("p", { class: "small" }, `내 기록으로 본 유지 칼로리는 약 ${fmtInt(o.tdee)} kcal예요.`, h("span", { class: "muted" }, ` 최근 14일 중 ${o.n}일 기록, ${fmtRate(o.r.perWeek)}.`)),
      h("button", { class: "btn small", type: "button", disabled: !canWrite(), onclick: () => saveProfile({ tdeeSource: t.useObs ? "formula" : "observed" }).catch(() => {}) },
        t.useObs ? "공식으로 계산" : "기록으로 계산"))
    : h("p", { class: "small muted" }, `식사를 14일 중 10일 이상 기록하고 체중 추세가 2주 쌓이면, 내 기록으로 실제 유지 칼로리도 계산해요 (지금 ${o.n}일 기록).`
      + (p.tdeeSource === "observed" ? " 그때까지는 공식으로 계산해요." : ""));
  const warns = [];
  if (t.raw < t.floor) warns.push(`계산값 ${fmtInt(t.raw)} kcal가 안전 하한선보다 낮아서 ${fmtInt(t.floor)} kcal로 올렸어요. 전문가 관리 없이 이보다 적게 먹는 건 권하지 않아요. 감량 속도를 낮춰 보세요.`);
  else if (t.deficit > t.tdee * 0.25) warns.push(`하루 ${fmtInt(t.deficit)} kcal를 줄이는 건 유지 칼로리의 ${Math.round((t.deficit / t.tdee) * 100)}%예요. 피로와 근손실이 커질 수 있으니 감량 속도를 낮추는 것도 생각해 보세요.`);
  if (t.carbs < CARB_RNI) warns.push(`탄수화물이 하루 ${CARB_RNI} g(한국인 권장섭취량)보다 적어요. 지방 비율이나 감량 속도를 낮춰 보세요.`);
  if (p.rateKg < st.rateMin - 0.005 || p.rateKg > st.rateMax + 0.005) warns.push(`목표 감량 속도(주 ${fmtBand(p.rateKg)} ${u})가 주간 점검 범위(주 ${fmtBand(st.rateMin)}–${fmtBand(st.rateMax)} ${u}) 밖이에요. 계획 탭 ‘목표와 단위’에서 범위를 맞추세요.`);
  const apply = h("button", { class: "btn primary", type: "button", disabled: !canWrite() || applied }, applied ? "이 목표를 쓰고 있어요" : "이 목표 적용");
  apply.addEventListener("click", () => {
    apply.disabled = true;
    saveSettings({ kcalTarget: t.kcal, proteinTarget: t.protein, fatTarget: t.fat, carbTarget: t.carbs })
      .then(() => toast("목표를 적용했어요. 오늘 탭과 식단이 이 목표를 따라요."))
      .catch(() => { apply.disabled = false; });
  });
  box.append(
    h("p", { class: "dt-num" }, h("span", { class: "num", id: "dtKcal" }, fmtInt(t.kcal)), h("span", { class: "u" }, "kcal / 하루")),
    macroBar(t.protein, t.carbs, t.fat),
    h("ul", { class: "dt-macros", id: "dtMacros" }, macro("p", "단백질", t.protein, t.pct.protein), macro("c", "탄수화물", t.carbs, t.pct.carbs), macro("f", "지방", t.fat, t.pct.fat)),
    calc, obsEl, ...warns.map(w => h("p", { class: "dt-warn" }, w)),
    h("div", { class: "row" }, apply));
}
function openProfile() {
  const p = profile(), u = bu(), d = state.selected;
  const hasW = !!trendAt(d) || inbodies().some(r => r.date <= d && ibVal(r, "weight") != null);
  openSheet("내 정보", panel => {
    const sel = (id, opts, cur) => { const s = h("select", { id }, opts.map(([v, t]) => h("option", { value: String(v) }, t))); s.value = String(cur); return s; };
    const unitBox = (input, unit) => h("div", { class: "input-unit" }, input, h("span", null, unit));
    const sex = sel("fSex", [["", "고르세요"], ["m", "남성"], ["f", "여성"]], p.sex || "");
    const age = h("input", { id: "fAge", inputmode: "numeric", autocomplete: "off", placeholder: "예: 23", value: p.age ?? "" });
    const ht = h("input", { id: "fHt", inputmode: "decimal", autocomplete: "off", placeholder: "예: 175", value: p.heightCm ?? "" });
    const wt = h("input", { id: "fWt", inputmode: "decimal", autocomplete: "off", value: p.weightKg != null ? String(round1(fromKg(p.weightKg, u))) : "" });
    const goal = h("input", { id: "fGoal", inputmode: "decimal", autocomplete: "off", placeholder: "선택", value: p.goalKg != null ? String(round1(fromKg(p.goalKg, u))) : "" });
    const act = sel("fAct", ACTIVITY.map(a => [a.v, `${a.label} · ×${a.v}`]), p.activity);
    const rate = sel("fRate", RATES.map(r => [r, `주 ${fmtBand(r)} ${u}` + (r === 0.5 ? " (기본)" : "")]), p.rateKg);
    const prot = sel("fProt", PROT_GPK.map(g => [g, `체중 1 kg당 ${g} g` + (g === 1.8 ? " (기본)" : "")]), p.proteinGpk);
    const fat = sel("fFat", FAT_PCT.map(f => [f, `칼로리의 ${f}%` + (f === 25 ? " (기본)" : "")]), p.fatPct);
    const msg = h("p", { class: "small muted wide", "aria-live": "polite" });
    const btn = h("button", { class: "btn primary", type: "submit" }, "저장");
    const form = h("form", { class: "est-grid" },
      field("fSex", "성별", sex), field("fAge", "나이", unitBox(age, "세")), field("fHt", "키", unitBox(ht, "cm")),
      hasW ? null : field("fWt", "지금 체중", unitBox(wt, u)),
      field("fGoal", "목표 체중", unitBox(goal, u)),
      field("fAct", "평소 활동량", act, "wide"),
      h("p", { class: "small muted wide" }, "주 6회 운동(월·수·금 러닝, 화·목·토 헬스)은 ‘많이 움직여요’에 해당하지만, 하루 대부분을 앉아서 보내면 ‘보통’이 더 맞을 수 있어요. 2주쯤 기록한 뒤 ‘기록으로 계산’을 쓰면 실제 소모량에 맞춰져요."),
      field("fRate", "감량 속도", rate), field("fProt", "단백질", prot), field("fFat", "지방", fat),
      h("div", { class: "wide row" }, btn), msg);
    form.addEventListener("submit", e => {
      e.preventDefault();
      const lo = u === "lb" ? 66 : 30, hi = u === "lb" ? 660 : 300;
      const a = inRange(age.value, 18, 90), hc = inRange(ht.value, 120, 230);
      const w = hasW ? null : inRange(wt.value, lo, hi), g = goal.value.trim() ? inRange(goal.value, lo, hi) : null;
      if (!sex.value) { msg.textContent = "성별을 고르세요. 기초대사량 공식이 성별마다 달라요."; return; }
      if (a == null) { msg.textContent = "나이를 18–90 사이로 입력하세요. 이 계산은 성인 기준이에요."; return; }
      if (hc == null) { msg.textContent = "키를 cm로 입력하세요. 예: 175"; return; }
      if (!hasW && w == null) { msg.textContent = `지금 체중을 ${u}로 입력하세요.`; return; }
      if (goal.value.trim() && g == null) { msg.textContent = `목표 체중을 ${u}로 다시 확인하세요.`; return; }
      btn.disabled = true; sheetBusy = true; msg.textContent = "저장 중…";
      saveProfile({
        sex: sex.value, age: Math.round(a), heightCm: round1(hc), weightKg: hasW ? p.weightKg : round2(toKg(w, u)), goalKg: g == null ? null : round2(toKg(g, u)),
        activity: num(act.value), rateKg: num(rate.value), proteinGpk: num(prot.value), fatPct: num(fat.value),
      }).then(() => { sheetBusy = false; closeSheet(true); toast("내 정보를 저장했어요."); })
        .catch(() => { sheetBusy = false; btn.disabled = false; msg.textContent = "저장하지 못했어요. 다시 시도하세요."; });
    });
    panel.append(form);
  });
}

/* ---------- diet: a week of meals written by Claude, scaled on this phone to the day's calorie target ---------- */
const SLOTS = ["아침", "점심", "간식", "저녁"];
const SLOT_TIME = { 아침: "08:00", 점심: "12:30", 간식: "16:00", 저녁: "19:00" };
const CATS = ["채소·과일", "육류·해산물", "달걀·유제품·두부", "곡류·면·빵", "양념·소스", "기타"];
const COUNT_UNITS = ["개", "장", "모", "팩", "봉", "캔", "줄", "알", "쪽", "단", "송이", "마리", "공기", "컵"];
const PLAN_SYSTEM = "You plan meals for a personal diet and training log used in South Korea. Follow the instructions exactly. Reply with one JSON object only: no prose before or after it, no markdown code fences.";
const clampTo = (v, lo, hi) => (v == null || !Number.isFinite(v) ? lo : Math.min(hi, Math.max(lo, v)));
/* the stated calories must agree with 4/4/9 kcal per gram of protein, carbohydrate and fat; when they don't, the grams win */
function macroOf(o) {
  const prot = clampTo(num(o.prot), 0, 300), carb = clampTo(num(o.carb), 0, 600), fat = clampTo(num(o.fat), 0, 300);
  const atw = 4 * prot + 4 * carb + 9 * fat;
  let kcal = clampTo(num(o.kcal), 0, 4000);
  if (atw > 0 && (kcal <= 0 || Math.abs(kcal - atw) / atw > 0.12)) kcal = atw;
  return { kcal: Math.round(kcal), prot: round1(prot), carb: round1(carb), fat: round1(fat) };
}
/* accepts Claude's reply or a saved plan (same shape) and keeps only what the screens can trust */
function normPlan(raw) {
  const recipes = [], ids = new Set();
  for (const r of (Array.isArray(raw.recipes) ? raw.recipes : []).slice(0, 16)) {
    if (!isPlainObj(r) || typeof r.id !== "string" || !/^[A-Za-z0-9_-]{1,12}$/.test(r.id) || ids.has(r.id)) continue;
    const ing = (Array.isArray(r.ing) ? r.ing : []).slice(0, 24).filter(isPlainObj).map(x => {
      const cat = num(x.cat);
      return { n: str(x.n, 40).trim(), q: clampTo(num(x.q), 0, 5000), u: str(x.u, 8).trim() || "g", cat: Number.isInteger(cat) && cat >= 0 && cat < CATS.length ? cat : CATS.length - 1 };
    }).filter(x => x.n && x.q > 0);
    const m = macroOf(r);
    if (!ing.length || m.kcal < 30) continue;
    ids.add(r.id);
    recipes.push(Object.assign({ id: r.id, name: str(r.name, 60).trim() || "레시피", min: clampInt(num(r.min), 0, 240), ing,
      steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 10).map(s => str(s, 220).trim()).filter(Boolean) }, m));
  }
  const rawDays = Array.isArray(raw.days) ? raw.days : [], days = [];
  for (let i = 0; i < 7; i++) {
    const day = isPlainObj(rawDays[i]) ? rawDays[i] : {}, meals = [];
    for (const m of (Array.isArray(day.meals) ? day.meals : []).slice(0, 6)) {
      if (!isPlainObj(m) || !SLOTS.includes(m.s)) continue;
      if (typeof m.r === "string" && ids.has(m.r)) meals.push({ s: m.s, r: m.r, x: clampTo(num(m.x) ?? 1, 0.25, 3) });
      else if (isPlainObj(m.out)) {
        const mm = macroOf(m.out);
        if (mm.kcal >= 30) meals.push({ s: m.s, out: Object.assign({ name: str(m.out.name, 60).trim() || "외식", tip: str(m.out.tip, 160).trim() }, mm) });
      }
    }
    meals.sort((a, b) => SLOTS.indexOf(a.s) - SLOTS.indexOf(b.s));
    days.push({ note: str(day.note, 160).trim(), meals });
  }
  return { recipes, days, tips: (Array.isArray(raw.tips) ? raw.tips : []).slice(0, 5).map(s => str(s, 160).trim()).filter(Boolean) };
}
function mealPlanDoc(mon) { const d = state.docs.get("mealplan_" + mon); return isPlainObj(d) ? d : null; }
function readPlan(doc, mon) {
  return Object.assign(normPlan(doc), {
    id: "mealplan_" + mon, date: mon, pid: str(doc.pid, 12) || "p", checked: isPlainObj(doc.checked) ? doc.checked : {},
    targets: isPlainObj(doc.targets) ? doc.targets : {}, createdAt: str(doc.createdAt, 40), usage: isPlainObj(doc.usage) ? doc.usage : null,
  });
}
/* each day's home-cooked portions are scaled (0.7–1.3×, in 0.05 steps) so the day meets today's calorie target,
   so a new target after a weekly check changes the portions without asking Claude again */
function planView(plan) {
  const target = settings().kcal || num(plan.targets.kcal) || null;
  const byId = new Map(plan.recipes.map(r => [r.id, r]));
  return plan.days.map((day, di) => {
    let home = 0, out = 0;
    for (const m of day.meals) { if (m.out) out += m.out.kcal; else home += byId.get(m.r).kcal * m.x; }
    const f = target && home > 0 ? Math.min(1.3, Math.max(0.7, (target - out) / home)) : 1;
    const meals = day.meals.map((m, mi) => {
      if (m.out) return { mi, s: m.s, name: m.out.name, tip: m.out.tip, kcal: m.out.kcal, protein: m.out.prot, carbs: m.out.carb, fat: m.out.fat };
      const r = byId.get(m.r), x = Math.max(0.25, Math.round(m.x * f * 20) / 20);
      return { mi, s: m.s, name: r.name, recipe: r, x, kcal: r.kcal * x, protein: r.prot * x, carbs: r.carb * x, fat: r.fat * x };
    });
    return { di, date: addDays(plan.date, di), note: day.note, meals, target,
      total: { kcal: sumOf(meals, "kcal"), protein: sumOf(meals, "protein"), carbs: sumOf(meals, "carbs"), fat: sumOf(meals, "fat") } };
  });
}
function shoppingList(view) {
  const map = new Map();
  for (const day of view) for (const m of day.meals) {
    if (!m.recipe) continue;
    for (const g of m.recipe.ing) {
      const key = `${g.n}|${g.u}`, cur = map.get(key) || { key, n: g.n, u: g.u, cat: g.cat, q: 0 };
      cur.q += g.q * m.x;
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => a.cat - b.cat || a.n.localeCompare(b.n, "ko"));
}
/* grams round to what a scale shows; a shopping list rounds countable things up to whole ones */
function fmtQty(q, u, buy) {
  if (u === "g" || u === "ml") {
    const r = q < 10 ? Math.max(1, Math.round(q)) : q < 100 ? Math.round(q / 5) * 5 : q < 1000 ? Math.round(q / 10) * 10 : Math.round(q / 50) * 50;
    return r >= 1000 ? `${+(r / 1000).toFixed(2)} ${u === "g" ? "kg" : "L"}` : `${fmtInt(r)} ${u}`;
  }
  const r = buy && COUNT_UNITS.includes(u) ? Math.max(1, Math.ceil(q - 0.05)) : Math.max(0.5, Math.round(q * 2) / 2);
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + (/^[A-Za-z]/.test(u) ? " " : "") + u;
}
const fmtServ = x => `${+x.toFixed(2)}인분`;
function planMealRow(plan, day, m) {
  const ref = `${plan.pid}|${day.di}|${m.mi}`, logged = mealsOn(day.date).some(x => x.planRef === ref);
  const sub = (m.recipe ? [fmtServ(m.x), m.recipe.min ? `${m.recipe.min}분` : ""] : [m.tip]).concat(`단백질 ${fmtInt(m.protein)} g`).filter(Boolean).join(" · ");
  const main = m.recipe
    ? h("button", { class: "mp-main", type: "button", onclick: () => openRecipe(m.recipe, m.x) }, h("span", { class: "mp-name link" }, m.name), h("span", { class: "mp-sub" }, sub))
    : h("div", { class: "mp-main" }, h("span", { class: "mp-name" }, m.name), h("span", { class: "mp-sub" }, sub));
  const eat = h("button", { class: "btn small eat" + (logged ? " done" : ""), type: "button", disabled: logged || !canWrite() || isFuture(day.date) }, logged ? "기록됨" : "먹었어요");
  if (!logged) eat.addEventListener("click", () => { eat.disabled = true; eatFromPlan(plan, day, m).catch(() => { eat.disabled = false; }); });
  return h("div", { class: "mp-meal" },
    h("span", { class: "mp-slot" }, m.s), main,
    h("span", { class: "mp-right" }, h("span", { class: "mp-k" }, h("b", { class: "num" }, fmtInt(m.kcal)), h("small", null, "kcal")), eat));
}
function eatFromPlan(plan, day, m) {
  const ref = `${plan.pid}|${day.di}|${m.mi}`;
  if (!canWrite() || isFuture(day.date) || mealsOn(day.date).some(x => x.planRef === ref)) return Promise.resolve();
  const t = SLOT_TIME[m.s] || "12:00";
  const body = {
    kind: "meal", date: day.date, time: t, name: m.name.slice(0, 80),
    kcal: Math.round(m.kcal), protein: Math.round(m.protein), carbs: Math.round(m.carbs), fat: Math.round(m.fat),
    assumptions: (m.recipe
      ? `식단표 레시피 ${fmtServ(m.x)}: ` + m.recipe.ing.map(g => `${g.n} ${fmtQty(g.q * m.x, g.u)}`).join(", ")
      : "식단표의 외식 예상치" + (m.tip ? `. ${m.tip}` : "")).slice(0, 240),
    source: "plan", planRef: ref, createdAt: new Date().toISOString(),
  };
  return save(newMealId(day.date, t), body).then(() => toast(`${m.s} 식사를 기록했어요.`));
}
function openRecipe(r, x) {
  openSheet(r.name, panel => {
    panel.append(
      h("p", { class: "small muted" }, [fmtServ(x), r.min ? `약 ${r.min}분` : ""].filter(Boolean).join(" · ")),
      h("p", { class: "rc-macros" },
        h("span", null, h("b", { class: "num" }, fmtInt(r.kcal * x)), " kcal"), h("span", { class: "p" }, "단백질 ", h("b", { class: "num" }, fmtInt(r.prot * x)), " g"),
        h("span", { class: "c" }, "탄수화물 ", h("b", { class: "num" }, fmtInt(r.carb * x)), " g"), h("span", { class: "f" }, "지방 ", h("b", { class: "num" }, fmtInt(r.fat * x)), " g")),
      h("h4", { class: "rc-h" }, "재료"),
      h("ul", { class: "rc-ing" }, r.ing.map(g => h("li", null, h("span", null, g.n), h("span", { class: "num muted" }, fmtQty(g.q * x, g.u))))));
    if (r.steps.length) panel.append(h("h4", { class: "rc-h" }, "만드는 법"), h("ol", { class: "rc-steps" }, r.steps.map(s => h("li", null, s))));
    panel.append(h("p", { class: "small muted" }, "영양값은 재료 양으로 계산한 추정치예요. 알레르기가 있으면 재료를 꼭 확인하세요."));
  });
}
function renderTodayPlan() {
  const sec = $("#todayPlan"), d = state.selected, mon = mondayOf(d), doc = mealPlanDoc(mon);
  const day = doc ? planView(readPlan(doc, mon))[daysBetween(mon, d)] : null;
  sec.hidden = !day || !day.meals.length;
  if (sec.hidden) return;
  const plan = readPlan(doc, mon);
  $("#todayPlanH").textContent = d === state.today ? "오늘의 식단" : `${fmtDay(d)} 식단`;
  $("#todayPlanList").replaceChildren(...day.meals.map(m => planMealRow(plan, day, m)));
}
function renderMealPlan() {
  const mon = mondayOf(state.selected), thisMon = mondayOf(state.today), doc = mealPlanDoc(mon), t = fullTargets(), key = !!aiKey();
  $("#mpH").textContent = mon === thisMon ? "이번 주 식단" : mon === addDays(thisMon, 7) ? "다음 주 식단" : `${fmtMD(mon)} 주 식단`;
  const gen = $("#mpGen");
  gen.textContent = doc ? "다시 만들기" : "식단 만들기";
  gen.disabled = !canWrite() || !key || !t;
  $("#shopSec").hidden = !doc;
  $("#recSec").hidden = !doc;
  const body = $("#mpBody"), note = $("#mpNote");
  body.replaceChildren();
  if (!doc) {
    body.append(h("div", { class: "mp-empty" }, !key
      ? [h("p", null, "식단은 내 Anthropic API 키로 Claude가 짜요."), h("p", { class: "small muted" }, "계획 탭 → ‘데이터와 AI’에서 키를 넣으면 쓸 수 있어요."), h("a", { class: "btn small", href: "#plan" }, "API 키 넣으러 가기")]
      : !t ? [h("p", null, "식단을 짜려면 하루 칼로리와 단백질 목표가 있어야 해요."), h("p", { class: "small muted" }, "위의 ‘하루 목표’를 계산해서 적용하세요.")]
      : [h("p", null, "목표에 맞춘 월–일 7일 식단과 레시피, 장보기 목록을 만들어요."),
        h("p", { class: "small muted" }, `하루 ${fmtInt(t.kcal)} kcal · 단백질 ${fmtInt(t.protein)} g · 탄수화물 ${fmtInt(t.carbs)} g · 지방 ${fmtInt(t.fat)} g 기준이에요. 운동하는 날과 쉬는 날을 나눠 짜고, 같은 레시피를 여러 번 써서 장보기를 줄여요. 만드는 데 1–2분 걸려요.`)]));
    note.textContent = "";
    return;
  }
  const plan = readPlan(doc, mon), view = planView(plan), day = view[daysBetween(mon, state.selected)];
  const dev = day.target ? Math.round((day.total.kcal / day.target - 1) * 100) : null;
  body.append(
    h("div", { class: "mp-days", role: "group", "aria-label": "요일 고르기" }, view.map(v => h("button", {
      class: "mp-day", type: "button", "aria-pressed": String(v.date === state.selected), "aria-label": fmtDayLong(v.date), onclick: () => select(v.date),
    }, h("span", { class: "d" }, DOW[weekday(v.date)]), h("span", { class: "n num" }, String(fromYmd(v.date).getDate()))))),
    day.meals.length ? h("div", { class: "mp-list" }, day.meals.map(m => planMealRow(plan, day, m))) : h("p", { class: "empty" }, "이 날은 식단이 비어 있어요."),
    h("div", { class: "mp-total" },
      h("p", null, "합계 ", h("b", { class: "num", id: "mpTotalK" }, `${fmtInt(day.total.kcal)} kcal`),
        day.target ? h("span", { class: dev != null && Math.abs(dev) > 7 ? "warn-text" : "muted" }, ` · 목표 ${fmtInt(day.target)} kcal (${dev > 0 ? "+" : dev < 0 ? MINUS : "±"}${Math.abs(dev)}%)`) : null),
      h("p", { class: "muted" }, `단백질 ${fmtInt(day.total.protein)} g · 탄수화물 ${fmtInt(day.total.carbs)} g · 지방 ${fmtInt(day.total.fat)} g`)));
  if (day.note) body.append(h("p", { class: "mp-note" }, day.note));
  const u = plan.usage, made = plan.createdAt && new Date(plan.createdAt);
  note.textContent = "AI가 짠 식단이에요. 영양값은 재료 양으로 계산한 추정치이고, 하루 목표가 바뀌면 집밥 양(인분)을 자동으로 맞춰요. 알레르기가 있으면 재료를 꼭 확인하세요."
    + (made && made.getTime() > 0 ? ` ${fmtMD(ymd(made))}에 만듦` + (u ? ` · 입력 ${fmtInt(num(u.input) || 0)} · 출력 ${fmtInt(num(u.output) || 0)} 토큰.` : ".") : "");
  renderShopping(plan, view);
  renderRecipes(plan, view);
}
function renderShopping(plan, view) {
  const items = shoppingList(view), box = $("#shopBody"), left = items.filter(i => !plan.checked[i.key]).length;
  box.replaceChildren(h("p", { class: "small muted" }, !items.length ? "집밥 재료가 없어요." : left ? `${items.length}가지 중 ${left}가지 남았어요.` : "다 샀어요."));
  let n = 0;
  for (let ci = 0; ci < CATS.length; ci++) {
    const list = items.filter(i => i.cat === ci);
    if (!list.length) continue;
    box.append(h("div", { class: "shop-group" }, h("h3", null, CATS[ci]), h("ul", null, list.map(it => {
      const id = "shop" + n++, on = !!plan.checked[it.key];
      const cb = h("input", { type: "checkbox", id, checked: on, disabled: !canWrite() });
      cb.addEventListener("change", () => toggleShop(plan.id, it.key, cb.checked));
      return h("li", null, h("label", { class: "shop-item" + (on ? " done" : ""), for: id }, cb, h("span", { class: "nm" }, it.n), h("span", { class: "q" }, fmtQty(it.q, it.u, true))));
    }))));
  }
  $("#shopCopy").disabled = !items.length;
}
function toggleShop(id, key, on) {
  const cur = state.docs.get(id);
  if (!isPlainObj(cur)) return;
  const checked = Object.assign({}, isPlainObj(cur.checked) ? cur.checked : {});
  if (on) checked[key] = true; else delete checked[key];
  save(id, Object.assign({}, cur, { checked })).catch(() => {});
}
async function copyShopping() {
  const mon = mondayOf(state.selected), doc = mealPlanDoc(mon);
  if (!doc) return;
  const plan = readPlan(doc, mon), items = shoppingList(planView(plan)), left = items.filter(i => !plan.checked[i.key]), use = left.length ? left : items;
  const lines = [`장보기 · ${fmtMD(mon)} 주`];
  for (let ci = 0; ci < CATS.length; ci++) {
    const list = use.filter(i => i.cat === ci);
    if (list.length) lines.push("", `[${CATS[ci]}]`, ...list.map(i => `- ${i.n} ${fmtQty(i.q, i.u, true)}`));
  }
  const text = lines.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast(left.length && left.length < items.length ? `아직 안 산 재료 ${left.length}가지를 복사했어요.` : `재료 ${use.length}가지를 복사했어요.`);
  } catch (e) {
    openSheet("장보기 목록", panel => {
      const ta = h("textarea", { rows: 14, readonly: true, "aria-label": "장보기 목록" });
      ta.value = text;
      panel.append(h("p", { class: "small muted" }, "자동으로 복사하지 못했어요. 길게 눌러 전체 선택한 뒤 복사하세요."), ta);
    });
  }
}
function renderRecipes(plan, view) {
  const uses = new Map();
  for (const d of view) for (const m of d.meals) if (m.recipe) uses.set(m.recipe.id, (uses.get(m.recipe.id) || 0) + 1);
  $("#recH").textContent = `레시피 ${plan.recipes.length}가지`;
  const box = $("#recBody");
  box.replaceChildren(
    h("ul", { class: "rec-list" }, plan.recipes.map(r => h("li", null, h("button", { class: "rec-btn", type: "button", onclick: () => openRecipe(r, 1) },
      h("span", { class: "nm" }, r.name),
      h("span", { class: "small muted" }, [uses.get(r.id) ? `${uses.get(r.id)}번 먹어요` : "", r.min ? `${r.min}분` : "", `1인분 ${fmtInt(r.kcal)} kcal · 단백질 ${fmtInt(r.prot)} g`].filter(Boolean).join(" · ")))))));
  if (plan.tips.length) box.append(h("div", { class: "rec-tips" }, h("h3", null, "미리 해 두면 좋은 것"), h("ul", null, plan.tips.map(s => h("li", null, s)))));
}
function planPrompt(t, prefs, mon) {
  const EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const gym = { A: "gym, upper body, about 70 minutes including 20 minutes on a stair climber", B: "gym, full body, about 70 minutes including 20 minutes on a stair climber", C: "gym, legs, the hardest session of the week, about 70 minutes" };
  const week = [];
  for (let i = 0; i < 7; i++) { const p = planFor(addDays(mon, i)); week.push(`- ${DOW[(i + 1) % 7]} (${EN[i]}): ${p.kind === "run" ? "running" : p.kind === "gym" ? gym[p.key] : "rest day"}`); }
  const cook = ({
    quick: "Keep every recipe to 15 minutes or less of hands-on cooking.",
    normal: "Recipes can take up to 30 minutes.",
    prep: "The person cooks in big batches on the weekend: main dishes must keep 3 to 4 days in the fridge, and weekday meals should only need reheating or assembling.",
  })[prefs.cook] || "Keep every recipe to 15 minutes or less of hands-on cooking.";
  return [
    "Plan one week of meals, Monday to Sunday, for one adult in South Korea who is losing fat while strength training and running.",
    `Daily targets, the same every day: ${t.kcal} kcal, protein at least ${t.protein} g, carbohydrate about ${t.carbs} g, fat about ${t.fat} g. Each day's total must be within 5% of ${t.kcal} kcal.`,
    "Training this week:", ...week,
    "On training days put more of the day's carbohydrate in the meals before and after training. Spread protein over the day, at least 25 g in each main meal.",
    `Meals every day, in this order: ${prefs.snack ? "아침, 점심, 간식, 저녁" : "아침, 점심, 저녁"}. Use exactly these Korean slot names in "s".`,
    prefs.eatOut
      ? 'Monday to Friday 점심 is eaten at a university cafeteria (학식) or a restaurant. For those meals give no recipe: give an "out" entry with a typical Korean choice that fits the targets, one short tip on how much to eat, and typical nutrition for that portion.'
      : "Every meal is cooked at home from one of the recipes.",
    cook,
    prefs.avoid ? `Never use these foods or anything made from them: ${prefs.avoid}` : "",
    prefs.likes ? `The person likes or already has these; use them where they fit: ${prefs.likes}` : "",
    "Recipes:",
    "- Write 5 to 9 recipes and use each on at least two days, so the week needs little cooking and a short shopping list.",
    "- Breakfast recipes take 10 minutes or less. Use ingredients sold at ordinary Korean supermarkets.",
    "- Ingredient amounts are for ONE serving: grams or ml where possible, eggs in 개, seasonings in 큰술 or 작은술.",
    "- Nutrition is for ONE serving, computed from those ingredient amounts with standard food composition values such as the Korean national food composition table. Rice means cooked rice; meat is raw weight. kcal must equal 4×prot + 4×carb + 9×fat within 5%.",
    "- At most 5 short steps per recipe.",
    '- A meal can use more or less than one serving of a recipe with "x" (0.5 to 2) so the day meets its targets.',
    "Ingredient category numbers: 0 채소·과일, 1 육류·해산물, 2 달걀·유제품·두부, 3 곡류·면·빵, 4 양념·소스, 5 기타.",
    "Write every name, ingredient, step, note and tip in natural Korean.",
    "Reply with only a JSON object of this shape:",
    '{"recipes":[{"id":"r1","name":"레시피 이름","min":10,"ing":[{"n":"재료","q":150,"u":"g","cat":1}],"steps":["짧은 한 문장"],"kcal":0,"prot":0,"carb":0,"fat":0}],'
      + '"days":[{"day":"월","note":"이 날의 짧은 팁 한 문장","meals":[{"s":"아침","r":"r1","x":1}'
      + (prefs.eatOut ? ',{"s":"점심","out":{"name":"학식 메뉴","tip":"양 조절 팁","kcal":0,"prot":0,"carb":0,"fat":0}}' : "")
      + ']}],"tips":["주말에 미리 해 두면 좋은 준비 한 문장"]}',
    '"days" has exactly 7 entries, Monday first. Every "r" is the id of a recipe in "recipes". Use whole numbers for kcal and grams.',
  ].filter(Boolean).join("\n");
}
function openPlanMaker() {
  const t = fullTargets(), mon = mondayOf(state.selected), id = "mealplan_" + mon, had = state.docs.has(id), pr = profile().prefs;
  if (!t || !aiKey() || !canWrite()) return;
  let ctl = null;
  openSheet(`${fmtMD(mon)} 주 식단 만들기`, panel => {
    const avoid = h("input", { id: "gAvoid", autocomplete: "off", placeholder: "예: 땅콩, 새우, 오이", value: str(pr.avoid, 120) });
    const likes = h("input", { id: "gLikes", autocomplete: "off", placeholder: "예: 닭가슴살, 두부, 고구마, 김치", value: str(pr.likes, 120) });
    const cook = h("select", { id: "gCook" }, [["quick", "간단하게 (한 끼 15분 이내)"], ["normal", "보통 (30분 이내)"], ["prep", "주말에 몰아서 만들어 두기"]].map(([v, l]) => h("option", { value: v }, l)));
    cook.value = ["quick", "normal", "prep"].includes(pr.cook) ? pr.cook : "quick";
    const out = h("input", { id: "gOut", type: "checkbox", checked: pr.eatOut === true });
    const snack = h("input", { id: "gSnack", type: "checkbox", checked: pr.snack !== false });
    const go = h("button", { class: "btn primary", type: "button" }, had ? "새로 만들기" : "만들기");
    const stop = h("button", { class: "btn", type: "button", hidden: true }, "중지");
    const msg = h("p", { class: "small muted", "aria-live": "polite" }, had ? "지금 식단은 새 식단으로 바뀌어요. ‘먹었어요’로 기록한 식사는 그대로 남아요." : "1–2분 걸려요. 만드는 동안 화면을 켜 두세요.");
    stop.addEventListener("click", () => { if (ctl) ctl.abort(); });
    go.addEventListener("click", async () => {
      const prefs = { avoid: avoid.value.trim().slice(0, 120), likes: likes.value.trim().slice(0, 120), cook: cook.value, eatOut: out.checked, snack: snack.checked };
      ctl = new AbortController();
      go.disabled = true; stop.hidden = false; sheetBusy = true;
      const t0 = Date.now();
      let progress = "Claude에게 요청하는 중…", lock = null;
      const show = () => { msg.textContent = `${progress} ${Math.round((Date.now() - t0) / 1000)}초`; };
      show();
      const tick = setInterval(show, 1000);
      try { if (navigator.wakeLock && navigator.wakeLock.request) lock = await navigator.wakeLock.request("screen"); } catch (e) { lock = null; }
      try {
        saveProfile({ prefs }).catch(() => {});
        const res = await callClaudeStream({
          content: [{ type: "text", text: planPrompt(t, prefs, mon) }], maxTokens: 12000, signal: ctl.signal, model: aiModel(), key: aiKey(), system: PLAN_SYSTEM,
          onText: txt => {
            const nr = (txt.match(/"steps"\s*:/g) || []).length, nd = (txt.match(/"meals"\s*:/g) || []).length;
            progress = nd ? `요일별 식단을 쓰는 중 (${Math.min(nd, 7)}/7)` : nr ? `레시피를 쓰는 중 (${nr}개)` : "쓰기 시작했어요";
          },
        });
        if (res.stop === "refusal") throw aiErr("refused");
        const raw = parseJsonLoose(res.text);
        if (!isPlainObj(raw)) throw aiErr(res.stop === "max_tokens" ? "truncated" : "invalid_json");
        const plan = normPlan(raw);
        if (plan.recipes.length < 2 || plan.days.some(d => !d.meals.length)) throw aiErr(res.stop === "max_tokens" ? "truncated" : "invalid_plan");
        await save(id, Object.assign({
          kind: "mealplan", date: mon, pid: Math.random().toString(36).slice(2, 8), createdAt: new Date().toISOString(),
          model: aiModel(), targets: t, prefs, usage: res.usage, checked: {},
        }, plan));
        clearInterval(tick);
        sheetBusy = false;
        closeSheet(true);
        toast(`${fmtMD(mon)} 주 식단을 만들었어요.`);
      } catch (e) {
        clearInterval(tick);
        msg.textContent = e && e.code === "cancelled" ? "중지했어요." : sampleCopy(e && e.code, e && e.detail);
      } finally {
        clearInterval(tick);
        if (lock) lock.release().catch(() => {});
        go.disabled = false; stop.hidden = true; sheetBusy = false; ctl = null;
      }
    });
    panel.append(
      h("p", { class: "small" }, `하루 ${fmtInt(t.kcal)} kcal · 단백질 ${fmtInt(t.protein)} g · 탄수화물 ${fmtInt(t.carbs)} g · 지방 ${fmtInt(t.fat)} g`),
      h("div", { class: "est-grid" },
        field("gAvoid", "빼야 할 음식 (알레르기·못 먹는 것)", avoid, "wide"),
        field("gLikes", "넣고 싶은 음식·집에 있는 재료", likes, "wide"),
        field("gCook", "요리 방식", cook, "wide"),
        h("label", { class: "check wide", for: "gOut" }, out, "평일 점심은 학식이나 외식이에요"),
        h("label", { class: "check wide", for: "gSnack" }, snack, "간식도 넣어 주세요")),
      h("div", { class: "row" }, go, stop), msg,
      h("p", { class: "small muted" }, "내 API 키로 Claude에 한 번 요청해요. 보내는 건 목표 숫자, 운동 요일, 위에 적은 내용뿐이고 기록이나 사진은 보내지 않아요. 쓴 토큰 수는 식단 아래에 보여 줘요."));
  }, () => { if (ctl) ctl.abort(); });
}

/* ---------- body change: progress photos (눈바디) and tape measurements, one entry per day ---------- */
const POSES = [{ key: "front", label: "정면" }, { key: "side", label: "측면" }, { key: "back", label: "후면" }];
const CM_FIELDS = [
  { key: "waist", label: "허리", hint: "배꼽 높이" },
  { key: "hip", label: "엉덩이", hint: "가장 넓은 곳" },
  { key: "chest", label: "가슴", hint: "가장 넓은 곳" },
  { key: "arm", label: "팔", hint: "위팔 가장 굵은 곳, 힘 빼고" },
  { key: "thigh", label: "허벅지", hint: "가장 굵은 곳" },
];
const bodyLogs = () => docsOf("body").filter(r => isYmd(r.date)).sort((a, b) => a.date.localeCompare(b.date));
const cmVal = (r, key) => { const v = num(r && isPlainObj(r.cm) ? r.cm[key] : null); return v == null || v < 20 || v > 250 ? null : v; };
const photoOf = (r, pose, full) => {
  const src = r && (full ? r.photos : r.thumbs), v = isPlainObj(src) ? src[pose] : null;
  return typeof v === "string" && v.startsWith("data:image/") ? v : null;
};
/* the weight trend near a photo date, so two photos can be read together with the scale */
function trendNear(d) { const tp = trendAt(d); return tp && daysBetween(tp.date, d) <= 3 ? tp.trend : null; }
function renderBody() {
  const box = $("#bodyBody"), list = bodyLogs(), d = state.selected, u = bu();
  const btn = $("#bodyAddBtn");
  btn.textContent = state.docs.has("body_" + d) ? "이 날 기록 고치기" : "기록하기";
  btn.disabled = !canWrite() || isFuture(d);
  box.replaceChildren();
  if (!list.length) {
    box.append(h("p", { class: "empty" }, !state.loaded ? "기록을 불러오는 중…"
      : "아직 몸 변화 기록이 없어요. 2주에 한 번쯤 사진(눈바디)과 허리 둘레를 남겨 두면, 체중이 그대로인 주에도 몸이 바뀌는 게 보여요."));
    return;
  }
  const withPose = pose => list.filter(r => photoOf(r, pose));
  const pose = POSES.find(p => withPose(p.key).length >= 2) || POSES.find(p => withPose(p.key).length);
  if (pose) {
    const ps = withPose(pose.key), a = ps[0], b = ps[ps.length - 1];
    const fig = (r, cap) => {
      const w = trendNear(r.date);
      return h("figure", { class: "bc-fig" }, h("img", { src: photoOf(r, pose.key), alt: `${fmtDay(r.date)} ${pose.label} 사진` }),
        h("figcaption", null, h("b", null, cap), ` ${fmtMD(r.date)}` + (w != null ? ` · ${fmtMass(w)} ${u}` : "")));
    };
    box.append(h("button", { class: "bc-compare", type: "button", onclick: () => openCompare(pose.key, a.date, b.date) },
      h("span", { class: "bc-pair" }, ps.length >= 2 ? [fig(a, "처음"), fig(b, "최근")] : [fig(a, `${pose.label} 첫 사진`)]),
      h("span", { class: "bc-hint" }, ps.length >= 2 ? `${pose.label} · 눌러서 크게 비교하기` : "다음에 같은 자세로 찍으면 나란히 비교해요")));
  }
  const grid = h("div", { class: "ib-grid" });
  for (const f of CM_FIELDS) {
    const has = list.filter(r => cmVal(r, f.key) != null);
    if (!has.length) continue;
    const first = has[0], last = has[has.length - 1], v = cmVal(last, f.key), dlt = has.length > 1 ? v - cmVal(first, f.key) : null;
    grid.append(h("div", { class: "ib-stat" },
      h("span", { class: "k" }, f.label),
      h("span", { class: "v" }, v.toFixed(1), h("small", null, " cm")),
      h("span", { class: "d" }, dlt == null ? `${fmtMD(last.date)} 첫 기록` : `${fmtSigned(dlt, 1)} cm · ${fmtMD(first.date)}부터`)));
  }
  if (grid.childNodes.length) box.append(grid);
  const waist = list.filter(r => cmVal(r, "waist") != null);
  if (waist.length >= 2) box.append(h("div", { class: "ib-charts" }, miniChart(waist, "waist", "w", "허리 둘레 (cm)", r => cmVal(r, "waist"))));
  box.append(h("ul", { class: "bc-list" }, list.slice().reverse().slice(0, 12).map(r => {
    const thumbs = POSES.map(p => photoOf(r, p.key)).filter(Boolean);
    const cms = CM_FIELDS.filter(f => cmVal(r, f.key) != null).map(f => `${f.label} ${cmVal(r, f.key).toFixed(1)}`);
    return h("li", null, h("button", { class: "bc-row", type: "button", "aria-label": `${fmtDay(r.date)} 몸 변화 기록 열기`, onclick: () => openBodyEntry(r.date) },
      h("span", { class: "bc-date num" }, fmtDM(r.date)),
      h("span", { class: "bc-thumbs" }, thumbs.map(src => h("img", { src, alt: "" }))),
      h("span", { class: "bc-cm" }, cms.length ? cms.join(" · ") + " cm" : str(r.note, 60) || (thumbs.length ? `사진 ${thumbs.length}장` : ""))));
  })));
}
/* photos keep 1080 px on the long edge for comparing, plus a 360 px copy for lists, so lists stay fast */
async function decodeImage(file) {
  if (window.createImageBitmap) {
    try { const b = await createImageBitmap(file, { imageOrientation: "from-image" }); return { src: b, w: b.width, hh: b.height, done: () => b.close && b.close() }; }
    catch (e) { /* fall back to an <img> below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("decode")); i.src = url; });
    return { src: im, w: im.naturalWidth, hh: im.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}
async function prepPhoto(file) {
  const img = await decodeImage(file);
  try {
    return { full: canvasFor(img.src, img.w, img.hh, 1080).toDataURL("image/jpeg", 0.78), thumb: canvasFor(img.src, img.w, img.hh, 360).toDataURL("image/jpeg", 0.7) };
  } finally { img.done(); }
}
function openBodyEntry(date) {
  const id = "body_" + date, cur = state.docs.get(id) || {};
  const photos = {}, thumbs = {};
  for (const p of POSES) { const f = photoOf(cur, p.key, true), t = photoOf(cur, p.key); if (f || t) { photos[p.key] = f || t; thumbs[p.key] = t || f; } }
  let pending = 0;
  openSheet(`${fmtDay(date)} 몸 변화`, panel => {
    const msg = h("p", { class: "small muted", "aria-live": "polite" });
    const slots = POSES.map(p => {
      const file = h("input", { id: "bf_" + p.key, type: "file", accept: "image/*", class: "file-input" });
      const img = h("img", { alt: "", hidden: !thumbs[p.key] });
      if (thumbs[p.key]) img.src = thumbs[p.key];
      const ph = h("span", { class: "bc-ph", hidden: !!thumbs[p.key] }, "+ 사진");
      const del = h("button", { class: "bc-del", type: "button", "aria-label": `${p.label} 사진 빼기`, hidden: !thumbs[p.key] }, "×");
      file.addEventListener("change", async () => {
        const f = file.files && file.files[0];
        file.value = "";
        if (!f) return;
        pending++; msg.textContent = "사진을 준비하는 중…";
        try {
          const out = await prepPhoto(f);
          photos[p.key] = out.full; thumbs[p.key] = out.thumb;
          img.src = out.thumb; img.hidden = false; ph.hidden = true; del.hidden = false; msg.textContent = "";
        } catch (e) { msg.textContent = "이미지를 읽지 못했어요. JPEG나 PNG로 해 보세요."; }
        finally { pending--; }
      });
      del.addEventListener("click", () => { delete photos[p.key]; delete thumbs[p.key]; img.hidden = true; img.removeAttribute("src"); ph.hidden = false; del.hidden = true; });
      return h("div", { class: "bc-slot" }, file, h("label", { for: "bf_" + p.key, class: "bc-pick", "aria-label": `${p.label} 사진 고르기` }, img, ph), h("span", { class: "bc-slot-k" }, p.label), del);
    });
    const cmIn = CM_FIELDS.map(f => {
      const v = cmVal(cur, f.key);
      return { f, el: h("input", { id: "bc_" + f.key, inputmode: "decimal", autocomplete: "off", value: v != null ? String(v) : "" }) };
    });
    const note = h("textarea", { id: "bcNote", rows: 2, placeholder: "예: 아침 공복, 같은 거울 앞" });
    note.value = str(cur.note, 300);
    const btn = h("button", { class: "btn primary", type: "submit" }, "저장");
    const del = state.docs.has(id) ? h("button", { class: "btn danger", type: "button", onclick: () => confirmDeleteBody(date) }, "이 날 기록 삭제") : null;
    const form = h("form", { class: "bc-form" },
      h("div", { class: "bc-slots" }, slots),
      h("p", { class: "small muted" }, "같은 장소, 같은 조명, 같은 거리에서 찍으세요. 아침 공복에 찍으면 비교하기 좋아요. 사진은 이 휴대폰에만 저장돼요."),
      h("div", { class: "est-grid" }, cmIn.map(({ f, el }) => field("bc_" + f.key, `${f.label} (${f.hint})`, h("div", { class: "input-unit" }, el, h("span", null, "cm"))))),
      field("bcNote", "메모", note),
      h("div", { class: "row" }, btn, del), msg);
    form.addEventListener("submit", e => {
      e.preventDefault();
      if (pending) { msg.textContent = "사진을 준비하고 있어요. 잠시 뒤에 저장하세요."; return; }
      const cm = {};
      for (const { f, el } of cmIn) {
        if (!el.value.trim()) continue;
        const v = inRange(el.value, 20, 250);
        if (v == null) { msg.textContent = `${f.label} 둘레를 cm로 다시 확인하세요. 예: 82.5`; el.focus(); return; }
        cm[f.key] = round1(v);
      }
      if (!Object.keys(photos).length && !Object.keys(cm).length && !note.value.trim()) { msg.textContent = "사진이나 둘레를 하나 이상 넣으세요."; return; }
      btn.disabled = true; sheetBusy = true; msg.textContent = "저장 중…";
      const now = new Date().toISOString();
      save(id, { kind: "body", date, photos, thumbs, cm, note: note.value.trim().slice(0, 300), createdAt: str(cur.createdAt, 40) || now, updatedAt: now })
        .then(() => { sheetBusy = false; closeSheet(true); toast("몸 변화를 저장했어요."); })
        .catch(() => { sheetBusy = false; btn.disabled = false; msg.textContent = "저장하지 못했어요. 저장 공간이 부족하면 백업을 내보낸 뒤 오래된 사진을 지워 보세요."; });
    });
    panel.append(form);
  });
}
function confirmDeleteBody(date) {
  openSheet("이 날 몸 변화 기록을 삭제할까요?", panel => {
    const msg = h("p", { class: "small muted", "aria-live": "polite" });
    const del = h("button", { class: "btn danger", type: "button" }, "삭제");
    const keep = h("button", { class: "btn", type: "button", onclick: () => closeSheet(true) }, "취소");
    del.addEventListener("click", () => {
      sheetBusy = true; del.disabled = true;
      removeDoc("body_" + date).then(() => { sheetBusy = false; closeSheet(true); toast("몸 변화 기록을 삭제했어요."); })
        .catch(() => { sheetBusy = false; del.disabled = false; msg.textContent = "삭제하지 못했어요. 다시 시도하세요."; });
    });
    panel.append(h("p", null, `${fmtDay(date)}의 사진과 둘레 기록이 삭제돼요. 백업 파일에 있는 건 그대로예요.`), h("div", { class: "row" }, del, keep), msg);
  });
}
function openCompare(pose, aDate, bDate) {
  openSheet("사진 비교", panel => {
    const cur = { pose, a: aDate, b: bDate };
    const segBox = h("div", { class: "row" }), pick = h("div", { class: "est-grid" }), pair = h("div", { class: "bc-big" });
    const draw = () => {
      const list = bodyLogs(), poses = POSES.filter(p => list.some(r => photoOf(r, p.key)));
      if (!poses.some(p => p.key === cur.pose)) cur.pose = poses.length ? poses[0].key : cur.pose;
      const dates = list.filter(r => photoOf(r, cur.pose)).map(r => r.date);
      if (!dates.includes(cur.a)) cur.a = dates[0];
      if (!dates.includes(cur.b)) cur.b = dates[dates.length - 1];
      segBox.replaceChildren(h("span", { class: "seg", role: "group", "aria-label": "자세" }, poses.map(p => h("button", {
        type: "button", class: "seg-btn", "aria-pressed": String(p.key === cur.pose), onclick: () => { cur.pose = p.key; draw(); },
      }, p.label))));
      const sel = (id, label, keyName) => {
        const s = h("select", { id }, dates.map(d => h("option", { value: d }, fmtDay(d))));
        s.value = cur[keyName];
        s.addEventListener("change", () => { cur[keyName] = s.value; draw(); });
        return field(id, label, s);
      };
      pick.replaceChildren(sel("cmpA", "이전", "a"), sel("cmpB", "이후", "b"));
      const fig = d => {
        const r = state.docs.get("body_" + d), w = trendNear(d), wv = cmVal(r, "waist");
        return h("figure", { class: "bc-fig big" }, h("img", { src: photoOf(r, cur.pose, true) || photoOf(r, cur.pose), alt: `${fmtDay(d)} 사진` }),
          h("figcaption", null, h("b", null, fmtMD(d)), [w != null ? `${fmtMass(w)} ${bu()}` : "", wv != null ? `허리 ${wv.toFixed(1)} cm` : ""].filter(Boolean).map(s => " · " + s).join("")));
      };
      pair.replaceChildren(...(cur.a ? [fig(cur.a)] : []), ...(cur.b && cur.b !== cur.a ? [fig(cur.b)] : []));
    };
    draw();
    panel.append(segBox, pick, pair, h("p", { class: "small muted" }, "같은 장소·조명·거리에서 찍은 사진끼리 비교해야 차이가 정확히 보여요."));
  });
}

/* ---------- backup ---------- */
const KINDS = ["meal", "weight", "gym", "run", "inbody", "body", "mealplan"];
const KIND_KO = { meal: "식사", weight: "체중", gym: "헬스", run: "러닝", inbody: "인바디", body: "몸 변화", mealplan: "식단표" };
const ID_RE = /^(settings|profile|(weight|gym|run|inbody|body|mealplan)_(\d{4}-\d{2}-\d{2})|meal_(\d{4}-\d{2}-\d{2})_\d{4}_[a-z0-9]{1,12})$/;
function kindCounts(docs) {
  const c = { meal: 0, weight: 0, gym: 0, run: 0, inbody: 0, body: 0, mealplan: 0, settings: 0, profile: 0 };
  for (const d of docs.values()) if (d && d.kind in c) c[d.kind]++;
  return c;
}
const countText = c => KINDS.map(k => `${KIND_KO[k]} ${c[k]}`).join(" · ");
function fmtAgo(iso) {
  const t = new Date(iso);
  if (!(t.getTime() > 0)) return "알 수 없음";
  const d = ymd(t), n = daysBetween(d, state.today);
  return n <= 0 ? `오늘 (${fmtMD(d)})` : n === 1 ? `어제 (${fmtMD(d)})` : `${n}일 전 (${fmtMD(d)})`;
}
function renderData() {
  const total = state.docs.size;
  $("#dataCounts").textContent = !state.loaded ? "불러오는 중…" : total ? `저장된 기록: ${countText(kindCounts(state.docs))}` : "아직 저장된 기록이 없어요.";
  const last = lsGet(LS.backup), note = $("#backupNote");
  note.textContent = last ? `마지막 백업: ${fmtAgo(last)}` : total ? "아직 백업을 내보낸 적이 없어요." : "";
  note.classList.toggle("warn-text", backupDue());
  $("#exportBtn").disabled = !total;
  $("#importFile").disabled = !canWrite();
  $("#importLabel").classList.toggle("is-disabled", !canWrite());
  const key = aiKey();
  $("#aiKeyState").textContent = key ? `저장된 키: ${maskKey(key)} · 모델 ${aiModel()}` : "저장된 키가 없어요. 사진 읽기는 꺼져 있어요.";
  $("#aiTest").disabled = !key;
  $("#aiClear").hidden = !key;
  $("#aiKey").placeholder = key ? "키를 바꿀 때만 입력" : "sk-ant-…";
}
const fmtBytes = b => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
async function renderStorageInfo() {
  const parts = [state.store ? (state.store.kind === "indexeddb" ? "저장 위치: 이 기기 (IndexedDB)" : "저장 위치: 이 기기 (간이 저장소)") : "저장소를 열지 못했어요"];
  try {
    if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); if (e && typeof e.usage === "number") parts.push(`사용 중 ${fmtBytes(e.usage)}`); }
    if (navigator.storage && navigator.storage.persisted) parts.push((await navigator.storage.persisted()) ? "자동 삭제 보호 켜짐" : "자동 삭제 보호는 브라우저가 정해요");
  } catch (e) { /* not supported here */ }
  $("#storageNote").textContent = parts.join(" · ");
}
function exportBackup() {
  const docs = {};
  for (const [id, d] of state.docs) docs[id] = d;
  const json = JSON.stringify({ app: "diet-log", version: 1, exportedAt: new Date().toISOString(), docs });
  const name = `diet-log-backup-${state.today}.json`;
  const file = new File([json], name, { type: "application/json" });
  const done = () => { lsSet(LS.backup, new Date().toISOString()); renderAll(); toast("백업 파일을 만들었어요. 파일 앱이나 클라우드에 보관하세요."); };
  let shareable = false;
  try { shareable = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { shareable = false; }
  if (shareable) {
    navigator.share({ files: [file], title: name }).then(done).catch(err => { if (!err || err.name !== "AbortError") download(file, name, done); });
    return;
  }
  download(file, name, done);
}
function download(blob, name, done) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  done();
}
function parseBackup(obj) {
  if (!isPlainObj(obj) || !isPlainObj(obj.docs)) return null;
  const docs = new Map();
  let skipped = 0;
  for (const [id, d] of Object.entries(obj.docs)) {
    const m = ID_RE.exec(id);
    const day = m && (m[3] || m[4]);
    const kindOk = m && isPlainObj(d) && (id === "settings" || id === "profile" ? d.kind === id : id.startsWith(d.kind + "_"));
    if (kindOk && (!day || d.date === day)) docs.set(id, d); else skipped++;
  }
  return { docs, skipped };
}
const readText = file => (file.text ? file.text() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(file); }));
async function importBackup(file) {
  if (!canWrite()) return;
  if (file.size > 120 * 1048576) { toast("파일이 너무 커요. 이 앱에서 내보낸 백업 파일인지 확인하세요."); return; }
  let parsed = null;
  try { parsed = parseBackup(JSON.parse(await readText(file))); } catch (e) { parsed = null; }
  if (!parsed) { toast("백업 파일을 읽지 못했어요. 이 앱에서 내보낸 .json 파일인지 확인하세요."); return; }
  if (!parsed.docs.size) { toast("이 파일에는 가져올 기록이 없어요."); return; }
  const c = kindCounts(parsed.docs);
  let replaced = 0;
  for (const id of parsed.docs.keys()) if (state.docs.has(id)) replaced++;
  openSheet("백업을 가져올까요?", panel => {
    const msg = h("p", { class: "small muted", "aria-live": "polite" });
    const go = h("button", { class: "btn primary", type: "button" }, "가져오기");
    const cancel = h("button", { class: "btn", type: "button", onclick: () => closeSheet(true) }, "취소");
    go.addEventListener("click", async () => {
      sheetBusy = true; go.disabled = true; msg.textContent = "가져오는 중…";
      try {
        await state.store.putMany([...parsed.docs]);
        for (const [id, d] of parsed.docs) state.docs.set(id, d);
        state.draft = null;
        changed();
        if (bc) bc.postMessage("changed");
        sheetBusy = false; closeSheet(true);
        toast(`${parsed.docs.size}개 항목을 가져왔어요.`);
      } catch (e) {
        sheetBusy = false; go.disabled = false;
        msg.textContent = storeErr(e).code === "quota_exceeded" ? "저장 공간이 부족해서 가져오지 못했어요." : "가져오지 못했어요. 다시 시도하세요.";
      }
    });
    panel.append(
      h("p", null, countText(c) + (c.settings ? " · 목표 설정" : "") + (c.profile ? " · 내 정보" : "")),
      h("p", { class: "small muted" }, (replaced ? `지금 있는 항목 중 ${replaced}개는 백업 내용으로 바뀌어요. ` : "") + "백업에 없는 지금 기록은 그대로 남아요."
        + (parsed.skipped ? ` 알아볼 수 없는 항목 ${parsed.skipped}개는 건너뛰어요.` : "")),
      h("div", { class: "row" }, go, cancel), msg);
  });
}

/* ---------- install hint ---------- */
let installEvt = null;
const isStandalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
function renderInstallHint() {
  $("#installHint").hidden = isStandalone() || lsGet(LS.hint) === "1";
  $("#installBtn").hidden = !installEvt;
}

/* ---------- navigation + wiring ---------- */
function select(d) {
  flushGym();
  state.selected = d;
  state.draft = null;
  renderAll();
}
function checkToday() {
  const t = ymd(new Date());
  if (t === state.today) return;
  const wasToday = state.selected === state.today;
  state.today = t;
  if (wasToday) select(t); else renderAll();
}
function wire() {
  $("#prevBtn").addEventListener("click", () => select(addDays(state.selected, -1)));
  $("#nextBtn").addEventListener("click", () => select(addDays(state.selected, 1)));
  $("#todayBtn").addEventListener("click", () => select(state.today));
  $("#photoBtn").addEventListener("click", openPhoto);
  $("#addBtn").addEventListener("click", openManual);
  $("#ibPhotoBtn").addEventListener("click", openInbodyPhoto);
  $("#ibAddBtn").addEventListener("click", openInbodyManual);
  $("#bodyAddBtn").addEventListener("click", () => openBodyEntry(isFuture(state.selected) ? state.today : state.selected));
  $("#dtEdit").addEventListener("click", openProfile);
  $("#mpGen").addEventListener("click", openPlanMaker);
  $("#shopCopy").addEventListener("click", copyShopping);
  $("#sheet").addEventListener("click", e => { if (e.target === e.currentTarget) closeSheet(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(false); });
  /* tabs replace the history entry, so the back gesture leaves the app instead of stepping through tabs */
  document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    const v = a.getAttribute("href").slice(1);
    if (!VIEWS.includes(v)) return;
    e.preventDefault();
    if (currentView() !== v) history.replaceState(null, "", "#" + v);
    showView(true);
  });
  $("#trainingCard").addEventListener("focusout", e => {
    if (e.relatedTarget && $("#trainingCard").contains(e.relatedTarget)) return;
    setTimeout(() => { if (!trainingBusy()) renderTraining(); }, 0);
  });
  $("#kgInput").addEventListener("input", e => { e.target.dataset.dirty = "1"; });
  $("#kgForm").addEventListener("submit", e => {
    e.preventDefault();
    const d = state.selected, u = bu(), inp = $("#kgInput");
    const v = inRange(inp.value, u === "lb" ? 44 : 20, u === "lb" ? 880 : 400);
    if (v == null) { toast(u === "lb" ? "체중을 lb로 입력하세요. 예: 160.4" : "체중을 kg로 입력하세요. 예: 72.4"); return; }
    $("#kgSave").disabled = true;
    save("weight_" + d, { kind: "weight", date: d, kg: round2(toKg(v, u)), entered: { value: round1(v), unit: u }, createdAt: new Date().toISOString() })
      .then(() => { delete inp.dataset.dirty; toast("체중을 저장했어요."); inp.blur(); renderWeight(); })
      .catch(() => {})
      .finally(() => { $("#kgSave").disabled = !canWrite() || isFuture(state.selected); });
  });
  $("#setForm").addEventListener("submit", e => {
    e.preventDefault();
    const kcal = inRange($("#sKcal").value, 800, 6000), prot = inRange($("#sProt").value, 20, 400);
    const carb = inRange($("#sCarb").value, 20, 900), fat = inRange($("#sFat").value, 10, 300);
    const bodyUnit = okUnit($("#sBodyUnit").value), liftUnit = okUnit($("#sLiftUnit").value);
    const rminIn = inRange($("#sMin").value, 0, 5), rmaxIn = inRange($("#sMax").value, 0, 5), step = inRange($("#sStep").value, 25, 1000);
    if ($("#sKcal").value.trim() && kcal == null) { toast("칼로리는 800–6,000 사이로 입력하세요."); return; }
    if ($("#sProt").value.trim() && prot == null) { toast("단백질은 20–400 g 사이로 입력하세요."); return; }
    if ($("#sCarb").value.trim() && carb == null) { toast("탄수화물은 20–900 g 사이로 입력하세요."); return; }
    if ($("#sFat").value.trim() && fat == null) { toast("지방은 10–300 g 사이로 입력하세요."); return; }
    if (rminIn == null || rmaxIn == null || rminIn >= rmaxIn) { toast("주간 최소 감량이 최대 감량보다 작아야 해요."); return; }
    if (step == null) { toast("조정 폭은 25–1,000 kcal로 입력하세요."); return; }
    /* the band was typed in the unit shown next to it (the saved body unit) */
    const shown = bu();
    saveSettings({
      kcalTarget: kcal, proteinTarget: prot, carbTarget: carb == null ? null : Math.round(carb), fatTarget: fat == null ? null : Math.round(fat), bodyUnit, liftUnit,
      rateMin: round2(toKg(rminIn, shown)), rateMax: round2(toKg(rmaxIn, shown)), stepKcal: Math.round(step),
    }).then(() => toast("목표와 단위를 저장했어요.")).catch(() => {});
  });
  $("#exportBtn").addEventListener("click", exportBackup);
  $("#importFile").addEventListener("change", e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) importBackup(f);
  });
  $("#hintClose").addEventListener("click", () => { lsSet(LS.hint, "1"); renderInstallHint(); });
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; renderInstallHint(); });
  $("#installBtn").addEventListener("click", async () => {
    if (!installEvt) return;
    const evt = installEvt;
    installEvt = null;
    evt.prompt();
    try { await evt.userChoice; } catch (e) { /* ignore */ }
    renderInstallHint();
  });
  window.addEventListener("appinstalled", () => { lsSet(LS.hint, "1"); renderInstallHint(); });
  wireAi();
  const chart = $("#chart");
  if (window.ResizeObserver) {
    let raf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { const w = Math.floor(chart.clientWidth); if (w && Math.abs(w - lastChartWidth) > 2) drawChart(); });
    }).observe(chart);
  }
  /* save typed sets right away when the app goes to the background; pick up a new day when it comes back */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { flushGym(); return; }
    checkToday();
    if (pendingReload && $("#sheet").hidden) location.reload();
  });
  window.addEventListener("pagehide", flushGym);
  setInterval(checkToday, 5 * 60 * 1000);
  if (bc) bc.onmessage = async () => {
    if (!state.store) return;
    try { state.docs = keepObjects(await state.store.loadAll()); changed(); } catch (e) { /* keep what is shown */ }
  };
}

/* offline support: the service worker caches the app; a new version takes over the next time the app comes to the front */
let pendingReload = false;
function registerWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) pendingReload = true; });
  navigator.serviceWorker.register("./sw.js").catch(() => { /* the app still works online */ });
}

async function start() {
  const slow = setTimeout(() => setStatus("저장소를 여는 데 시간이 걸리고 있어요. 계속되면 앱을 완전히 닫았다가 다시 여세요."), 6000);
  try {
    const store = await openStore();
    let docs = await store.loadAll();
    if (store.kind === "indexeddb") docs = await migrateLocal(store, docs);
    state.store = store;
    state.docs = keepObjects(docs);
    clearTimeout(slow);
    setStatus(store.kind === "localstorage" ? "이 브라우저에서는 간이 저장소를 쓰고 있어요. 용량이 작으니 백업을 자주 내보내세요." : "");
  } catch (e) {
    clearTimeout(slow);
    setStatus("이 브라우저에서는 기록을 저장할 수 없어요. 개인정보 보호 브라우징을 끄거나 다른 브라우저로 여세요. 계획 탭은 볼 수 있어요.", "bad");
  }
  state.loaded = true;
  trendCache = null;
  renderAll();
}

state.sample = { json: aiJson };
state.photo.ok = !!aiKey();
buildPlan();
wire();
registerWorker();
window.addEventListener("hashchange", () => showView(true));
showView(false);
renderAll();
start();
})();
