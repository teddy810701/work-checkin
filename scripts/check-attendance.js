const { initializeApp, cert } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

initializeApp({
  credential: cert(serviceAccount),
  databaseURL:
    "https://work-checkin-77acf-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const db = getDatabase();
const LINE_TOKEN = process.env.LINE_CHANNEL_TOKEN;
const OWNER_ID = process.env.LINE_OWNER_ID;

const STORE_GROUP_MAP = {
  西螺文昌店: process.env.LINE_GROUP_XILUO,
  斗南站前店: process.env.LINE_GROUP_DOUNAN,
};

function getTaipeiTime() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })
  );
}

function getTodayKey() {
  const d = getTaipeiTime();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

async function sendLine(to, text) {
  if (!to || !LINE_TOKEN) return;
  const resp = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text }],
    }),
  });
  if (!resp.ok) {
    console.error(`LINE 傳送失敗 (${to}):`, await resp.text());
  }
}

async function main() {
  const todayKey = getTodayKey();
  const now = getTaipeiTime();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const timeStr = now.toLocaleTimeString("zh-TW", { hour12: false });

  console.log(`[${todayKey} ${timeStr}] 開始檢查打卡狀況`);

  const schedSnap = await db.ref(`schedules/${todayKey}`).get();
  const schedules = schedSnap.val() || {};

  if (Object.keys(schedules).length === 0) {
    console.log("今日無排班資料，結束。");
    return;
  }

  const recordsSnap = await db.ref("records").get();
  const allRecords = recordsSnap.val() || {};

  const clockedIn = new Set();
  Object.values(allRecords).forEach((r) => {
    if (r.dateKey === todayKey && r.type === "上班") {
      clockedIn.add(r.empId);
    }
  });

  const notifiedSnap = await db.ref(`notified/${todayKey}`).get();
  const notified = notifiedSnap.val() || {};

  const lateByStore = {};

  for (const [empId, sched] of Object.entries(schedules)) {
    if (!sched.working) continue;
    if (clockedIn.has(empId)) continue;
    if (notified[empId]) continue;

    const threshold = timeToMinutes(sched.startTime) + 5;
    if (nowMinutes < threshold) continue;

    const store = sched.store || "未知店面";
    if (!lateByStore[store]) lateByStore[store] = [];
    lateByStore[store].push({
      name: sched.name,
      startTime: sched.startTime,
      empId,
    });

    await db.ref(`notified/${todayKey}/${empId}`).set(true);
  }

  if (Object.keys(lateByStore).length === 0) {
    console.log("目前無遲到員工。");
    return;
  }

  for (const [store, emps] of Object.entries(lateByStore)) {
    const nameList = emps
      .map((e) => `• ${e.name}（應到 ${e.startTime}）`)
      .join("\n");
    const msg = `⚠️ ${store} 打卡提醒\n\n尚未打卡：\n${nameList}\n\n請確認是否正常出勤`;

    await sendLine(OWNER_ID, msg);

    const groupId = STORE_GROUP_MAP[store];
    await sendLine(groupId, msg);

    console.log(`已通知 ${store}：`, emps.map((e) => e.name).join("、"));
  }
}

main()
  .catch((err) => {
    console.error("執行失敗：", err);
    process.exit(1);
  })
  .finally(() => {
    setTimeout(() => process.exit(0), 2000);
  });
