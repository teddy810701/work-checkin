import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, get, update, push, set } from "firebase/database";

function normalizeStoreName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("斗南")) return "斗南站前店";
  if (text.includes("西螺")) return "西螺文昌店";
  return text;
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
  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
  } catch (error) {
    throw new Error(`Firebase 匿名登入失敗：${error.message}`);
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

    const todayRecords = Object.values(recordsMap).filter((item) => {
      const dateKey = item?.dateKey || (item?.createdAt ? formatTaipeiDateKey(item.createdAt) : "");
      return dateKey === today;
    });

    const lateByStore = {};

    Object.entries(scheduleMap).forEach(([empId, item]) => {
      if (!item?.working) return;
      const store = normalizeStoreName(item?.store);
      const startTime = item?.startTime;
      const workDate = parseWorkDateTime(now, startTime);
      if (!store || !workDate) return;

      const isLate = now.getTime() >= workDate.getTime() + 60 * 1000;
      if (!isLate) return;

      const hasCheckin = todayRecords.some((r) => r?.empId === empId && r?.type === "上班");
      if (hasCheckin) return;

      if (sentMap?.[store]?.[empId]?.sent) return;

      if (!lateByStore[store]) lateByStore[store] = [];
      lateByStore[store].push({
        empId,
        name: item?.name || empId,
        startTime: startTime || "未填",
      });
    });

    const sentResults = [];

    for (const [store, list] of Object.entries(lateByStore)) {
      if (!list.length) continue;

      const groupId = getManagerGroupIdByStore(store);
      const message = [
        `【遲到通知】`,
        `日期：${today}`,
        `店別：${store}`,
        `時間：${formatTaipeiDateTime(nowTs)}`,
        "",
        ...list.map((item) => `${item.name}｜上班 ${item.startTime}｜目前未打上班卡`),
      ].join("\n");

      await pushLineMessage(groupId, message);

      const updates = {};
      list.forEach((item) => {
        updates[`line_status/late_sent/${today}/${store}/${item.empId}`] = {
          sent: true,
          sentAt: nowTs,
          name: item.name,
          startTime: item.startTime,
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
      sentCount: sentResults.reduce((sum, item) => sum + item.count, 0),
      stores: sentResults,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || "auto check failed",
    });
  }
}
