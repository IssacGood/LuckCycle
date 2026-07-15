import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  collection, addDoc, updateDoc, deleteDoc, doc,
  query, where, orderBy, onSnapshot, serverTimestamp,
  writeBatch, getDocs
} from "./firebase-config.js";

// ===== 基本設定 =====
const SLOT_HOURS = 3;
const SLOTS_PER_DAY = 24 / SLOT_HOURS;
const MAX_CARRY_DAYS = 2; // 超過幾天沒登記,就不再延續前一次結果(視為空窗,不補值)
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
function submitLevel(level, note){
  if (!uid){ alert("請先登入"); return; }
  const now = new Date();
  const slot = slotIndex(now);
  const today = dateKey(now);

  const existing = allRecords.find(r => r.dateKey === today && r.slot === slot);
  if (existing){
    alert(`已經紀錄!這個時段(${slotLabel(slot)})今天已經登記過「${LEVEL_NAME[existing.level]}」了。`);
    return;
  }

  const record = {
    uid,
    level,
    note,
    slot,
    dateKey: today,
    hour: now.getHours(),
    ts: serverTimestamp()
  };
  const predictedLevel = predictLevelForSlot(record.slot);

  addDoc(collection(db, "records"), record).then(() => {
    showPredictionCompare(level, predictedLevel);
    const noteInput = document.getElementById("noteInput");
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
  renderMonthlyCycle();
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
        <div class="record-actions">
          <button data-action="edit-level" data-id="${r.id}">改等級</button>
          <button data-action="edit-note" data-id="${r.id}">改備註</button>
          <button data-action="delete" data-id="${r.id}" class="danger">刪除</button>
        </div>
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
  let lastLevelDate = null; // 最後一次「真實登記」的日期時間,用來判斷是否超過補值上限
  let cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());

  while (cursor <= last){
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++){
      const dKey = dateKey(cursor);
      const key = `${dKey}|${slot}`;
      const slotTime = new Date(cursor);
      slotTime.setHours(slot * SLOT_HOURS, 0, 0, 0);

      if (recordMap.has(key)){
        lastLevel = recordMap.get(key);
        lastLevelDate = slotTime;
      }

      const withinCarryLimit = lastLevelDate !== null &&
        daysBetween(lastLevelDate, slotTime) <= MAX_CARRY_DAYS;

      if (lastLevel !== null && withinCarryLimit){
        points.push({ label: `${dKey.slice(5)} ${pad(slot*SLOT_HOURS)}時`, value: lastLevel });
      } else {
        points.push({ label: `${dKey.slice(5)} ${pad(slot*SLOT_HOURS)}時`, value: null }); // 留白
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

function renderHistoryChart(){
  if (typeof Chart === "undefined"){
    console.error("Chart.js 尚未載入,略過繪製折線圖");
    return;
  }
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
      tension: 0.25, pointRadius: 2, fill: true,
      spanGaps: false
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

  if (typeof Chart !== "undefined"){
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
  } else {
    console.error("Chart.js 尚未載入,略過繪製統計圖");
  }

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

// ===== 編輯 / 刪除紀錄 =====
function findRecordById(id){
  return allRecords.find(r => r.id === id);
}

function editRecordLevel(id){
  const r = findRecordById(id);
  if (!r) return;
  const input = prompt(`修改等級,輸入 1(低)/ 2(中)/ 3(高):\n目前為 ${LEVEL_NAME[r.level]}`, String(r.level));
  if (input === null) return;
  const level = parseInt(input, 10);
  if (![1,2,3].includes(level)){
    alert("請輸入 1、2 或 3");
    return;
  }
  updateDoc(doc(db, "records", id), { level }).catch(err => {
    console.error("修改失敗", err);
    alert("修改失敗:" + err.message);
  });
}

function editRecordNote(id){
  const r = findRecordById(id);
  if (!r) return;
  const input = prompt("修改備註:", r.note || "");
  if (input === null) return;
  updateDoc(doc(db, "records", id), { note: input.trim() }).catch(err => {
    console.error("修改失敗", err);
    alert("修改失敗:" + err.message);
  });
}

function deleteRecord(id){
  if (!confirm("確定要刪除這筆紀錄嗎?此動作無法復原。")) return;
  deleteDoc(doc(db, "records", id)).catch(err => {
    console.error("刪除失敗", err);
    alert("刪除失敗:" + err.message);
  });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === "edit-level") editRecordLevel(id);
  else if (action === "edit-note") editRecordNote(id);
  else if (action === "delete") deleteRecord(id);
});

// ===== 清除所有紀錄(雙重確認) =====
const clearAllBtn = document.getElementById("clearAllBtn");
const clearModal = document.getElementById("clearModal");
const clearConfirmInput = document.getElementById("clearConfirmInput");
const clearConfirmBtn = document.getElementById("clearConfirmBtn");
const clearCancelBtn = document.getElementById("clearCancelBtn");

clearAllBtn.addEventListener("click", () => {
  clearConfirmInput.value = "";
  clearConfirmBtn.disabled = true;
  clearModal.classList.remove("hidden");
  clearConfirmInput.focus();
});

clearCancelBtn.addEventListener("click", () => {
  clearModal.classList.add("hidden");
});

clearConfirmInput.addEventListener("input", () => {
  clearConfirmBtn.disabled = clearConfirmInput.value.trim() !== "確定";
});

clearConfirmBtn.addEventListener("click", async () => {
  if (clearConfirmInput.value.trim() !== "確定") return;
  if (!uid) return;

  clearConfirmBtn.disabled = true;
  clearConfirmBtn.textContent = "清除中...";

  try {
    const q = query(collection(db, "records"), where("uid", "==", uid));
    const snapshot = await getDocs(q);
    const docs = snapshot.docs;

    // Firestore 一個 batch 最多 500 筆,超過就分批處理
    const chunkSize = 450;
    for (let i = 0; i < docs.length; i += chunkSize){
      const batch = writeBatch(db);
      docs.slice(i, i + chunkSize).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    clearModal.classList.add("hidden");
    alert("已清除所有紀錄");
  } catch (err){
    console.error("清除失敗", err);
    alert("清除失敗:" + err.message);
  } finally {
    clearConfirmBtn.disabled = false;
    clearConfirmBtn.textContent = "永久清除";
  }
});

// ===== 月週期分析(以日為單位) =====
let dailyChart = null;
const HIGH_DAY_THRESHOLD = 2.5; // 當日平均分 >= 此值視為「高潮日」
const LOW_DAY_THRESHOLD = 1.5;  // 當日平均分 <= 此值視為「低潮日」
const MIN_DAYS_FOR_CYCLE = 14;  // 至少累積幾天資料才嘗試判斷週期

function computeDailyAverages(){
  if (allRecords.length === 0) return [];
  const recordMap = new Map();
  allRecords.forEach(r => recordMap.set(`${r.dateKey}|${r.slot}`, r.level));

  const first = allRecords[0].ts;
  const last = new Date();
  const days = [];
  let lastLevel = null;
  let lastLevelDate = null;
  let cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());

  while (cursor <= last){
    const dKey = dateKey(cursor);
    let sum = 0, count = 0;
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++){
      const key = `${dKey}|${slot}`;
      const slotTime = new Date(cursor);
      slotTime.setHours(slot * SLOT_HOURS, 0, 0, 0);

      if (recordMap.has(key)){
        lastLevel = recordMap.get(key);
        lastLevelDate = slotTime;
      }

      const withinCarryLimit = lastLevelDate !== null &&
        daysBetween(lastLevelDate, slotTime) <= MAX_CARRY_DAYS;

      if (lastLevel !== null && withinCarryLimit){
        sum += lastLevel;
        count++;
      }
    }
    if (count > 0){
      days.push({ dateKey: dKey, date: new Date(cursor), avg: sum / count });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function daysBetween(d1, d2){
  return Math.round((d2 - d1) / 86400000);
}

function gapStats(list){
  if (list.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < list.length; i++){
    gaps.push(daysBetween(list[i-1].date, list[i].date));
  }
  const avgGap = gaps.reduce((a,b)=>a+b,0) / gaps.length;
  const lastItem = list[list.length - 1];
  const nextPredicted = new Date(lastItem.date.getTime() + Math.round(avgGap) * 86400000);
  return { avgGap, gaps, lastItem, nextPredicted, count: list.length };
}

function fmtDate(d){
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function renderMonthlyCycle(){
  const days = computeDailyAverages();
  const textBox = document.getElementById("monthlyCycleText");

  // 折線圖(不論資料夠不夠都先畫出來,讓使用者看到趨勢)
  if (typeof Chart !== "undefined"){
    const ctx = document.getElementById("dailyChart");
    if (dailyChart) dailyChart.destroy();
    dailyChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: days.map(d => fmtDate(d.date)),
        datasets: [{
          label: "當日平均分",
          data: days.map(d => d.avg),
          borderColor: "#7c6cf0",
          backgroundColor: days.map(d =>
            d.avg >= HIGH_DAY_THRESHOLD ? "#4fd1a5" : d.avg <= LOW_DAY_THRESHOLD ? "#e0577b" : "#7c6cf0"
          ),
          pointRadius: days.map(d => (d.avg >= HIGH_DAY_THRESHOLD || d.avg <= LOW_DAY_THRESHOLD) ? 5 : 2),
          tension: 0.25,
          fill: false
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { min: 0.5, max: 3.5, ticks: { stepSize: 1, callback: v => LEVEL_NAME[v] || "" }, grid: { color: "#322c56" } },
          x: { ticks: { maxTicksLimit: 10, color: "#9c93c4" }, grid: { display:false } }
        },
        plugins: { legend: { display:false } }
      }
    });
  }

  if (days.length < MIN_DAYS_FOR_CYCLE){
    textBox.innerHTML = `目前累積 ${days.length} 天資料,建議至少累積 ${MIN_DAYS_FOR_CYCLE} 天以上才能嘗試判斷月週期。`;
    return;
  }

  const highDays = days.filter(d => d.avg >= HIGH_DAY_THRESHOLD);
  const lowDays = days.filter(d => d.avg <= LOW_DAY_THRESHOLD);
  const highStats = gapStats(highDays);
  const lowStats = gapStats(lowDays);

  let html = `<p>已累積 ${days.length} 天資料。</p>`;

  if (highStats){
    html += `<p>🌟 <span class="highlight-high">超級幸運日</span>平均每隔約 <b>${highStats.avgGap.toFixed(1)} 天</b>出現一次(共出現 ${highStats.count} 次)。
    最近一次是 <b>${fmtDate(highStats.lastItem.date)}</b>,照這個週期推算,下次大概落在 <b>${fmtDate(highStats.nextPredicted)}</b> 前後,可以特別留意把握。</p>`;
  } else if (highDays.length === 1){
    html += `<p>🌟 目前只出現過 1 次超級幸運日(${fmtDate(highDays[0].date)}),還需要再多一次才能算出週期間隔。</p>`;
  } else {
    html += `<p>🌟 目前尚未出現明顯的超級幸運日(當日平均分 ≥ ${HIGH_DAY_THRESHOLD})。</p>`;
  }

  if (lowStats){
    html += `<p>⚠️ <span class="highlight-low">低潮日</span>平均每隔約 <b>${lowStats.avgGap.toFixed(1)} 天</b>出現一次(共出現 ${lowStats.count} 次)。
    最近一次是 <b>${fmtDate(lowStats.lastItem.date)}</b>,照這個週期推算,下次大概落在 <b>${fmtDate(lowStats.nextPredicted)}</b> 前後,建議提前多留意。</p>`;
  } else if (lowDays.length === 1){
    html += `<p>⚠️ 目前只出現過 1 次低潮日(${fmtDate(lowDays[0].date)}),還需要再多一次才能算出週期間隔。</p>`;
  } else {
    html += `<p>⚠️ 目前尚未出現明顯的低潮日(當日平均分 ≤ ${LOW_DAY_THRESHOLD})。</p>`;
  }

  if (highDays.length > 0 || lowDays.length > 0){
    html += `<div class="day-chip-list">`;
    html += highDays.map(d => `<span class="day-chip high">🌟 ${fmtDate(d.date)}</span>`).join("");
    html += lowDays.map(d => `<span class="day-chip low">⚠️ ${fmtDate(d.date)}</span>`).join("");
    html += `</div>`;
  }

  textBox.innerHTML = html;
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

// ===== 登記按鈕:先跳確認卡片,不直接送出 =====
let pendingLevel = null;
const confirmBox = document.getElementById("confirmBox");
const confirmLevelText = document.getElementById("confirmLevelText");
const confirmNoteText = document.getElementById("confirmNoteText");

document.querySelectorAll(".level-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const now = new Date();
    const currentSlot = slotIndex(now);
    const todayKey = dateKey(now);
    const existing = allRecords.find(r => r.dateKey === todayKey && r.slot === currentSlot);
    if (existing){
      alert(`已經紀錄!這個時段(${slotLabel(currentSlot)})今天已經登記過「${LEVEL_NAME[existing.level]}」了。\n如果要修改,請到下方「今日已登記」清單使用「改等級」或「改備註」按鈕。`);
      return;
    }
    pendingLevel = parseInt(btn.dataset.level, 10);
    const note = document.getElementById("noteInput").value.trim();
    confirmLevelText.textContent = LEVEL_NAME[pendingLevel];
    confirmLevelText.className = LEVEL_CLASS[pendingLevel];
    confirmNoteText.textContent = note ? `備註:${note}` : "(無備註)";
    confirmBox.classList.remove("hidden");
  });
});

document.getElementById("confirmCancelBtn").addEventListener("click", () => {
  pendingLevel = null;
  confirmBox.classList.add("hidden");
});

document.getElementById("confirmSubmitBtn").addEventListener("click", () => {
  if (pendingLevel === null) return;
  const note = document.getElementById("noteInput").value.trim();
  submitLevel(pendingLevel, note);
  pendingLevel = null;
  confirmBox.classList.add("hidden");
});

setInterval(renderCurrentSlotHint, 60 * 1000);
