// api/auto-check-late.js
// 修正版：遲到超過 10 分鐘才通知，且同一天、同一人、同一班表時間只通知一次

import admin from "firebase-admin";

// ===== 設定 =====
const LATE_NOTIFY_MINUTES = 10;

// ===== Firebase Admin 初始化 =====
function initFirebase() {
  if (admin.apps.length) return admin.app();

  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!serviceAccountRaw) {
    throw new Error("缺少 FIREBASE_SERVICE_ACCOUNT_KEY");
  }

  if (!databaseURL) {
    throw new Error("缺少 FIREBASE_DATABASE_URL");
  }

  const serviceAccount = JSON.parse(serviceAccountRaw);

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL,
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
    dateKey: `${yyyy}-${mm}-${dd}`,
    timeText: `${hh}:${min}:${ss}`,
    minutesOfDay: taiwan.getHours() * 60 + taiwan.getMinutes(),
  };
}

function timeToMinutes(time) {
  if (!time || typeof time !== "string") return null;
  const match = String(time).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const h = Number(match[1]);
  const m = Number(match[2]);

  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function normalizeTime(time) {
  if (!time) return "";
  return String(time).replace(":", "");
}

function safeKey(value) {
  return String(value || "unknown").replace(/[.#$/\[\]]/g, "_");
}

function getEmployeeId(employee) {
  return safeKey(
    employee.empId ||
      employee.id ||
      employee.employeeId ||
      employee.uid ||
      employee.name ||
      employee.displayName ||
      "unknown"
  );
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

function normalizeStoreName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("斗南")) return "斗南站前店";
  if (text.includes("西螺")) return "西螺文昌店";
  return text;
}

function getLineGroupIdByStore(store) {
  const normalized = normalizeStoreName(store);

  if (normalized === "斗南站前店") {
    return (
      process.env.LINE_GROUP_ID_MANAGER_DOUNAN ||
      process.env.LINE_GROUP_ID_DOUNAN ||
      process.env.LINE_GROUP_DOUNAN ||
      process.env.LINE_GROUP_ID ||
      process.env.LINE_TO
    );
  }

  if (normalized === "西螺文昌店") {
    return (
      process.env.LINE_GROUP_ID_MANAGER_XILUO ||
      process.env.LINE_GROUP_ID_XILUO ||
      process.env.LINE_GROUP_XILUO ||
      process.env.LINE_GROUP_ID ||
      process.env.LINE_TO
    );
  }

  return process.env.LINE_GROUP_ID || process.env.LINE_TO;
}

async function sendLineMessage(text, store) {
  const token =
    process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    process.env.LINE_ACCESS_TOKEN ||
    process.env.LINE_TOKEN;

  const to = getLineGroupIdByStore(store);

  if (!token) {
    throw new Error("缺少 LINE_TOKEN / LINE_CHANNEL_ACCESS_TOKEN");
  }

  if (!to) {
    throw new Error(`缺少 ${store || "對應店別"} 的 LINE 群組 ID`);
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
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

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE 發送失敗：${response.status} ${body}`);
  }
}

// ===== 讀取今日班表 =====
async function readTodaySchedule(db, dateKey) {
  const possiblePaths = [
    `schedules/${dateKey}`,
    `schedule/${dateKey}`,
    `workSchedules/${dateKey}`,
    `shifts/${dateKey}`,
  ];

  for (const path of possiblePaths) {
    const snap = await db.ref(path).once("value");
    if (snap.exists()) {
      return { path, data: snap.val() };
    }
  }

  return { path: null, data: null };
}

// ===== 讀取今日打卡紀錄 =====
// 你的系統目前 records 是扁平資料：records/{recordId}
// 所以這裡會讀全部 records，再篩選今天的「上班」紀錄。
async function readTodayCheckins(db, dateKey) {
  const snap = await db.ref("records").once("value");
  const records = snap.val() || {};
  const result = {};

  Object.entries(records).forEach(([recordId, record]) => {
    if (!record || typeof record !== "object") return;
    if (record.type !== "上班") return;

    const recordDateKey = record.dateKey || "";
    if (recordDateKey !== dateKey) return;

    const empId = safeKey(record.empId || record.employeeId || record.id || "");
    const name = record.name || record.employeeName || record.displayName || "";
    const createdAt = Number(record.createdAt || 0);

    const normalizedRecord = {
      id: recordId,
      ...record,
      time: record.time || record.checkInTime || record.createdAtText || "",
    };

    if (empId) {
      if (!result[empId] || createdAt < Number(result[empId].createdAt || Infinity)) {
        result[empId] = normalizedRecord;
      }
    }

    if (name) {
      const nameKey = safeKey(name);
      if (!result[nameKey] || createdAt < Number(result[nameKey].createdAt || Infinity)) {
        result[nameKey] = normalizedRecord;
      }
    }
  });

  return result;
}

function flattenEmployees(scheduleData) {
  if (!scheduleData) return [];

  if (Array.isArray(scheduleData)) {
    return scheduleData.filter(Boolean).filter((item) => item.working !== false);
  }

  const result = [];

  Object.entries(scheduleData).forEach(([key, value]) => {
    if (!value) return;

    // 形式一：{ employeeId: { name, startTime, working } }
    if (
      typeof value === "object" &&
      (value.name || value.startTime || value.workStart || value.scheduledStart || value.empId)
    ) {
      if (value.working !== false) {
        result.push({ id: key, ...value });
      }
      return;
    }

    // 形式二：{ storeName: { employeeId: {...} } }
    if (typeof value === "object") {
      Object.entries(value).forEach(([subKey, subValue]) => {
        if (subValue && typeof subValue === "object" && subValue.working !== false) {
          result.push({ id: subKey, store: key, ...subValue });
        }
      });
    }
  });

  return result;
}

function findCheckin(checkins, employee) {
  if (!checkins) return null;

  const id = getEmployeeId(employee);
  const empId = safeKey(employee.empId || employee.id || employee.employeeId || "");
  const name = safeKey(getEmployeeName(employee));

  return checkins[id] || checkins[empId] || checkins[name] || null;
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
      return res.status(200).json({
        ok: true,
        dateKey,
        message: `找不到 ${dateKey} 班表，不執行遲到檢查`,
      });
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

      // 還沒到上班時間，不檢查
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

      // 重點：遲到未滿 10 分鐘不通知
      if (lateMinutes < LATE_NOTIFY_MINUTES) {
        skipped.push({ name, reason: `遲到未滿 ${LATE_NOTIFY_MINUTES} 分鐘` });
        continue;
      }

      // 同一天、同一人、同一班表時間，只允許成功發送一次
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
        await sendLineMessage(message, store);

        await lockRef.update({
          lineSent: true,
          sentAtText: now.timeText,
          sentAt: admin.database.ServerValue.TIMESTAMP,
        });

        sent.push({ name, store, lateMinutes });
      } catch (error) {
        // LINE 沒發出去就解除鎖，避免之後永遠不補發
        await lockRef.remove();
        throw error;
      }
    }

    return res.status(200).json({
      ok: true,
      dateKey,
      schedulePath: scheduleResult.path,
      notifyAfterMinutes: LATE_NOTIFY_MINUTES,
      sent,
      skipped,
    });
  } catch (error) {
    console.error("auto-check-late error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
