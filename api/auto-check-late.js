// api/auto-check-late.js
// 遲到自動通知：超過 10 分鐘才通知，同一天同一人只通知一次
// 使用 Realtime Database REST API，不需要 firebase-admin，也不需要 Firebase Web SDK 環境變數。

const DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://work-checkin-77acf-default-rtdb.asia-southeast1.firebasedatabase.app";

const LATE_MINUTES_THRESHOLD = 10;

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

  if (normalized === "斗南站前店") {
    return (
      process.env.LINE_GROUP_ID_MANAGER_DOUNAN ||
      process.env.LINE_GROUP_ID_DOUNAN ||
      ""
    );
  }

  if (normalized === "西螺文昌店") {
    return (
      process.env.LINE_GROUP_ID_MANAGER_XILUO ||
      process.env.LINE_GROUP_ID_XILUO ||
      ""
    );
  }

  return "";
}

async function readDb(path) {
  const url = `${DATABASE_URL.replace(/\/$/, "")}/${path}.json`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firebase 讀取失敗：${path} ${response.status} ${text}`);
  }

  return await response.json();
}

async function updateDb(updates) {
  const url = `${DATABASE_URL.replace(/\/$/, "")}/.json`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firebase 更新失敗：${response.status} ${text}`);
  }

  return await response.json();
}

async function pushLineMessage(groupId, text) {
  const token = process.env.LINE_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN;

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

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const now = getTaipeiNow();
    const nowTs = Date.now();
    const today = formatTaipeiDateKey(nowTs);

    const [scheduleMap, recordsMap, sentMap] = await Promise.all([
      readDb(`schedules/${today}`),
      readDb("records"),
      readDb(`line_status/late_sent/${today}`),
    ]);

    const schedules = scheduleMap || {};
    const records = recordsMap || {};
    const alreadySent = sentMap || {};

    const todayWorkInRecords = Object.values(records)
      .filter((item) => {
        const dateKey =
          item?.dateKey ||
          (item?.createdAt ? formatTaipeiDateKey(item.createdAt) : "");
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

    Object.entries(schedules).forEach(([empIdFromKey, item]) => {
      if (!item?.working) return;

      const empId = String(item?.empId || empIdFromKey || "").trim();
      const store = normalizeStoreName(item?.store);
      const startTime = item?.startTime;
      const workDate = parseWorkDateTime(now, startTime);

      if (!empId || !store || !workDate) return;

      const lateStartTs = workDate.getTime() + LATE_MINUTES_THRESHOLD * 60 * 1000;

      if (now.getTime() < lateStartTs) return;

      const storeKey = safeFirebaseKey(store);
      const empKey = safeFirebaseKey(empId);

      if (alreadySent?.[storeKey]?.[empKey]?.sent) return;
      if (alreadySent?.[store]?.[empId]?.sent) return;

      const workInRecord = firstWorkInByEmp[empId];
      const actualTs = workInRecord?.createdAt || 0;

      const isNotChecked = !workInRecord;
      const isLateCheckedIn = actualTs >= lateStartTs;

      if (!isNotChecked && !isLateCheckedIn) return;

      const lateMinutes = isNotChecked
        ? Math.floor((now.getTime() - workDate.getTime()) / 60000)
        : Math.floor((actualTs - workDate.getTime()) / 60000);

      if (!lateByStore[store]) lateByStore[store] = [];
      lateByStore[store].push({
        empId,
        empKey,
        store,
        storeKey,
        name: item?.name || empId,
        startTime: startTime || "未填",
        actualTime: workInRecord?.time || "尚未打卡",
        status: isNotChecked ? "尚未打卡" : "已遲到打卡",
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
          const actualText =
            item.status === "尚未打卡"
              ? "尚未打卡"
              : `打卡 ${item.actualTime}`;
          return `${index + 1}. ${item.name}｜排班 ${item.startTime}｜${actualText}｜遲到 ${item.lateMinutes} 分鐘`;
        }),
        "",
        `共 ${list.length} 人`,
      ].join("\n");

      await pushLineMessage(groupId, message);

      const updates = {};

      list.forEach((item) => {
        updates[`line_status/late_sent/${today}/${item.storeKey}/${item.empKey}`] = {
          sent: true,
          sentAt: nowTs,
          dateKey: today,
          store: item.store,
          empId: item.empId,
          name: item.name,
          startTime: item.startTime,
          actualTime: item.actualTime,
          status: item.status,
          lateMinutes: item.lateMinutes,
          result: "已發送",
        };
      });

      const logKey = `${today}_${safeFirebaseKey(store)}_${nowTs}`;
      updates[`line_status/attendance_sent/${logKey}`] = {
        sent: true,
        sentAt: nowTs,
        dateKey: today,
        store,
        names: list.map((item) => item.name),
        result: `${list.length} 人`,
        message,
        source: "auto-check-late",
      };

      await updateDb(updates);

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
      thresholdMinutes: LATE_MINUTES_THRESHOLD,
      sentCount: sentResults.reduce((sum, item) => sum + item.count, 0),
      stores: sentResults,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || "auto check failed",
    });
  }
};
