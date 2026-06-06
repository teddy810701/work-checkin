import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, get, update, push, set } from "firebase/database";

const LATE_GRACE_MINUTES = 10;

function normalizeStoreName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("斗南")) return "斗南站前店";
  if (text.includes("西螺")) return "西螺文昌店";
  return text;
}

function safeFirebaseKey(value) {
  return String(value || "")
    .replace(/[.#$\[\]/]/g, "_")
    .replace(/\s+/g, "_");
}

function getTaipeiNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function formatTaipeiDateKey(date = Date.now()) {
  const d = new Date(date);
  const tw = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const y = tw.getFullYear();
  const m = String(tw.getMonth() + 1).padStart(2, "0");
  const day = String(tw.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTaipeiDateTime(date = Date.now()) {
  return new Date(date).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });
}

function parseWorkDateTime(now, timeText) {
  if (!timeText || !String(timeText).includes(":")) return null;
  const [hh, mm] = String(timeText).split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const workDate = new Date(now);
  workDate.setHours(hh, mm, 0, 0);
  return workDate;
}

function getRecordTimeText(record) {
  if (record?.time) return record.time;
  if (record?.createdAt) {
    return new Date(record.createdAt).toLocaleTimeString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return "未記錄";
}

function getManagerGroupIdByStore(store) {
  const normalized = normalizeStoreName(store);
  if (normalized === "斗南站前店") return process.env.LINE_GROUP_ID_MANAGER_DOUNAN;
  if (normalized === "西螺文昌店") return process.env.LINE_GROUP_ID_MANAGER_XILUO;
  return "";
}

async function pushLineMessage(groupId, text) {
  const token = process.env.LINE_TOKEN;
  if (!token) throw new Error("缺少 LINE_TOKEN");
  if (!groupId) throw new Error("缺少店長群組 ID");

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: groupId,
      messages: [{ type: "text", text }],
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(raw || "LINE 推播失敗");
  }

  return raw;
}

async function getFirebaseDb() {
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  };

  const missing = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`缺少 Firebase 環境變數：${missing.join(", ")}`);
  }

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);

  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }

  return getDatabase(app);
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const db = await getFirebaseDb();
    const now = getTaipeiNow();
    const nowTs = Date.now();
    const today = formatTaipeiDateKey(nowTs);

    const [scheduleSnap, recordsSnap, sentSnap] = await Promise.all([
      get(ref(db, `schedules/${today}`)),
      get(ref(db, "records")),
      get(ref(db, `line_status/late_sent/${today}`)),
    ]);

    const scheduleMap = scheduleSnap.val() || {};
    const recordsMap = recordsSnap.val() || {};
    const sentMap = sentSnap.val() || {};

    const todayWorkInRecords = Object.values(recordsMap)
      .filter((item) => {
        const dateKey = item?.dateKey || (item?.createdAt ? formatTaipeiDateKey(item.createdAt) : "");
        return dateKey === today && item?.type === "上班";
      })
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    const firstWorkInByEmp = {};
    todayWorkInRecords.forEach((record) => {
      const empId = String(record?.empId || "").trim();
      if (!empId) return;
      if (!firstWorkInByEmp[empId]) firstWorkInByEmp[empId] = record;
    });

    const lateByStore = {};

    Object.entries(scheduleMap).forEach(([empIdFromKey, item]) => {
      if (!item?.working) return;

      const empId = String(item?.empId || empIdFromKey || "").trim();
      const store = normalizeStoreName(item?.store);
      const startTime = item?.startTime;
      const workDate = parseWorkDateTime(now, startTime);
      if (!empId || !store || !workDate) return;

      const storeKey = safeFirebaseKey(store);
      const empKey = safeFirebaseKey(empId);
      if (sentMap?.[storeKey]?.[empKey]?.sent || sentMap?.[store]?.[empId]?.sent) return;

      const deadlineTs = workDate.getTime() + LATE_GRACE_MINUTES * 60 * 1000;
      const workInRecord = firstWorkInByEmp[empId];
      const actualTs = workInRecord?.createdAt || 0;

      const isNotCheckedAndLate = !workInRecord && now.getTime() >= deadlineTs;
      const isCheckedInLate = Boolean(workInRecord && actualTs >= deadlineTs);

      if (!isNotCheckedAndLate && !isCheckedInLate) return;

      const lateMinutes = isNotCheckedAndLate
        ? Math.floor((now.getTime() - workDate.getTime()) / 60000)
        : Math.floor((actualTs - workDate.getTime()) / 60000);

      if (!lateByStore[store]) lateByStore[store] = [];
      lateByStore[store].push({
        empId,
        empKey,
        storeKey,
        name: item?.name || empId,
        startTime: startTime || "未填",
        actualTime: isCheckedInLate ? getRecordTimeText(workInRecord) : "尚未打卡",
        status: isCheckedInLate ? "late_checked_in" : "not_checked",
        lateMinutes,
      });
    });

    const sentResults = [];

    for (const [store, list] of Object.entries(lateByStore)) {
      if (!list.length) continue;

      const groupId = getManagerGroupIdByStore(store);
      const message = [
        `⚠️ ${today} ${store} 遲到名單`,
        "",
        ...list.map((item, index) => {
          const actualText = item.status === "not_checked" ? "尚未打卡" : `打卡 ${item.actualTime}`;
          return `${index + 1}. ${item.name}｜排班 ${item.startTime}｜${actualText}｜遲到 ${item.lateMinutes} 分鐘`;
        }),
        "",
        `共 ${list.length} 人`,
      ].join("
");

      await pushLineMessage(groupId, message);

      const updates = {};
      list.forEach((item) => {
        updates[`line_status/late_sent/${today}/${item.storeKey}/${item.empKey}`] = {
          sent: true,
          sentAt: nowTs,
          name: item.name,
          empId: item.empId,
          startTime: item.startTime,
          actualTime: item.actualTime,
          status: item.status,
          lateMinutes: item.lateMinutes,
          store,
          dateKey: today,
        };
      });
      await update(ref(db), updates);

      const logRef = push(ref(db, "line_status/attendance_sent"));
      await set(logRef, {
        sent: true,
        sentAt: nowTs,
        store,
        dateKey: today,
        names: list.map((item) => item.name),
        result: `${list.length} 人`,
        message,
      });

      sentResults.push({ store, count: list.length, names: list.map((item) => item.name) });
    }

    return res.status(200).json({
      success: true,
      dateKey: today,
      checkedAt: nowTs,
      graceMinutes: LATE_GRACE_MINUTES,
      sentCount: sentResults.reduce((sum, item) => sum + item.count, 0),
      stores: sentResults,
    });
  } catch (error) {
    console.error("auto-check-late failed:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "auto check failed",
    });
  }
}
