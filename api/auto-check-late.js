// api/auto-check-late.js
// 修正版：遲到通知「同一天、同一人、同一班表時間」只發一次
// 使用方式：把本檔內容複製後，覆蓋你的 api/auto-check-late.js

import admin from "firebase-admin";

// ===== Firebase Admin 初始化 =====
function initFirebase() {
  if (admin.apps.length) return admin.app();

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

// ===== 台灣時間工具 =====
function getTaiwanDateParts(date = new Date()) {
  const taiwan = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const yyyy = taiwan.getFullYear();
  const mm = String(taiwan.getMonth() + 1).padStart(2, "0");
  const dd = String(taiwan.getDate()).padStart(2, "0");
  const hh = String(taiwan.getHours()).padStart(2, "0");
  const min = String(taiwan.getMinutes()).padStart(2, "0");
  const ss = String(taiwan.getSeconds()).padStart(2, "0");

  return {
    yyyy,
    mm,
    dd,
    dateKey: `${yyyy}-${mm}-${dd}`,
    timeText: `${hh}:${min}:${ss}`,
    minutesOfDay: taiwan.getHours() * 60 + taiwan.getMinutes(),
    taiwanDate: taiwan,
  };
}

function timeToMinutes(time) {
  if (!time || typeof time !== "string") return null;
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function normalizeTime(time) {
  if (!time) return "";
  return String(time).replace(":", "");
}

function getEmployeeId(employee) {
  return String(
    employee.id ||
      employee.employeeId ||
      employee.uid ||
      employee.name ||
      employee.displayName ||
      "unknown"
  ).replace(/[.#$/\[\]]/g, "_");
}

function getEmployeeName(employee) {
  return employee.name || employee.displayName || employee.employeeName || "未命名員工";
}

function getStoreName(employee) {
  return employee.store || employee.storeName || employee.branch || employee.location || "未設定分店";
}

function getScheduleStart(employee) {
  return (
    employee.startTime ||
    employee.workStart ||
    employee.scheduledStart ||
    employee.shiftStart ||
    employee.onDuty ||
    employee.start ||
    ""
  );
}

function getCheckInTime(checkin) {
  if (!checkin) return "";
  return (
    checkin.workStartTime ||
    checkin.clockInTime ||
    checkin.checkInTime ||
    checkin.startTime ||
    checkin.time ||
    checkin.createdAtText ||
    ""
  );
}

async function sendLineMessage(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_ACCESS_TOKEN || process.env.LINE_TOKEN;
  const to = process.env.LINE_GROUP_ID || process.env.LINE_TO;

  if (!token || !to) {
    console.log("缺少 LINE_CHANNEL_ACCESS_TOKEN/LINE_GROUP_ID，略過發送：", text);
    return;
  }

  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE 發送失敗：${res.status} ${body}`);
  }
}

// ===== 依你的資料庫結構讀取班表 =====
async function readTodaySchedule(db, dateKey) {
  // 這裡放多個可能路徑，避免你原本資料路徑不同時直接壞掉
  const possiblePaths = [
    `schedules/${dateKey}`,
    `schedule/${dateKey}`,
    `workSchedules/${dateKey}`,
    `shifts/${dateKey}`,
  ];

  for (const path of possiblePaths) {
    const snap = await db.ref(path).once("value");
    if (snap.exists()) {
      const val = snap.val();
      return { path, data: val };
    }
  }

  return { path: null, data: null };
}

async function readTodayCheckins(db, dateKey) {
  const possiblePaths = [
    `checkins/${dateKey}`,
    `checkIn/${dateKey}`,
    `attendance/${dateKey}`,
    `records/${dateKey}`,
  ];

  for (const path of possiblePaths) {
    const snap = await db.ref(path).once("value");
    if (snap.exists()) return snap.val();
  }

  return {};
}

function flattenEmployees(scheduleData) {
  if (!scheduleData) return [];

  if (Array.isArray(scheduleData)) return scheduleData.filter(Boolean);

  const result = [];

  Object.entries(scheduleData).forEach(([key, value]) => {
    if (!value) return;

    // 形式一：{ employeeId: { name, startTime } }
    if (typeof value === "object" && (value.name || value.startTime || value.workStart || value.scheduledStart)) {
      result.push({ id: key, ...value });
      return;
    }

    // 形式二：{ storeName: { employeeId: {...} } }
    if (typeof value === "object") {
      Object.entries(value).forEach(([subKey, subValue]) => {
        if (subValue && typeof subValue === "object") {
          result.push({ id: subKey, store: key, ...subValue });
        }
      });
    }
  });

  return result;
}

function findCheckin(checkins, employee) {
  const id = getEmployeeId(employee);
  const name = getEmployeeName(employee);

  if (!checkins) return null;

  if (checkins[id]) return checkins[id];

  const entries = Object.entries(checkins);
  for (const [, value] of entries) {
    if (!value || typeof value !== "object") continue;
    if (value.name === name || value.employeeName === name || value.displayName === name) return value;
  }

  return null;
}

export default async function handler(req, res) {
  try {
    initFirebase();
    const db = admin.database();

    const now = getTaiwanDateParts();
    const { dateKey, minutesOfDay } = now;

    const scheduleResult = await readTodaySchedule(db, dateKey);
    const scheduleData = scheduleResult.data;

    if (!scheduleData) {
      return res.status(200).json({ ok: true, message: `找不到 ${dateKey} 班表，不執行遲到檢查` });
    }

    const checkins = await readTodayCheckins(db, dateKey);
    const employees = flattenEmployees(scheduleData);

    const sent = [];
    const skipped = [];

    for (const employee of employees) {
      const name = getEmployeeName(employee);
      const store = getStoreName(employee);
      const employeeId = getEmployeeId(employee);
      const scheduleStart = getScheduleStart(employee);
      const startMinutes = timeToMinutes(scheduleStart);

      if (startMinutes === null) {
        skipped.push({ name, reason: "沒有班表時間" });
        continue;
      }

      // 還沒到上班時間，略過
      if (minutesOfDay <= startMinutes) {
        skipped.push({ name, reason: "尚未到上班時間" });
        continue;
      }

      const checkin = findCheckin(checkins, employee);
      const checkinTime = getCheckInTime(checkin);
      const checkinMinutes = timeToMinutes(checkinTime);

      let lateMinutes = 0;
      let statusText = "";

      if (checkinMinutes !== null) {
        lateMinutes = checkinMinutes - startMinutes;
        statusText = `打卡時間：${checkinTime}`;
      } else {
        lateMinutes = minutesOfDay - startMinutes;
        statusText = "尚未打卡";
      }

      // 沒遲到不發
      if (lateMinutes <= 0) {
        skipped.push({ name, reason: "未遲到" });
        continue;
      }

      // 核心：同一天、同一人、同一班表時間，只允許成功發一次
      const lockKey = `${employeeId}_${normalizeTime(scheduleStart)}`;
      const lockRef = db.ref(`lateNotifications/${dateKey}/${lockKey}`);

      const lockResult = await lockRef.transaction((current) => {
        if (current && current.sent === true) return;
        return {
          sent: true,
          lockedAt: admin.database.ServerValue.TIMESTAMP,
          name,
          store,
          scheduleStart,
          firstLateMinutes: lateMinutes,
          firstStatusText: statusText,
        };
      });

      if (!lockResult.committed) {
        skipped.push({ name, reason: "今天已通知過，略過重複發送" });
        continue;
      }

      const message =
        `⚠️ 遲到通知\n` +
        `分店：${store}\n` +
        `員工：${name}\n` +
        `班表時間：${scheduleStart}\n` +
        `${statusText}\n` +
        `遲到：${lateMinutes} 分鐘`;

      try {
        await sendLineMessage(message);
        await lockRef.update({
          lineSent: true,
          sentAtText: now.timeText,
          sentAt: admin.database.ServerValue.TIMESTAMP,
        });
        sent.push({ name, lateMinutes });
      } catch (err) {
        // 如果 LINE 發送失敗，把鎖解除，避免真的沒發出去卻永遠不補發
        await lockRef.remove();
        throw err;
      }
    }

    return res.status(200).json({
      ok: true,
      dateKey,
      schedulePath: scheduleResult.path,
      sent,
      skipped,
    });
  } catch (error) {
    console.error("auto-check-late error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
