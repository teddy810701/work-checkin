// api/auto-check-late.js
// 遲到自動檢查：超過 10 分鐘才通知，同一天同一人只通知一次。
// 注意：此檔案使用 CommonJS，避免 Vercel 出現 Failed to load the ES module。

const { initializeApp, getApps } = require("firebase/app");
const { getAuth, signInAnonymously } = require("firebase/auth");
const {
  getDatabase,
  ref,
  get,
  update,
  push,
  set,
  remove,
  runTransaction,
} = require("firebase/database");

const LATE_GRACE_MINUTES = 10;

function normalizeStoreName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("斗南")) return "斗南站前店";
  if (text.includes("西螺")) return "西螺文昌店";
  return text;
}

function safeFirebaseKey(value = "") {
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

function getFirstWorkInRecord(todayRecords, empId, name) {
  const normalizedEmpId = String(empId || "").trim();
  const normalizedName = String(name || "").trim();

  return todayRecords
    .filter((record) => record?.type === "上班")
    .filter((record) => {
      const recordEmpId = String(record?.empId || "").trim();
      const recordName = String(record?.name || "").trim();
      return (
        (normalizedEmpId && recordEmpId === normalizedEmpId) ||
        (normalizedName && recordName === normalizedName)
      );
    })
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0] || null;
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const lockedRefs = [];

  try {
    const db = await getFirebaseDb();
    const now = getTaipeiNow();
    const nowTs = Date.now();
    const today = formatTaipeiDateKey(nowTs);

    const [scheduleSnap, recordsSnap] = await Promise.all([
      get(ref(db, `schedules/${today}`)),
      get(ref(db, "records")),
    ]);

    const scheduleMap = scheduleSnap.val() || {};
    const recordsMap = recordsSnap.val() || {};

    const todayRecords = Object.values(recordsMap).filter((item) => {
      const dateKey = item?.dateKey || (item?.createdAt ? formatTaipeiDateKey(item.createdAt) : "");
      return dateKey === today;
    });

    const lateByStore = {};
    const skipped = [];

    for (const [empIdFromKey, item] of Object.entries(scheduleMap)) {
      if (!item?.working) continue;

      const empId = String(item.empId || empIdFromKey || "").trim();
      const name = item?.name || empId;
      const store = normalizeStoreName(item?.store);
      const startTime = item?.startTime;
      const workDate = parseWorkDateTime(now, startTime);

      if (!empId || !store || !workDate) {
        skipped.push({ empId, name, reason: "資料不完整" });
        continue;
      }

      const graceTs = workDate.getTime() + LATE_GRACE_MINUTES * 60 * 1000;
      const workInRecord = getFirstWorkInRecord(todayRecords, empId, name);

      let shouldNotify = false;
      let status = "not_checked";
      let actualTime = "未打卡";
      let lateMinutes = 0;

      if (workInRecord?.createdAt) {
        const actualTs = Number(workInRecord.createdAt) || 0;
        if (actualTs >= graceTs) {
          shouldNotify = true;
          status = "late_checked_in";
          actualTime = workInRecord.time || formatTaipeiDateTime(actualTs);
          lateMinutes = Math.floor((actualTs - workDate.getTime()) / 60000);
        }
      } else if (now.getTime() >= graceTs) {
        shouldNotify = true;
        status = "not_checked";
        actualTime = "尚未打卡";
        lateMinutes = Math.floor((now.getTime() - workDate.getTime()) / 60000);
      }

      if (!shouldNotify) continue;

      const storeKey = safeFirebaseKey(store);
      const empKey = safeFirebaseKey(empId);
      const lockRef = ref(db, `line_status/late_sent/${today}/${storeKey}/${empKey}`);

      const lockResult = await runTransaction(lockRef, (current) => {
        if (current?.sent === true || current?.locked === true) return;
        return {
          locked: true,
          sent: false,
          lockedAt: nowTs,
          dateKey: today,
          store,
          empId,
          name,
          startTime,
          actualTime,
          status,
          lateMinutes,
        };
      });

      if (!lockResult.committed) {
        skipped.push({ empId, name, reason: "今天已通知過或正在通知" });
        continue;
      }

      lockedRefs.push(lockRef);

      if (!lateByStore[store]) lateByStore[store] = [];
      lateByStore[store].push({
        empId,
        empKey,
        lockRef,
        name,
        store,
        startTime: startTime || "未填",
        actualTime,
        status,
        lateMinutes,
      });
    }

    const sentResults = [];

    for (const [store, list] of Object.entries(lateByStore)) {
      if (!list.length) continue;

      const groupId = getManagerGroupIdByStore(store);
      const message = [
        `⚠️ ${today} ${store} 遲到名單`,
        "",
        ...list.map((item, index) => {
          const actualText = item.status === "not_checked"
            ? "尚未打卡"
            : `打卡 ${item.actualTime}`;
          return `${index + 1}. ${item.name}｜排班 ${item.startTime}｜${actualText}｜遲到 ${item.lateMinutes} 分鐘`;
        }),
        "",
        `共 ${list.length} 人`,
      ].join("\n");

      await pushLineMessage(groupId, message);

      const sentAt = Date.now();
      const updates = {};

      list.forEach((item) => {
        const storeKey = safeFirebaseKey(store);
        updates[`line_status/late_sent/${today}/${storeKey}/${item.empKey}`] = {
          locked: false,
          sent: true,
          sentAt,
          dateKey: today,
          store,
          empId: item.empId,
          name: item.name,
          startTime: item.startTime,
          actualTime: item.actualTime,
          status: item.status,
          lateMinutes: item.lateMinutes,
          result: "已發送",
        };
      });

      await update(ref(db), updates);

      const logRef = push(ref(db, "line_status/attendance_sent"));
      await set(logRef, {
        sent: true,
        sentAt,
        store,
        dateKey: today,
        names: list.map((item) => item.name),
        result: `${list.length} 人`,
        message,
      });

      sentResults.push({
        store,
        count: list.length,
        names: list.map((item) => item.name),
      });
    }

    return res.status(200).json({
      success: true,
      dateKey: today,
      checkedAt: nowTs,
      graceMinutes: LATE_GRACE_MINUTES,
      sentCount: sentResults.reduce((sum, item) => sum + item.count, 0),
      stores: sentResults,
      skipped,
    });
  } catch (error) {
    // 如果 LINE 或其他流程失敗，把本次鎖定移除，避免之後永遠不通知。
    await Promise.all(
      lockedRefs.map((itemRef) => remove(itemRef).catch(() => null))
    );

    return res.status(500).json({
      success: false,
      error: error?.message || "auto check failed",
    });
  }
};
