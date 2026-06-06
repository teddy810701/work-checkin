// api/auto-check-late.js
// 遲到通知修正版：
// 1. 不使用 firebase-admin，避免 Vercel 出現 Cannot find module 'firebase-admin'
// 2. 超過 10 分鐘才通知
// 3. 同一天、同一員工、同一班表時間只通知一次
// 4. 支援「尚未打卡」與「已打卡但遲到超過 10 分鐘」

import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, get, update, push, set, runTransaction } from "firebase/database";

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

function getManagerGroupIdByStore(store) {
  const normalized = normalizeStoreName(store);
  if (normalized === "斗南站前店") {
    return process.env.LINE_GROUP_ID_MANAGER_DOUNAN || process.env.LINE_GROUP_ID_DOUNAN || "";
  }
  if (normalized === "西螺文昌店") {
    return process.env.LINE_GROUP_ID_MANAGER_XILUO || process.env.LINE_GROUP_ID_XILUO || "";
  }
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

function buildLateMessage(store, list, today, nowTs) {
  return [
    `⚠️ ${today} ${store} 遲到名單`,
    "",
    ...list.map((item, index) => {
      const actualText = item.status === "not_checked"
        ? "尚未打卡"
        : `打卡 ${item.actualTime || "未記錄"}`;
      return `${index + 1}. ${item.name}｜排班 ${item.startTime}｜${actualText}｜遲到 ${item.lateMinutes} 分鐘`;
    }),
    "",
    `共 ${list.length} 人`,
    `檢查時間：${formatTaipeiDateTime(nowTs)}`,
  ].join("\n");
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

    const [scheduleSnap, recordsSnap] = await Promise.all([
      get(ref(db, `schedules/${today}`)),
      get(ref(db, "records")),
    ]);

    const scheduleMap = scheduleSnap.val() || {};
    const recordsMap = recordsSnap.val() || {};

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
      if (!firstWorkInByEmp[empId]) {
        firstWorkInByEmp[empId] = record;
      }
    });

    const lateByStore = {};
    const skipped = [];

    for (const [empIdFromKey, item] of Object.entries(scheduleMap)) {
      if (!item?.working) continue;

      const empId = item.empId || empIdFromKey;
      const name = item.name || empId;
      const store = normalizeStoreName(item.store || "未填店名");
      const startTime = item.startTime || "05:00";
      const workDate = parseWorkDateTime(now, startTime);

      if (!store || !workDate) {
        skipped.push({ empId, name, reason: "缺少店別或班表時間" });
        continue;
      }

      const scheduledTs = workDate.getTime();
      const notifyTs = scheduledTs + LATE_GRACE_MINUTES * 60 * 1000;
      const workInRecord = firstWorkInByEmp[empId];

      let lateMinutes = 0;
      let status = "";
      let actualTime = "未打卡";

      if (workInRecord) {
        lateMinutes = Math.floor(((workInRecord.createdAt || 0) - scheduledTs) / 60000);
        status = "late_checked_in";
        actualTime = workInRecord.time || formatTaipeiDateTime(workInRecord.createdAt || nowTs);
      } else {
        lateMinutes = Math.floor((nowTs - scheduledTs) / 60000);
        status = "not_checked";
      }

      if (lateMinutes < LATE_GRACE_MINUTES) {
        skipped.push({ empId, name, reason: `遲到未滿 ${LATE_GRACE_MINUTES} 分鐘` });
        continue;
      }

      if (!workInRecord && nowTs < notifyTs) {
        skipped.push({ empId, name, reason: "尚未到通知時間" });
        continue;
      }

      const storeKey = safeFirebaseKey(store);
      const empKey = safeFirebaseKey(empId);
      const startKey = safeFirebaseKey(startTime);
      const lockRef = ref(db, `line_status/late_sent/${today}/${storeKey}/${empKey}_${startKey}`);

      const lockResult = await runTransaction(lockRef, (current) => {
        if (current?.sent === true || current?.locked === true) return current;
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

      const lockValue = lockResult.snapshot.val();
      if (!lockResult.committed || lockValue?.sent === true) {
        skipped.push({ empId, name, reason: "今日已通知過" });
        continue;
      }

      if (!lateByStore[store]) lateByStore[store] = [];
      lateByStore[store].push({
        empId,
        name,
        store,
        startTime,
        actualTime,
        status,
        lateMinutes,
        lockPath: `line_status/late_sent/${today}/${storeKey}/${empKey}_${startKey}`,
      });
    }

    const sentResults = [];

    for (const [store, list] of Object.entries(lateByStore)) {
      if (!list.length) continue;

      const groupId = getManagerGroupIdByStore(store);
      const message = buildLateMessage(store, list, today, nowTs);

      try {
        await pushLineMessage(groupId, message);

        const updates = {};
        list.forEach((item) => {
          updates[item.lockPath] = {
            locked: false,
            sent: true,
            sentAt: nowTs,
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

        const logRef = push(ref(db, `line_status/attendance_sent/${today}`));
        await Promise.all([
          update(ref(db), updates),
          set(logRef, {
            sent: true,
            sentAt: nowTs,
            store,
            dateKey: today,
            names: list.map((item) => item.name),
            lateDetails: list.map((item) => ({
              empId: item.empId,
              name: item.name,
              startTime: item.startTime,
              actualTime: item.actualTime,
              status: item.status,
              lateMinutes: item.lateMinutes,
            })),
            result: `${list.length} 人`,
            message,
          }),
        ]);

        sentResults.push({ store, count: list.length, names: list.map((item) => item.name) });
      } catch (error) {
        const updates = {};
        list.forEach((item) => {
          updates[item.lockPath] = {
            locked: false,
            sent: false,
            error: error?.message || "LINE 發送失敗",
            failedAt: nowTs,
            dateKey: today,
            store,
            empId: item.empId,
            name: item.name,
            startTime: item.startTime,
            actualTime: item.actualTime,
            status: item.status,
            lateMinutes: item.lateMinutes,
            result: "發送失敗",
          };
        });
        await update(ref(db), updates);
        throw error;
      }
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
    return res.status(500).json({
      success: false,
      error: error?.message || "auto check failed",
    });
  }
}
