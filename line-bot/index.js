require("dotenv").config();
const axios = require("axios");
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get, update } = require("firebase/database");

// Firebase 設定
const firebaseConfig = {
  apiKey: "AIzaSyAfBj728Hs928rZByNebgCkcJoU_MNxFIs",
  authDomain: "work-checkin-77acf.firebaseapp.com",
  databaseURL: "https://work-checkin-77acf-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "work-checkin-77acf",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// LINE 設定（請放在 .env）
// STAFF_GROUP_ID：員工群組
// MANAGER_GROUP_ID：店長群組
const LINE_TOKEN = process.env.LINE_TOKEN;
const STAFF_GROUP_ID = process.env.STAFF_GROUP_ID || process.env.GROUP_ID;
const MANAGER_GROUP_ID = process.env.MANAGER_GROUP_ID || process.env.GROUP_ID;

// 台北日期 YYYY-MM-DD
const getToday = () => {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Taipei",
  });
};

// 取得台北目前時間
const getNowInTaipei = () => {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
};

// 基本檢查
const validateConfig = () => {
  if (!LINE_TOKEN) throw new Error("缺少 LINE_TOKEN，請檢查 .env");
  if (!STAFF_GROUP_ID) throw new Error("缺少 STAFF_GROUP_ID，請檢查 .env");
  if (!MANAGER_GROUP_ID) throw new Error("缺少 MANAGER_GROUP_ID，請檢查 .env");
};

// 發送 LINE
const sendLine = async (to, msg) => {
  validateConfig();

  await axios.post(
    "https://api.line.me/v2/bot/message/push",
    {
      to,
      messages: [{ type: "text", text: msg }],
    },
    {
      headers: {
        Authorization: `Bearer ${LINE_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );
};

// 今日排班自動發送到員工群
const handleScheduleNotify = async () => {
  const today = getToday();

  const schedSnap = await get(ref(db, `schedules/${today}`));
  const sched = schedSnap.val();

  if (!sched) {
    console.log("今天沒有排班資料");
    return;
  }

  const sentRef = ref(db, `line_status/schedule_sent/${today}`);
  const sentSnap = await get(sentRef);
  const sentData = sentSnap.val();

  if (sentData?.sent) {
    console.log("今日上班時間已發送過");
    return;
  }

  let msg = `【今日上班時間通知】\n日期：${today}\n\n`;

  Object.values(sched).forEach((emp) => {
    if (!emp?.name || !emp?.startTime) return;
    msg += `${emp.name}：${emp.startTime}\n`;
  });

  await sendLine(STAFF_GROUP_ID, msg);

  await update(sentRef, {
    sent: true,
    sentAt: Date.now(),
    message: msg,
  });

  console.log("今日上班時間已發送到員工群");
};

// 未打卡超過 5 分鐘通知店長群
const handleAttendanceCheck = async () => {
  const today = getToday();

  const schedSnap = await get(ref(db, `schedules/${today}`));
  const sched = schedSnap.val();

  if (!sched) {
    console.log("今天沒有排班資料，略過未打卡檢查");
    return;
  }

  const recordsSnap = await get(ref(db, "records"));
  const records = recordsSnap.val() || {};

  const now = getNowInTaipei();

  let msg = `【未打卡提醒｜店長群】\n日期：${today}\n\n`;
  let hasMissing = false;

  for (const [empId, emp] of Object.entries(sched)) {
    const startTime = emp?.startTime;
    if (!startTime || !startTime.includes(":")) continue;

    const [h, m] = startTime.split(":").map(Number);
    const workTime = new Date(now);
    workTime.setHours(h, m, 0, 0);

    // 超過 5 分鐘還沒打上班卡
    if (now - workTime > 5 * 60 * 1000) {
      const hasCheckin = Object.values(records).some(
        (r) => r.empId === empId && r.type === "上班" && r.dateKey === today
      );

      if (!hasCheckin) {
        msg += `${emp.name}｜上班時間 ${startTime}\n`;
        hasMissing = true;
      }
    }
  }

  if (!hasMissing) {
    console.log("目前沒有未打卡名單");
    return;
  }

  const remindRef = ref(db, `line_status/attendance_sent/${today}`);
  const remindSnap = await get(remindRef);
  const remindData = remindSnap.val() || {};

  if (remindData.sent) {
    console.log("今天未打卡提醒已發送過");
    return;
  }

  await sendLine(MANAGER_GROUP_ID, msg);

  await update(remindRef, {
    sent: true,
    sentAt: Date.now(),
    message: msg,
  });

  console.log("未打卡提醒已發送到店長群");
};

// 單獨測試員工群
const testStaffLine = async () => {
  try {
    await sendLine(STAFF_GROUP_ID, "🔥 員工群 LINE 測試成功");
    console.log("員工群 LINE 發送成功");
  } catch (err) {
    console.error("員工群 LINE 測試失敗：", err.response?.data || err.message);
  }
};

// 單獨測試店長群
const testManagerLine = async () => {
  try {
    await sendLine(MANAGER_GROUP_ID, "🔥 店長群 LINE 測試成功");
    console.log("店長群 LINE 發送成功");
  } catch (err) {
    console.error("店長群 LINE 測試失敗：", err.response?.data || err.message);
  }
};

// 主程式
const main = async () => {
  try {
    await handleScheduleNotify();
    await handleAttendanceCheck();
  } catch (err) {
    console.error("主程式錯誤：", err.response?.data || err.message);
  }
};

main();

// testStaffLine();
// testManagerLine();
