import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp
} from "./firebase-config.js";

// ===== 基本設定 =====
const SLOT_HOURS = 3;
const SLOTS_PER_DAY = 24 / SLOT_HOURS;
const LEVEL_NAME = { 1: "低", 2: "中", 3: "高" };
const LEVEL_CLASS = { 1: "low", 2: "mid", 3: "high" };

let uid = null;
let allRecords = [];
let historyChart = null;
let statsChart = null;
let unsubscribeRecords = null;

// ===== 工具函式 =====
function pad(n){ return String(n).padStart(2,"0"); }
function dateKey(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function slotIndex(d){ return Math.floor(d.getHours() / SLOT_HOURS); }
function slotLabel(i){
  const startH = i * SLOT_HOURS;
  const endH = (startH + SLOT_HOURS) % 24;
  return `${pad(startH)}:00-${pad(endH)}:00`;
}
function scoreToLevel(score){ return Math.min(3, Math.max(1, Math.round(score))); }
function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== 登入 / 登出 =====
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userBox = document.getElementById("userBox");
const authGate = document.getElementById("authGate");
const appContent = document.getElementById("appContent");

loginBtn.addEventListener("click", () => {
  signInWithPopup(auth, googleProvider).catch(err => {
    console.error("登入失敗", err);
    alert("登入失敗:" + err.message);
  });
});

logoutBtn.addEventListener("click", () => {
  signOut(auth);
});

onAuthStateChanged(auth, user => {
  if (unsubscribeRecords) { unsubscribeRecords(); unsubscribeRecords = null; }

  if (user) {
    uid = user.uid;
    authGate.classList.add("hidden");
    appContent.classList.remove("hidden");
    userBox.classList.remove("hidden");
    userBox.querySelector(".user-name").textContent = user.displayName || user.email || "已登入";
    const avatar = userBox.querySelector(".user-avatar");
    if (user.photoURL){
      avatar.src = user.photoURL;
      avatar.style.display = "block";
    } else {
      avatar.style.display = "none";
    }
    loadRecords();
  } else {
    uid = null;
    allRecords = [];
    authGate.classList.remove("hidden");
    appContent.classList.add("hidden");
    userBox.classList.add("hidden");
  }
});

// ===== 讀取所有紀錄 =====
function loadRecords(){
  const q = query(
    collection(db, "records"),
    where("uid", "==", uid),
    orderBy("ts", "asc")
  );
  unsubscribeRecords = onSnapshot(q, snapshot => {
    allRecords = snapshot.docs.map(doc => {
      const data = doc.data();
      const ts = data.ts && data.ts.toDate ? data.ts.toDate() : new Date();
      return { id: doc.id, ts, level: data.level, slot: data.slot, dateKey: data.dateKey, note: data.note || "" };
    });
    renderAll();
  }, err => console.error("讀取失敗", err));
}

// ===== 寫入紀錄 =====
function submitLevel(level){
  if (!uid){ alert("請先登入"); return; }
  const noteInput = document.getElementById("noteInput");
  const note = noteInput ? noteInput.value.trim() : "";
  const now = new Date();
  const record = {
    uid,
    level,
    note,
    slot: slotIndex(now),
    dateKey: dateKey(now),
    hour: now.getHours(),
    ts: serverTimestamp()
  };
  const predictedLevel = predictLevelForSlot(record.slot);

  addDoc(collection(db, "records"), record).then(() => {
    showPredictionCompare(level, predictedLevel);
    if (noteInput) noteInput.value = "";
  }).catch(err => {
    console.error("寫入失敗", err);
    alert("寫入失敗,請確認 Firestore 規則與網路連線");
  });
}

function showPredictionCompare(actualLevel, predictedLevel){
  const box = document.getElementById("predictionCompare");
  box.classList.remove("hidden","match","mismatch");
  if (predictedLevel === null){ box.classList.add("hidden"); return; }
  if (actualLevel === predictedLevel){
    box.classList.add("match");
    box.textContent = `✅ 與預測相符(預測:${LEVEL_NAME[predictedLevel]})`;
  } else {
    box.classList.add("mismatch");
    box.textContent = `🔀 與預測不同(預測:${LEVEL_NAME[predictedLevel]},實際:${LEVEL_NAME[actualLevel]})`;
  }
}

// ===== 統計 =====
function computeSlotStats(){
  const buckets = Array.from({length: SLOTS_PER_DAY}, () => []);
  allRecords.forEach(r => buckets[r.slot].push(r.level));
  return buckets.map((arr, i) => {
    const count = arr.length;
    const avg = count ? arr.reduce((a,b)=>a+b,0) / count : null;
    return { slot: i, count, avg };
  });
}

function predictLevelForSlot(slot){
  const stats = computeSlotStats();
  const s = stats[slot];
  if (!s || s.count === 0) return null;
  return scoreToLevel(s.avg);
}

// ===== 畫面渲染 =====
function renderAll(){
  renderTodayList();
  renderRawList();
  renderCurrentSlotHint();
  renderHistoryChart();
  renderStats();
}

function renderCurrentSlotHint(){
  const now = new Date();
  const slot = slotIndex(now);
  document.getElementById("currentSlotHint").textContent =
    `目前時段:${slotLabel(slot)} — 你現在覺得運勢如何?`;
}

function renderTodayList(){
  const today = dateKey(new Date());
  const list = document.getElementById("todayList");
  const todays = allRecords.filter(r => r.dateKey === today);
  if (todays.length === 0){
    list.innerHTML = `<li class="muted">尚無資料</li>`;
    return;
  }
  list.innerHTML = todays.map(r => `
    <li>
      <div>
        <span>${slotLabel(r.slot)}(${pad(r.ts.getHours())}:${pad(r.ts.getMinutes())} 登記)</span>
        ${r.note ? `<span class="record-note">📝 ${escapeHtml(r.note)}</span>` : ""}
      </div>
      <span class="tag ${LEVEL_CLASS[r.level]}">${LEVEL_NAME[r.level]}</span>
    </li>
  `).join("");
}

function renderRawList(){
  const list = document.getElementById("rawList");
  const recent = [...allRecords].reverse().slice(0, 100);
  if (recent.length === 0){
    list.innerHTML = `<li class="muted">尚無資料</li>`;
    return;
  }
  list.innerHTML = recent.map(r => `
    <li>
      <div>
        <span>${r.dateKey} ${slotLabel(r.slot)}</span>
        ${r.note ? `<span class="record-note">📝 ${escapeHtml(r.note)}</span>` : ""}
      </div>
      <span class="tag ${LEVEL_CLASS[r.level]}">${LEVEL_NAME[r.level]}</span>
    </li>
  `).join("");
}

// ===== 歷史折線圖:未登記時段以前一次結果補齊 =====
function buildFilledSeriesRobust(){
  if (allRecords.length === 0) return [];
  const recordMap = new Map();
  allRecords.forEach(r => recordMap.set(`${r.dateKey}|${r.slot}`, r.level));

  const first = allRecords[0].ts;
  const last = new Date();
  const points = [];
  let lastLevel = null;
  let cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());

  while (cursor <= last){
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++){
      const dKey = dateKey(cursor);
      const key = `${dKey}|${slot}`;
      if (recordMap.has(key)) lastLevel = recordMap.get(key);
      if (lastLevel !== null){
        points.push({ label: `${dKey.slice(5)} ${pad(slot*SLOT_HOURS)}時`, value: lastLevel });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

function renderHistoryChart(){
  const points = buildFilledSeriesRobust();
  const ctx = document.getElementById("historyChart");
  const labels = points.map(p => p.label);
  const data = points.map(p => p.value);

  if (historyChart) historyChart.destroy();
  historyChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{
      label: "運勢", data,
      borderColor: "#7c6cf0", backgroundColor: "rgba(124,108,240,0.15)",
      tension: 0.25, pointRadius: 2, fill: true
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { min: 0.5, max: 3.5, ticks: { stepSize: 1, callback: v => LEVEL_NAME[v] || "" }, grid: { color: "#322c56" } },
        x: { ticks: { maxTicksLimit: 8, color: "#9c93c4" }, grid: { display:false } }
      },
      plugins: { legend: { display:false } }
    }
  });
}

// ===== 統計頁 =====
function renderStats(){
  const stats = computeSlotStats();
  const totalCount = allRecords.length;

  document.getElementById("statsSummary").textContent =
    totalCount === 0
      ? "尚無資料,開始登記後這裡會出現統計"
      : `目前累積 ${totalCount} 筆紀錄,建議累積 3-4 週後預測會更準確`;

  const ctx = document.getElementById("statsChart");
  const labels = stats.map(s => slotLabel(s.slot));
  const data = stats.map(s => s.avg || 0);

  if (statsChart) statsChart.destroy();
  statsChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{
      label: "平均運勢分數", data,
      backgroundColor: data.map(v => v === 0 ? "#322c56" : v >= 2.4 ? "#4fd1a5" : v <= 1.6 ? "#e0577b" : "#e0b13f")
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { min:0, max:3, ticks:{ stepSize:1 }, grid:{ color:"#322c56" } },
        x: { ticks: { color:"#9c93c4", maxRotation:60, minRotation:60 }, grid:{ display:false } }
      },
      plugins: { legend: { display:false } }
    }
  });

  const tbody = document.querySelector("#predictTable tbody");
  tbody.innerHTML = stats.map(s => `
    <tr>
      <td>${slotLabel(s.slot)}</td>
      <td>${s.avg ? s.avg.toFixed(2) : "-"}</td>
      <td>${s.avg ? `<span class="tag ${LEVEL_CLASS[scoreToLevel(s.avg)]}">${LEVEL_NAME[scoreToLevel(s.avg)]}</span>` : "-"}</td>
      <td>${s.count}</td>
    </tr>
  `).join("");

  const validStats = stats.filter(s => s.count >= 3);
  const bwText = document.getElementById("bestWorstText");
  if (validStats.length < 2){
    bwText.textContent = "資料不足,尚無法判斷週期(建議每個時段至少累積 3 筆以上)";
  } else {
    const best = validStats.reduce((a,b) => (b.avg > a.avg ? b : a));
    const worst = validStats.reduce((a,b) => (b.avg < a.avg ? b : a));
    bwText.innerHTML = `
      🌟 目前推測運勢<b>最好</b>的時段:<b>${slotLabel(best.slot)}</b>(平均 ${best.avg.toFixed(2)} 分)<br>
      ⚠️ 目前推測運勢<b>最差</b>的時段:<b>${slotLabel(worst.slot)}</b>(平均 ${worst.avg.toFixed(2)} 分)
    `;
  }
}

// ===== 頁籤切換 =====
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ===== 登記按鈕 =====
document.querySelectorAll(".level-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const level = parseInt(btn.dataset.level, 10);
    submitLevel(level);
  });
});

setInterval(renderCurrentSlotHint, 60 * 1000);
