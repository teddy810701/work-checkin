import React, { useEffect, useMemo, useState } from "react";
import { db, auth } from "./firebase";
import { ref, set, onValue, update, remove, get, query, orderByChild, limitToLast } from "firebase/database";
import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection as fsCollection, doc as fsDoc, getDocs, serverTimestamp, setDoc as fsSetDoc } from "firebase/firestore";

const ADMIN_PASSWORD = "8888";
const CHECKIN_COOLDOWN = 30000;
const LATE_CONFIRM_MINUTES = 60;
const LONG_BREAK_MINUTES = 30;
const DEVICE_BIND_OPTIONS = [
  "西螺文昌店",
  "斗南站前店",
  "老闆手機",
  "老闆娘手機",
  "老闆電腦",
];

// ===== 積分系統 Firebase（Firestore） =====
// 這組是績效考核系統 Firebase，打卡系統會在打卡成功後讀取本月積分。
const POINTS_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAfBj728Hs928rZByNebgCkcJoU_MNxFIs",
  authDomain: "my-warm-day-pro.firebaseapp.com",
  projectId: "my-warm-day-pro",
  storageBucket: "my-warm-day-pro.appspot.com",
  messagingSenderId: "409964225413",
  appId: "1:409964225413:web:82fad775514edb08735aec",
};

const POINTS_APP_NAME = "pointsApp";
const pointsApp = getApps().some((item) => item.name === POINTS_APP_NAME)
  ? getApp(POINTS_APP_NAME)
  : initializeApp(POINTS_FIREBASE_CONFIG, POINTS_APP_NAME);
const pointsDb = getFirestore(pointsApp);
const pointsAuth = getAuth(pointsApp);
const MONTHLY_BASE_POINTS = 50;
const POINTS_STORE_IDS = ["storeA", "storeB"];
const POINTS_STORE_LABELS = {
  storeA: "西螺文昌店",
  storeB: "斗南站前店",
};


const getDeviceId = () => {
  let id = localStorage.getItem("device_id");
  if (!id) {
    id = "DEV-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    localStorage.setItem("device_id", id);
  }
  return id;
};

const formatTaipeiNow = () => {
  return new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });
};

const formatTaipeiDateKey = (ts = Date.now()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts));

  const year = parts.find((p) => p.type === "year")?.value || "";
  const month = parts.find((p) => p.type === "month")?.value || "";
  const day = parts.find((p) => p.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
};

const getTomorrowTaipeiDateKey = () => {
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
  return formatTaipeiDateKey(tomorrow);
};

const getYesterdayTaipeiDateKey = () => {
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  return formatTaipeiDateKey(yesterday);
};

// 行政院人事行政總處 115 年（2026）政府行政機關辦公日曆表中的平日放假日。
// 週六、週日會另外依日期自動判斷。
const TAIWAN_HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-02-20",
  "2026-02-27",
  "2026-04-03",
  "2026-04-06",
  "2026-05-01",
  "2026-06-19",
  "2026-09-25",
  "2026-09-28",
  "2026-10-09",
  "2026-10-26",
  "2026-12-25",
]);

const isTaiwanHoliday = (dateKey = "") => {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  if (!year || !month || !day) return false;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6 || TAIWAN_HOLIDAYS_2026.has(dateKey);
};

const getDefaultScheduleStartTime = (storeName = "", dateKey = "") => {
  if (String(storeName).includes("斗南")) return "05:30";
  if (String(storeName).includes("西螺") && isTaiwanHoliday(dateKey)) return "05:15";
  return "05:00";
};

const getMonthValue = (ts = Date.now()) => {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const getMonthKeyFromDateKey = (dateKey) => {
  if (!dateKey || typeof dateKey !== "string") return getMonthValue();
  return dateKey.slice(0, 7);
};

const normalizeEmpId = (value) => String(value || "").trim().toUpperCase();

const getMonthKeyFromAnyDate = (value) => {
  if (!value) return "";
  let d = null;
  if (value?.toDate) d = value.toDate();
  else if (value?.seconds) d = new Date(value.seconds * 1000);
  else d = new Date(value);
  if (!d || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const getDateKeyFromAnyDate = (value) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  let d = null;
  if (value?.toDate) d = value.toDate();
  else if (value?.seconds) d = new Date(value.seconds * 1000);
  else d = new Date(value);
  if (!d || Number.isNaN(d.getTime())) return "";
  return formatTaipeiDateKey(d.getTime());
};

const ensurePointsFirebaseAuth = async () => {
  if (pointsAuth.currentUser) return true;
  await signInAnonymously(pointsAuth);
  return true;
};

const fetchMonthlyPointsFromPerformanceSystem = async (empId) => {
  const targetId = normalizeEmpId(empId);
  if (!targetId) {
    return { found: false, message: "尚無積分資料" };
  }

  await ensurePointsFirebaseAuth();

  for (const storeId of POINTS_STORE_IDS) {
    const empSnap = await getDocs(fsCollection(pointsDb, "stores", storeId, "employees"));
    const matchedDoc = empSnap.docs.find((empDoc) => {
      const data = empDoc.data() || {};
      const candidates = [
        empDoc.id,
        data.birthdayId,
        data.checkinId,
        data.employeeId,
        data.empId,
        data.id,
        data.birthday,
        data.birthDate,
      ];
      return candidates.some((item) => normalizeEmpId(item) === targetId);
    });

    if (!matchedDoc) continue;

    const logSnap = await getDocs(fsCollection(pointsDb, "stores", storeId, "logs"));
    const monthKey = getMonthValue();
    const monthLogs = logSnap.docs
      .map((item) => ({ id: item.id, ...(item.data() || {}) }))
      .filter((log) => {
        if (log.empId !== matchedDoc.id) return false;
        return getMonthKeyFromAnyDate(log.occurrenceDate || log.timestamp) === monthKey;
      });

    const monthlyDelta = monthLogs.reduce((sum, log) => sum + (Number(log.amount) || 0), 0);
    const monthlyPoints = MONTHLY_BASE_POINTS + monthlyDelta;
    const penaltyCount = monthLogs.filter((log) => Number(log.amount) < 0).length;
    const bonusCount = monthLogs.filter((log) => Number(log.amount) > 0).length;

    return {
      found: true,
      empDocId: matchedDoc.id,
      storeId,
      name: matchedDoc.data()?.name || "",
      monthlyPoints,
      monthlyDelta,
      logCount: monthLogs.length,
      penaltyCount,
      bonusCount,
      monthKey,
    };
  }

  return { found: false, message: "尚無積分資料" };
};

const fetchYesterdayPointsAnnouncement = async () => {
  await ensurePointsFirebaseAuth();
  const yesterdayKey = getYesterdayTaipeiDateKey();

  const storeEntries = await Promise.all(POINTS_STORE_IDS.map(async (storeId) => {
    const [empSnap, logSnap] = await Promise.all([
      getDocs(fsCollection(pointsDb, "stores", storeId, "employees")),
      getDocs(fsCollection(pointsDb, "stores", storeId, "logs")),
    ]);
    const employeeNames = new Map(empSnap.docs.map((item) => [item.id, item.data()?.name || ""]));

    return logSnap.docs
      .map((item) => ({ id: item.id, ...(item.data() || {}) }))
      .filter((log) => Number(log.amount) !== 0
        && getDateKeyFromAnyDate(log.occurrenceDate || log.timestamp) === yesterdayKey)
      .map((log) => {
        const amount = Number(log.amount);
        const name = log.name || employeeNames.get(log.empId) || "未具名員工";
        const reason = String(log.reason || "未填原因").trim();
        const note = String(log.note || "").trim();
        const detail = note && note !== reason ? `（${note}）` : "";
        return `• ${name} ${amount > 0 ? "+" : ""}${amount} 分｜${reason}${detail}`;
      });
  }));

  const entries = storeEntries.flat();
  if (!entries.length) return null;
  return {
    title: "昨日加扣分公告",
    content: `${yesterdayKey} 加扣分紀錄\n\n${entries.join("\n")}`,
  };
};


const getStatusStyle = (status) => {
  switch (status) {
    case "上班中":
      return {
        background: "#dcfce7",
        color: "#166534",
        dot: "#22c55e",
        border: "#86efac",
      };
    case "休息中":
      return {
        background: "#ffedd5",
        color: "#9a3412",
        dot: "#f59e0b",
        border: "#fdba74",
      };
    case "已下班":
    case "未打卡":
      return {
        background: "#fee2e2",
        color: "#b91c1c",
        dot: "#ef4444",
        border: "#fca5a5",
      };
    default:
      return {
        background: "#e0f2fe",
        color: "#0369a1",
        dot: "#38bdf8",
        border: "#7dd3fc",
      };
  }
};

const getRequestStatusMeta = (status) => {
  if (status === "approved") return { label: "已批准", color: "#166534", background: "#dcfce7" };
  if (status === "rejected") return { label: "已退回", color: "#b91c1c", background: "#fee2e2" };
  return { label: "待審核", color: "#9a3412", background: "#ffedd5" };
};

const formatDate = (timestamp) => {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString("zh-TW");
};

const formatDateTime = (timestamp) => {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString("zh-TW", {
    hour12: false,
  });
};

const formatAnyDateTime = (value) => {
  if (!value) return "尚無紀錄";
  if (value?.toDate) return formatDateTime(value.toDate());
  if (value?.seconds) return formatDateTime(value.seconds * 1000);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).replace("T", " ");
  return formatDateTime(parsed);
};

const formatDateTimeLocalValue = (timestamp) => {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const datetimeLocalToTimestamp = (value) => {
  if (!value) return 0;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

const getNextStatus = (type) => {
  if (type === "上班") return "上班中";
  if (type === "下班") return "已下班";
  if (type === "休息開始") return "休息中";
  if (type === "休息結束") return "上班中";
  return "未打卡";
};

const isValidTransition = (currentStatus, type) => {
  const status = currentStatus || "未打卡";

  if (type === "上班") return status === "未打卡" || status === "已下班";
  if (type === "下班") return status === "上班中";
  if (type === "休息開始") return status === "上班中";
  if (type === "休息結束") return status === "休息中";
  return false;
};

const getMissingPunchType = (currentStatus, targetType) => {
  const status = currentStatus || "未打卡";
  if (status === "未打卡" && ["休息開始", "下班"].includes(targetType)) return "上班";
  if (status === "上班中" && targetType === "休息結束") return "休息開始";
  if (status === "休息中" && targetType === "下班") return "休息結束";
  return "";
};

const getStatusFromTypeHistory = (records = []) => {
  if (!records.length) return "未打卡";
  const latest = [...records].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  return getNextStatus(latest?.type);
};

const buildLineScheduleMessage = (storeName, scheduleList, dateKey) => {
  const title = `📢 ${dateKey} ${storeName} 班表通知`;

  if (!scheduleList.length) {
    return `${title}
今日未安排上班人員`;
  }

  return [
    title,
    ...scheduleList.map((item) => `• ${item.name} ${item.startTime} - ${item.endTime || "未填"}`),
  ].join("\n");
};

const getScheduleWorkStore = (item) => {
  const homeStore = item.store || "未填店名";
  return item.isSupport && item.supportStore
    ? item.supportStore
    : homeStore;
};

const isScheduleVisibleForStore = (item, storeName) => {
  if (storeName === "全部") return true;

  const homeStore = item.store || "未填店名";
  const workStore = getScheduleWorkStore(item);

  // 支援班次要同時出現在員工的所屬店與實際上班店，避免被誤認為休假。
  return homeStore === storeName || workStore === storeName;
};


const getTaipeiTimestampFromDateTime = (dateKey, timeValue) => {
  if (!dateKey || !timeValue) return 0;
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const [hour, minute] = String(timeValue).split(":").map(Number);

  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    return 0;
  }

  // 台灣全年 UTC+8，這裡直接換算成 UTC 時間戳，避免手機/瀏覽器時區誤差。
  return Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0);
};

const safeFirebaseKey = (value) => {
  return String(value || "")
    .replace(/[.#$\[\]/]/g, "_")
    .replace(/\s+/g, "_");
};


export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [scoreToast, setScoreToast] = useState(null);
  const [mealModalData, setMealModalData] = useState(null);
  const [mealAmount, setMealAmount] = useState("");
  const [mealSaving, setMealSaving] = useState(false);
  const [dailyAnnouncement, setDailyAnnouncement] = useState(null);
  const [announcementModalData, setAnnouncementModalData] = useState(null);
  const [announcementDate, setAnnouncementDate] = useState(formatTaipeiDateKey());
  const [announcementContent, setAnnouncementContent] = useState("");
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [missedPunchModal, setMissedPunchModal] = useState(null);
  const [missedPunchTime, setMissedPunchTime] = useState("");
  const [missedPunchReason, setMissedPunchReason] = useState("");
  const [missedPunchSaving, setMissedPunchSaving] = useState(false);
  const [lateCheckInModal, setLateCheckInModal] = useState(null);
  const [longBreakModal, setLongBreakModal] = useState(null);
  const [longBreakReason, setLongBreakReason] = useState("");
  const [breakReminderModal, setBreakReminderModal] = useState(null);
  const [missedPunchRequests, setMissedPunchRequests] = useState([]);
  const [exceptionRecordsLoading, setExceptionRecordsLoading] = useState(false);
  const [exceptionRecordsError, setExceptionRecordsError] = useState("");

  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [showLoginModal, setShowLoginModal] = useState(false);

  const [newEmpId, setNewEmpId] = useState("");
  const [newName, setNewName] = useState("");
  const [store, setStore] = useState("");
  const [role, setRole] = useState("正職");
  const [showAddModal, setShowAddModal] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [editName, setEditName] = useState("");
  const [editStore, setEditStore] = useState("");
  const [editRole, setEditRole] = useState("正職");

  const [showRecordEditModal, setShowRecordEditModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editRecordType, setEditRecordType] = useState("上班");
  const [editRecordTime, setEditRecordTime] = useState("");

  const [authorizedDevices, setAuthorizedDevices] = useState({});
  const [bindStore, setBindStore] = useState("西螺文昌店");
  const [nowTime, setNowTime] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(getMonthValue());
  const [recordSearch, setRecordSearch] = useState("");
  const [expandedRecordMonths, setExpandedRecordMonths] = useState({});

  const myDevice = getDeviceId();
  const isAuthorizedDevice = useMemo(() => {
    return Object.values(authorizedDevices || {}).some((item) => item?.id === myDevice);
  }, [authorizedDevices, myDevice]);

  const currentDeviceStoreName = useMemo(() => {
    const matched = Object.entries(authorizedDevices || {}).find(([, item]) => item?.id === myDevice);
    return matched?.[0] || "";
  }, [authorizedDevices, myDevice]);

  const [scheduleItems, setScheduleItems] = useState({});
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSent, setScheduleSent] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(getTomorrowTaipeiDateKey());
  const [publishStore, setPublishStore] = useState("西螺文昌店");
  const [adminStoreTab, setAdminStoreTab] = useState("全部");
  const [scheduleHistory, setScheduleHistory] = useState({});
  const [adminPanels, setAdminPanels] = useState({
    scheduleHistory: false,
    exceptionRecords: false,
  });

  const urlParams = new URLSearchParams(window.location.search);
  const [publicViewMode, setPublicViewMode] = useState(
    urlParams.get("view") === "schedule" ? "schedule" : "checkin"
  );
  const [publicScheduleDate, setPublicScheduleDate] = useState(
    urlParams.get("date") || getTomorrowTaipeiDateKey()
  );
  const [publicScheduleStore, setPublicScheduleStore] = useState(
    urlParams.get("store") || "全部"
  );
  const [publicEmployeeKeyword, setPublicEmployeeKeyword] = useState("");
  const [publicScheduleData, setPublicScheduleData] = useState({});
  const [todayScheduleData, setTodayScheduleData] = useState({});
  const [scheduleLinkCopied, setScheduleLinkCopied] = useState(false);

  const loadMissedPunchRequests = async () => {
    if (!isAdmin) return;
    setExceptionRecordsLoading(true);
    setExceptionRecordsError("");
    try {
      await ensurePointsFirebaseAuth();
      const storeEntries = await Promise.all(POINTS_STORE_IDS.map(async (storeId) => {
        const logSnap = await getDocs(fsCollection(pointsDb, "stores", storeId, "logs"));
        return logSnap.docs
          .map((item) => ({ id: item.id, storeId, ...(item.data() || {}) }))
          .filter((item) => item.actionType === "missed_clock_request");
      }));
      const entries = storeEntries.flat().sort((a, b) => {
        const aTime = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : Date.parse(a.requestDateTime || a.requestDate || "") || 0;
        const bTime = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : Date.parse(b.requestDateTime || b.requestDate || "") || 0;
        return bTime - aTime;
      });
      setMissedPunchRequests(entries);
    } catch (error) {
      console.error("讀取忘打卡申請失敗：", error);
      setExceptionRecordsError(error.message || "讀取忘打卡申請失敗");
    } finally {
      setExceptionRecordsLoading(false);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setAuthError("");
        setAuthReady(true);
        return;
      }

      try {
        setAuthError("");
        await signInAnonymously(auth);
      } catch (error) {
        console.error("匿名登入失敗：", error);

        const code = error?.code || "未知錯誤";
        const message = error?.message || "請檢查 Firebase Authentication 與專案設定";

        setAuthError(`${code}｜${message}`);
        setAuthReady(false);

        alert(
          `匿名登入失敗
錯誤代碼：${code}
${message}

請先確認：
1. Firebase Authentication 已啟用 Anonymous
2. firebase.js 連到正確專案
3. 網路正常後重新整理`
        );
      }
    });

    return unsub;
  }, []);

  useEffect(() => {
    if (!authReady) return;

    const employeesRef = ref(db, "employees");
    return onValue(employeesRef, (snap) => {
      const data = snap.val() || {};
      const list = Object.keys(data)
        .map((key) => ({
          id: key,
          ...data[key],
        }))
        .filter((emp) => !emp.archived);

      list.sort((a, b) => (a.empId || a.id).localeCompare(b.empId || b.id));
      setEmployees(list);
    });
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;

    const recordsRef = query(ref(db, "records"), orderByChild("createdAt"), limitToLast(500));
    return onValue(recordsRef, (snap) => {
      const data = snap.val() || {};
      const list = Object.keys(data).map((key) => ({
        id: key,
        ...data[key],
      }));
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setRecords(list);
    });
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;

    const configRef = ref(db, "config/device");
    return onValue(configRef, (snap) => {
      const data = snap.val() || {};

      // 新版：config/device/devices 可綁定多台設備。
      // 舊版：config/device/id 只有單台設備，這裡保留相容，避免更新後原本設備失效。
      const nextDevices = data.devices || {};
      if (data.id && !Object.values(nextDevices).some((item) => item?.id === data.id)) {
        nextDevices["原本已綁定設備"] = {
          id: data.id,
          boundAt: data.boundAt || 0,
        };
      }

      setAuthorizedDevices(nextDevices);
    });
  }, [authReady]);

  useEffect(() => {
    const updateTaipeiTime = () => {
      setNowTime(formatTaipeiNow());
    };
    updateTaipeiTime();
    const timer = setInterval(updateTaipeiTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const todayKey = useMemo(() => formatTaipeiDateKey(), [nowTime]);

  useEffect(() => {
    if (!authReady || !todayKey) return;
    const schedRef = ref(db, `schedules/${todayKey}`);
    return onValue(schedRef, (snap) => {
      setTodayScheduleData(snap.val() || {});
    });
  }, [authReady, todayKey]);

  useEffect(() => {
    if (!authReady || !todayKey) return;
    const announcementRef = ref(db, `announcements/${todayKey}`);
    return onValue(announcementRef, (snap) => {
      const data = snap.val() || null;
      setDailyAnnouncement(data?.content ? data : null);
    });
  }, [authReady, todayKey]);

  useEffect(() => {
    if (!authReady || !isAdmin || !announcementDate) return;
    const announcementRef = ref(db, `announcements/${announcementDate}`);
    return onValue(announcementRef, (snap) => {
      const data = snap.val() || {};
      setAnnouncementContent(data.content || "");
    });
  }, [authReady, isAdmin, announcementDate]);

  useEffect(() => {
    if (!isAdmin || !adminPanels.exceptionRecords) return;
    loadMissedPunchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, adminPanels.exceptionRecords]);

  const storeGroups = useMemo(() => {
    const groups = {};
    employees.forEach((emp) => {
      const store = emp.store || "未填店名";
      if (!groups[store]) groups[store] = [];
      groups[store].push(emp);
    });
    return groups;
  }, [employees]);

  useEffect(() => {
    if (!isAdmin) return;
    setScheduleItems((prev) => {
      const next = { ...prev };
      employees.forEach((emp) => {
        const key = emp.empId || emp.id;
        if (!next[key]) {
          next[key] = { working: false, startTime: getDefaultScheduleStartTime(emp.store, scheduleDate), endTime: "14:00", isSupport: false, supportStore: "" };
        }
      });
      return next;
    });
  }, [employees, isAdmin, scheduleDate]);

  useEffect(() => {
    if (!authReady || !isAdmin) return;
    const targetDate = scheduleDate || formatTaipeiDateKey();
    const schedRef = ref(db, `schedules/${targetDate}`);
    return onValue(schedRef, (snap) => {
      const data = snap.val() || {};
      setScheduleItems(() => {
        const next = {};
        employees.forEach((emp) => {
          const key = emp.empId || emp.id;
          next[key] = { working: false, startTime: getDefaultScheduleStartTime(emp.store, targetDate), endTime: "14:00", isSupport: false, supportStore: "" };
        });
        Object.entries(data).forEach(([empId, schedData]) => {
          const employee = employees.find((emp) => (emp.empId || emp.id) === empId);
          next[empId] = {
            working: schedData.working || false,
            startTime: schedData.startTime || getDefaultScheduleStartTime(schedData.store || employee?.store, targetDate),
            endTime: schedData.endTime || "14:00",
            isSupport: !!schedData.isSupport,
            supportStore: schedData.supportStore || "",
          };
        });
        return next;
      });
    });
  }, [authReady, isAdmin, scheduleDate, employees]);

  useEffect(() => {
    if (!authReady || !isAdmin) return;
    const historyRef = ref(db, "schedules");
    return onValue(historyRef, (snap) => {
      setScheduleHistory(snap.val() || {});
    });
  }, [authReady, isAdmin]);

  useEffect(() => {
    if (!authReady) return;
    const schedRef = ref(db, `schedules/${publicScheduleDate || formatTaipeiDateKey()}`);
    return onValue(schedRef, (snap) => {
      setPublicScheduleData(snap.val() || {});
    });
  }, [authReady, publicScheduleDate]);

  const todayRecords = useMemo(() => {
    return records.filter((r) => {
      if (r.dateKey) return r.dateKey === todayKey;
      const fallbackKey = r.createdAt ? formatTaipeiDateKey(r.createdAt) : "";
      return fallbackKey === todayKey;
    });
  }, [records, todayKey]);

  const liveStatusList = useMemo(() => {
    const map = {};

    employees.forEach((emp) => {
      const key = emp.empId || emp.id;
      map[key] = {
        empId: key,
        name: emp.name,
        store: emp.store || "",
        role: emp.role || "",
        status: "未打卡",
        lastTime: 0,
        hasTodayActivity: emp.lastActionAt
          ? formatTaipeiDateKey(emp.lastActionAt) === todayKey
          : false,
      };
    });

    todayRecords.forEach((record) => {
      const key = record.empId || "";
      if (!key) return;
      const nextStatus = getNextStatus(record.type);
      if (!map[key]) {
        map[key] = {
          empId: key,
          name: record.name || key,
          store: record.store || "",
          role: record.role || "",
          status: nextStatus,
          lastTime: record.createdAt || 0,
          hasTodayActivity: true,
        };
      }
      if ((record.createdAt || 0) >= (map[key].lastTime || 0)) {
        map[key] = {
          ...map[key],
          name: record.name || map[key].name,
          store: record.store || map[key].store,
          role: record.role || map[key].role,
          status: nextStatus,
          lastTime: record.createdAt || 0,
          hasTodayActivity: true,
        };
      }
    });

    return Object.values(map).filter((emp) => emp.hasTodayActivity).sort((a, b) => {
      const statusOrder = { "上班中": 0, "休息中": 1, "已下班": 2, "未打卡": 3 };
      const orderA = statusOrder[a.status] ?? 9;
      const orderB = statusOrder[b.status] ?? 9;
      if (orderA !== orderB) return orderA - orderB;
      return (a.empId || "").localeCompare(b.empId || "");
    });
  }, [employees, todayRecords, todayKey]);

  const toggleScheduleWorking = (empId) => {
    setScheduleItems((prev) => ({
      ...prev,
      [empId]: { ...prev[empId], working: !prev[empId]?.working },
    }));
  };

  const setScheduleTime = (empId, time) => {
    setScheduleItems((prev) => ({
      ...prev,
      [empId]: { ...prev[empId], startTime: time },
    }));
  };

  const setScheduleEndTime = (empId, time) => {
    setScheduleItems((prev) => ({
      ...prev,
      [empId]: { ...prev[empId], endTime: time },
    }));
  };

  const getOtherStoreName = (homeStore) => {
    return homeStore === "西螺文昌店" ? "斗南站前店" : "西螺文昌店";
  };

  const toggleScheduleSupport = (empId, homeStore) => {
    const supportStore = getOtherStoreName(homeStore);
    setScheduleItems((prev) => {
      const current = prev[empId] || {};
      const nextIsSupport = !current.isSupport;
      return {
        ...prev,
        [empId]: {
          ...current,
          isSupport: nextIsSupport,
          supportStore: nextIsSupport ? supportStore : "",
        },
      };
    });
  };


  const getScheduleShareUrl = (targetDate = scheduleDate, storeName = publishStore) => {
    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    params.set("view", "schedule");
    params.set("date", targetDate || formatTaipeiDateKey());
    if (storeName && storeName !== "全部") params.set("store", storeName);
    return `${baseUrl}?${params.toString()}`;
  };

  const copyTextToClipboard = async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      return true;
    } catch (error) {
      console.error("copy failed", error);
      return false;
    }
  };

  const copyScheduleLink = async () => {
    const url = getScheduleShareUrl(scheduleDate, publishStore);
    const ok = await copyTextToClipboard(`📅 ${scheduleDate} ${publishStore} 班表
${url}`);
    if (ok) {
      setScheduleLinkCopied(true);
      setTimeout(() => setScheduleLinkCopied(false), 2500);
      alert("班表連結已複製，可直接貼到 LINE 群組");
    } else {
      alert(`複製失敗，請手動複製：
${url}`);
    }
  };

  const saveAndSendSchedule = async () => {
    setScheduleSaving(true);
    try {
      const targetDate = scheduleDate || formatTaipeiDateKey();
      const finalSchedule = {};

      employees.forEach((emp) => {
        const key = emp.empId || emp.id;
        const item = scheduleItems[key];
        if (item?.working) {
          finalSchedule[key] = {
            empId: key,
            name: emp.name,
            store: emp.store || "",
            startTime: item.startTime || getDefaultScheduleStartTime(emp.store, targetDate),
            endTime: item.endTime || "14:00",
            working: true,
            isSupport: !!item.supportStore,
            supportStore: item.supportStore || "",
          };
        }
      });

      await set(
        ref(db, `schedules/${targetDate}`),
        Object.keys(finalSchedule).length > 0 ? finalSchedule : null
      );

      const scheduleList = Object.values(finalSchedule).sort((a, b) =>
        String(a.startTime || "").localeCompare(String(b.startTime || ""))
      );

      const targetStoreName = publishStore;
      const targetScheduleList = scheduleList.filter(
        (item) => isScheduleVisibleForStore(item, targetStoreName)
      );
      const shareUrl = getScheduleShareUrl(targetDate, targetStoreName);

      await set(ref(db, `schedule_notify/${targetDate}`), {
        pending: false,
        savedAt: Date.now(),
        source: "saveScheduleOnly",
        mode: "web_link_only",
        targetStore: targetStoreName,
        shareUrl,
        count: targetScheduleList.length,
      });

      setScheduleSent(true);
      setTimeout(() => setScheduleSent(false), 4000);

      if (!targetScheduleList.length) {
        alert("班表發送成功");
        return;
      }

      alert("班表發送成功");
    } catch (err) {
      alert(`班表儲存失敗：${err.message}`);
    } finally {
      setScheduleSaving(false);
    }
  };

  const login = () => {
    if (password === ADMIN_PASSWORD) {
      setIsAdmin(true);
      setPassword("");
      setShowLoginModal(false);
    } else {
      alert("密碼錯誤");
    }
  };

  const logout = () => {
    setIsAdmin(false);
    setPassword("");
  };

  const addEmployee = async () => {
    const empId = newEmpId.trim().toUpperCase();
    const name = newName.trim();
    const storeName = store.trim();

    if (!empId || !name || !storeName) {
      alert("請填寫完整資料");
      return;
    }

    const exists = employees.some((e) => e.id === empId);
    if (exists) {
      alert("此工號已存在");
      return;
    }

    await set(ref(db, `employees/${empId}`), {
      empId,
      name,
      store: storeName,
      role,
      status: "未打卡",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
    });

    setNewEmpId("");
    setNewName("");
    setStore("");
    setRole("正職");
    setShowAddModal(false);
    alert("員工新增成功");
  };

  const openEdit = (emp) => {
    setEditingEmp(emp);
    setEditName(emp.name || "");
    setEditStore(emp.store || "");
    setEditRole(emp.role || "正職");
    setShowEditModal(true);
  };

  const updateEmployee = async () => {
    if (!editingEmp) return;

    const name = editName.trim();
    const storeName = editStore.trim();

    if (!name || !storeName) {
      alert("姓名與店名不可空白");
      return;
    }

    await update(ref(db, `employees/${editingEmp.id}`), {
      name,
      store: storeName,
      role: editRole,
      updatedAt: Date.now(),
    });

    setShowEditModal(false);
    setEditingEmp(null);
    alert("員工資料已更新");
  };

  const deleteEmployee = async (emp) => {
    if (!window.confirm(`確定停用 ${emp.name} 嗎？`)) return;

    await update(ref(db, `employees/${emp.id}`), {
      archived: true,
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });

    alert("員工已停用");
  };

  const recalcEmployeeStatus = async (empId) => {
    const employee = employees.find((e) => (e.empId || e.id) === empId);
    if (!employee) return;

    const targetRecords = records.filter((r) => (r.empId || "") === empId);
    const nextStatus = getStatusFromTypeHistory(targetRecords);

    await update(ref(db, `employees/${employee.id}`), {
      status: nextStatus,
      lastAction: targetRecords[0]?.type || "",
      lastActionAt: targetRecords[0]?.createdAt || 0,
      updatedAt: Date.now(),
    });
  };


  const getCheckInAudioContext = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!window.__checkInAudioContext) {
      window.__checkInAudioContext = new AudioContextClass();
    }
    return window.__checkInAudioContext;
  };

  const playFallbackTone = () => {
    try {
      const audioContext = getCheckInAudioContext();
      if (!audioContext) return;
      audioContext.resume?.();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      gain.gain.setValueAtTime(0.18, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.25);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.25);
    } catch (error) {
      console.error("提示音播放失敗:", error);
    }
  };

  const unlockMobileAudio = (testVoice = false) => {
    try {
      const audioContext = getCheckInAudioContext();
      audioContext?.resume?.();

      if (!window.speechSynthesis) {
        playFallbackTone();
        return;
      }
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      const unlockMessage = new SpeechSynthesisUtterance(testVoice ? "打卡語音已啟用" : " ");
      unlockMessage.lang = "zh-TW";
      unlockMessage.volume = testVoice ? 1 : 0;
      window.speechSynthesis.speak(unlockMessage);
      if (testVoice) {
        unlockMessage.onerror = playFallbackTone;
      }
    } catch (error) {
      console.error("行動裝置音訊解鎖失敗:", error);
      playFallbackTone();
    }
  };

  const speakText = (text) => {
    try {
      if (!text) return;
      if (!window.speechSynthesis) {
        playFallbackTone();
        return;
      }

      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();

      const msg = new SpeechSynthesisUtterance(text);
      msg.lang = "zh-TW";
      msg.rate = 1;
      msg.pitch = 1;
      msg.volume = 1;
      let started = false;
      msg.onstart = () => {
        started = true;
      };
      msg.onerror = () => {
        playFallbackTone();
      };

      window.speechSynthesis.speak(msg);
      window.setTimeout(() => {
        if (!started && !window.speechSynthesis.speaking) {
          playFallbackTone();
        }
      }, 1200);
    } catch (error) {
      console.error("語音播放失敗:", error);
      playFallbackTone();
    }
  };

  useEffect(() => {
    if (!authReady || isAdmin || breakReminderModal || missedPunchModal || lateCheckInModal || longBreakModal) return;

    const restingEmployees = employees.filter((emp) => emp.status === "休息中");
    for (const emp of restingEmployees) {
      const empId = emp.empId || emp.id;
      const breakStartRecord = todayRecords.find((record) =>
        record.empId === empId && record.type === "休息開始"
      );
      if (!breakStartRecord?.createdAt) continue;

      const elapsedMinutes = Math.floor((Date.now() - breakStartRecord.createdAt) / 60000);
      const reminderStage = elapsedMinutes >= LONG_BREAK_MINUTES
        ? LONG_BREAK_MINUTES
        : elapsedMinutes >= 25
          ? 25
          : 0;
      if (!reminderStage) continue;

      const reminderKey = `break_reminder_${todayKey}_${safeFirebaseKey(empId)}_${breakStartRecord.createdAt}_${reminderStage}`;
      if (localStorage.getItem(reminderKey)) continue;

      localStorage.setItem(reminderKey, String(Date.now()));
      setBreakReminderModal({
        name: emp.name,
        empId,
        elapsedMinutes,
        stage: reminderStage,
      });
      speakText(reminderStage === 25
        ? `${emp.name}休息剩下五分鐘，請記得準時回來打卡`
        : `${emp.name}休息時間已到，請打休息結束卡`);
      break;
    }
  }, [authReady, isAdmin, nowTime, employees, todayRecords, todayKey, breakReminderModal, missedPunchModal, lateCheckInModal, longBreakModal]);

  useEffect(() => {
    if (!breakReminderModal) return;
    const remindedEmployee = employees.find((emp) =>
      normalizeEmpId(emp.empId || emp.id) === normalizeEmpId(breakReminderModal.empId)
    );
    if (!remindedEmployee || remindedEmployee.status !== "休息中") {
      setBreakReminderModal(null);
    }
  }, [breakReminderModal, employees]);

  const getCheckInLateMinutes = async (emp, createdAt) => {
    try {
      if (!emp || !createdAt) return 0;

      const dateKey = formatTaipeiDateKey(createdAt);
      const empKey = emp.empId || emp.id;
      const scheduleSnap = await get(ref(db, `schedules/${dateKey}/${empKey}`));
      const schedule = scheduleSnap.val();

      if (!schedule?.working || !schedule?.startTime) return 0;

      const startTs = getTaipeiTimestampFromDateTime(dateKey, schedule.startTime);
      if (!startTs) return 0;

      return Math.max(0, Math.floor((createdAt - startTs) / 60000));
    } catch (error) {
      console.error("計算遲到分鐘失敗:", error);
      return 0;
    }
  };

  const showScoreToast = (payload) => {
    setScoreToast(payload);
    setTimeout(() => setScoreToast(null), 7000);
  };

  const closeScoreToast = () => {
    setScoreToast(null);
  };

  const saveCheckoutMeal = async (amountValue = mealAmount) => {
    if (!mealModalData || mealSaving) return;

    const rawAmount = String(amountValue ?? "").trim();
    const amount = rawAmount === "" ? 0 : Number(rawAmount);

    if (Number.isNaN(amount) || amount < 0) {
      alert("請輸入正確的員工餐金額");
      return;
    }

    setMealSaving(true);

    try {
      const nowTs = Date.now();

      const mealKey = `${mealModalData.dateKey}_${mealModalData.empId}`;
      const monthKey = getMonthKeyFromDateKey(mealModalData.dateKey);

      const todayEmpRecords = records
        .filter((record) => {
          const recordDateKey = record?.dateKey || (record?.createdAt ? formatTaipeiDateKey(record.createdAt) : "");
          return String(record?.empId || "").trim().toUpperCase() === String(mealModalData.empId || "").trim().toUpperCase()
            && recordDateKey === mealModalData.dateKey;
        })
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

      const workInRecord = todayEmpRecords.find((record) => record.type === "上班");
      const breakStartRecord = todayEmpRecords.find((record) => record.type === "休息開始");
      const breakEndRecord = todayEmpRecords.find((record) => record.type === "休息結束");
      const breakMinutes = breakStartRecord?.createdAt && breakEndRecord?.createdAt
        ? Math.max(0, Math.round((breakEndRecord.createdAt - breakStartRecord.createdAt) / 60000))
        : 0;
      const workMinutes = workInRecord?.createdAt
        ? Math.max(0, Math.round((mealModalData.checkoutAt - workInRecord.createdAt) / 60000) - breakMinutes)
        : 0;
      const workHours = Number((workMinutes / 60).toFixed(2));
      const breakHours = Number((breakMinutes / 60).toFixed(2));
      const subsidyAmount = workHours >= 6 ? 100 : workHours >= 4 ? 60 : 0;
      const overAmount = Math.max(0, amount - subsidyAmount);
      const employeePay = Math.round(overAmount * 0.9);

      await set(ref(db, `meal_records/${mealKey}`), {
        empId: mealModalData.empId,
        name: mealModalData.name,
        store: mealModalData.store,
        role: mealModalData.role,
        dateKey: mealModalData.dateKey,
        monthKey,
        workInAt: workInRecord?.createdAt || 0,
        workOutAt: mealModalData.checkoutAt,
        workHours,
        breakHours,
        mealAmount: amount,
        subsidyAmount,
        overAmount,
        discountRate: 0.9,
        employeePay,
        checkoutAt: mealModalData.checkoutAt,
        createdAt: nowTs,
        updatedAt: nowTs,
        source: "checkout",
        rule: "未滿4小時0元；滿4小時未滿6小時60元；滿6小時以上100元；超出補貼部分打9折",
      });

      const finishedMealData = { ...mealModalData };
      setMealModalData(null);
      setMealAmount("");

      if (dailyAnnouncement?.content) {
        setAnnouncementModalData({
          empId: finishedMealData.empId,
          name: finishedMealData.name,
          dateKey: finishedMealData.dateKey,
          content: dailyAnnouncement.content,
          title: dailyAnnouncement.title || "今日公告",
        });
      } else {
        try {
          const automaticAnnouncement = await fetchYesterdayPointsAnnouncement();
          if (automaticAnnouncement) {
            setAnnouncementModalData({
              empId: finishedMealData.empId,
              name: finishedMealData.name,
              dateKey: finishedMealData.dateKey,
              ...automaticAnnouncement,
            });
          } else {
            alert(amount > 0 ? `員工餐已記錄：${amount} 元` : "已記錄今日沒有吃員工餐");
          }
        } catch (announcementError) {
          console.error("讀取昨日加扣分公告失敗：", announcementError);
          alert(amount > 0 ? `員工餐已記錄：${amount} 元` : "已記錄今日沒有吃員工餐");
        }
      }
    } catch (error) {
      console.error("員工餐記錄失敗：", error);
      alert(`員工餐記錄失敗：${error.message || "請稍後再試"}`);
    } finally {
      setMealSaving(false);
    }
  };

  const skipCheckoutMeal = () => {
    saveCheckoutMeal(0);
  };

  const closeMealModalWithoutSaving = () => {
    if (mealSaving) return;
    setMealModalData(null);
    setMealAmount("");
  };

  const saveDailyAnnouncement = async () => {
    const content = announcementContent.trim();
    if (!announcementDate) {
      alert("請先選擇公告日期");
      return;
    }

    setAnnouncementSaving(true);
    try {
      if (!content) {
        await remove(ref(db, `announcements/${announcementDate}`));
        alert(`${announcementDate} 公告已清除`);
        return;
      }

      await set(ref(db, `announcements/${announcementDate}`), {
        title: "今日公告",
        content,
        dateKey: announcementDate,
        updatedAt: Date.now(),
      });
      alert(`${announcementDate} 公告已儲存`);
    } catch (error) {
      console.error("儲存公告失敗：", error);
      alert(`儲存公告失敗：${error.message || "請稍後再試"}`);
    } finally {
      setAnnouncementSaving(false);
    }
  };

  const acknowledgeAnnouncement = async () => {
    if (!announcementModalData) return;
    try {
      const empKey = safeFirebaseKey(announcementModalData.empId);
      await set(ref(db, `announcement_reads/${announcementModalData.dateKey}/${empKey}`), {
        empId: announcementModalData.empId,
        name: announcementModalData.name,
        dateKey: announcementModalData.dateKey,
        readAt: Date.now(),
      });
    } catch (error) {
      console.error("公告閱讀紀錄儲存失敗：", error);
    } finally {
      setAnnouncementModalData(null);
    }
  };

  const openMissedPunchRequest = (emp, missingType, targetType) => {
    const empId = emp.empId || emp.id;
    const scheduledStart = todayScheduleData?.[empId]?.startTime || getDefaultScheduleStartTime(emp.store, todayKey);
    const defaultTime = missingType === "上班"
      ? `${todayKey}T${scheduledStart}`
      : formatDateTimeLocalValue(Date.now());
    setMissedPunchModal({ emp, missingType, targetType });
    setMissedPunchTime(defaultTime);
    setMissedPunchReason("");
  };

  const checkIn = async (type, options = {}) => {
    // 手機與平板要求音訊必須在使用者點擊當下解鎖，不能等 Firebase 查詢完成後才啟動。
    unlockMobileAudio();

    if (!isAuthorizedDevice) {
      alert("此設備未授權");
      return;
    }

    const inputId = employeeId.trim().toUpperCase();
    const emp = options.emp || employees.find((e) => e.id === inputId || e.empId === inputId);

    if (!emp) {
      alert("找不到工號");
      return;
    }

    if (!options.allowMissingTransition && !isValidTransition(emp.status, type)) {
      const missingType = getMissingPunchType(emp.status, type);
      if (missingType) {
        openMissedPunchRequest(emp, missingType, type);
        return;
      }
      alert(`目前狀態為「${emp.status || "未打卡"}」，不能執行「${type}」`);
      return;
    }

    if (type === "上班" && !options.skipLateConfirmation) {
      const lateMinutes = await getCheckInLateMinutes(emp, Date.now());
      if (lateMinutes > LATE_CONFIRM_MINUTES) {
        setLateCheckInModal({ emp, lateMinutes });
        return;
      }
    }

    if (type === "休息結束" && !options.skipLongBreakConfirmation) {
      const empId = emp.empId || emp.id;
      const breakStartRecord = todayRecords.find((record) =>
        record.empId === empId && record.type === "休息開始"
      );
      if (breakStartRecord?.createdAt) {
        const breakMinutes = Math.floor((Date.now() - breakStartRecord.createdAt) / 60000);
        if (breakMinutes > LONG_BREAK_MINUTES) {
          setLongBreakModal({ emp, breakMinutes });
          setLongBreakReason("");
          return;
        }
      }
    }

    const lastRecord = records.find(
      (r) => (r.empId === (emp.empId || emp.id))
    );

    if (
      lastRecord &&
      Date.now() - (lastRecord.createdAt || 0) < CHECKIN_COOLDOWN &&
      lastRecord.type === type
    ) {
      alert("請勿重複打卡");
      return;
    }

    const now = new Date();
    const createdAt = Date.now();
    const newStatus = getNextStatus(type);
    const recordId = String(createdAt);
    const dateKey = formatTaipeiDateKey(createdAt);
    const scheduleSnap = await get(ref(db, `schedules/${dateKey}/${emp.empId || emp.id}`));
    const todaySchedule = scheduleSnap.val() || {};

    await set(ref(db, `records/${recordId}`), {
      empId: emp.empId || emp.id,
      name: emp.name,
      store: emp.store || "",
      role: emp.role || "",
      type,
      time: now.toLocaleTimeString("zh-TW", { hour12: false }),
      date: now.toLocaleDateString("zh-TW"),
      dateKey,
      device: myDevice,
      isSupport: !!todaySchedule.isSupport,
      supportStore: todaySchedule.supportStore || "",
      exceptionReason: options.longBreakReason || "",
      longBreakMinutes: options.longBreakMinutes || 0,
      createdAt,
      monthKey: getMonthValue(createdAt),
    });

    await update(ref(db, `employees/${emp.id}`), {
      status: newStatus,
      lastAction: type,
      lastActionAt: createdAt,
      updatedAt: createdAt,
    });

    setEmployeeId("");

    if (type === "下班") {
      setMealModalData({
        empId: emp.empId || emp.id,
        name: emp.name,
        store: emp.store || "",
        role: emp.role || "",
        dateKey: formatTaipeiDateKey(createdAt),
        checkoutAt: createdAt,
      });
      setMealAmount("");
    }

    // 改為由自動排程統一檢查遲到，避免重複 LINE 通知

    try {
      const pointsResult = await fetchMonthlyPointsFromPerformanceSystem(emp.empId || emp.id);
      const lateMinutes = type === "上班" ? await getCheckInLateMinutes(emp, createdAt) : 0;
      const monthlyPointsText = pointsResult?.found ? pointsResult.monthlyPoints : "未知";

      showScoreToast({
        success: true,
        name: emp.name,
        type,
        pointsResult,
        createdAt,
      });

      if (lateMinutes > 0) {
        speakText(`你遲到了，遲到${lateMinutes}分鐘，本月積分${monthlyPointsText}分`);
      } else {
        speakText(`${type}打卡完成，本月積分${monthlyPointsText}分`);
      }
    } catch (error) {
      console.error("讀取本月積分失敗:", error);
      showScoreToast({
        success: true,
        name: emp.name,
        type,
        pointsResult: {
          found: false,
          message: "積分讀取失敗，但打卡已成功",
          error: true,
        },
        createdAt,
      });

      speakText(`${type}打卡完成，積分讀取失敗`);
    }
  };

  const confirmLongBreak = async () => {
    if (!longBreakModal) return;
    const reason = longBreakReason.trim();
    if (!reason) {
      alert("休息超過 30 分鐘，請填寫原因");
      return;
    }
    const { emp, breakMinutes } = longBreakModal;
    setLongBreakModal(null);
    setLongBreakReason("");
    await checkIn("休息結束", {
      emp,
      skipLongBreakConfirmation: true,
      longBreakReason: reason,
      longBreakMinutes: breakMinutes,
    });
  };

  const submitMissedPunchRequest = async () => {
    if (!missedPunchModal || missedPunchSaving) return;
    const requestedAt = datetimeLocalToTimestamp(missedPunchTime);
    const reason = missedPunchReason.trim();
    if (!requestedAt) {
      alert("請選擇忘打卡的時間");
      return;
    }
    if (!reason) {
      alert("請填寫忘打卡原因");
      return;
    }

    setMissedPunchSaving(true);
    try {
      const { emp, missingType, targetType } = missedPunchModal;
      const empId = emp.empId || emp.id;
      await ensurePointsFirebaseAuth();

      let matchedEmployee = null;
      for (const storeId of POINTS_STORE_IDS) {
        const empSnap = await getDocs(fsCollection(pointsDb, "stores", storeId, "employees"));
        const matchedDoc = empSnap.docs.find((empDoc) => {
          const data = empDoc.data() || {};
          const candidates = [
            empDoc.id,
            data.birthdayId,
            data.checkinId,
            data.employeeId,
            data.empId,
            data.id,
            data.birthday,
            data.birthDate,
          ];
          return candidates.some((item) => normalizeEmpId(item) === normalizeEmpId(empId));
        });
        if (matchedDoc) {
          matchedEmployee = { storeId, doc: matchedDoc };
          break;
        }
      }

      if (!matchedEmployee) {
        throw new Error("積分系統找不到此員工，請先確認兩邊的工號設定一致");
      }

      const requestDate = formatTaipeiDateKey(requestedAt);
      const requestTime = missedPunchTime.slice(11, 16);
      const logRef = fsDoc(fsCollection(pointsDb, "stores", matchedEmployee.storeId, "logs"));
      await fsSetDoc(logRef, {
        id: logRef.id,
        actionType: "missed_clock_request",
        amount: 0,
        empId: matchedEmployee.doc.id,
        name: matchedEmployee.doc.data()?.name || emp.name,
        reason: "忘打卡申請",
        note: `${missingType}忘打卡：${reason}`,
        occurrenceDate: requestDate,
        requestDate,
        requestDateTime: `${requestDate}T${requestTime}`,
        requestTime,
        requestStatus: "pending",
        operator: matchedEmployee.doc.data()?.name || emp.name,
        operatorKey: "employee_request",
        operatorStoreId: matchedEmployee.storeId,
        operatorStoreLabel: POINTS_STORE_LABELS[matchedEmployee.storeId] || emp.store || "",
        source: "work_checkin",
        missingType,
        targetType,
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setMissedPunchModal(null);
      setMissedPunchTime("");
      setMissedPunchReason("");
      setLongBreakModal(null);
      setLongBreakReason("");
      await checkIn(targetType, {
        emp,
        allowMissingTransition: true,
        skipLateConfirmation: true,
        skipLongBreakConfirmation: true,
      });
      alert(`${missingType}忘打卡申請已送到積分系統審核，並已完成「${targetType}」打卡`);
    } catch (error) {
      console.error("送出忘打卡申請失敗：", error);
      alert(`送出失敗：${error.message || "請稍後再試"}`);
    } finally {
      setMissedPunchSaving(false);
    }
  };


  const bindDevice = async () => {
    const storeName = bindStore || "西螺文昌店";
    const currentDeviceNames = Object.keys(authorizedDevices || {});
    const isUpdatingExistingSlot = Boolean(authorizedDevices?.[storeName]);

    if (currentDeviceNames.length >= DEVICE_BIND_OPTIONS.length && !isUpdatingExistingSlot) {
      alert(`最多只能綁定 ${DEVICE_BIND_OPTIONS.length} 台設備：${DEVICE_BIND_OPTIONS.join("、")}`);
      return;
    }

    await update(ref(db, "config/device"), {
      [`devices/${storeName}`]: {
        id: myDevice,
        store: storeName,
        boundAt: Date.now(),
      },
      updatedAt: Date.now(),
    });
    alert(`${storeName} 設備已綁定成功`);
  };

  const unbindDevice = async (storeName) => {
    if (!window.confirm(`確定解除 ${storeName} 的設備綁定嗎？`)) return;
    await remove(ref(db, `config/device/devices/${storeName}`));
    alert(`${storeName} 設備已解除綁定`);
  };

  const openRecordEdit = (record) => {
    setEditingRecord(record);
    setEditRecordType(record.type || "上班");
    setEditRecordTime(formatDateTimeLocalValue(record.createdAt));
    setShowRecordEditModal(true);
  };

  const saveRecordEdit = async () => {
    if (!editingRecord) return;

    const nextTimestamp = datetimeLocalToTimestamp(editRecordTime);
    if (!nextTimestamp) {
      alert("請輸入正確的日期與時間");
      return;
    }

    const parsedDate = new Date(nextTimestamp);

    await update(ref(db, `records/${editingRecord.id}`), {
      type: editRecordType,
      createdAt: nextTimestamp,
      time: parsedDate.toLocaleTimeString("zh-TW", { hour12: false }),
      date: parsedDate.toLocaleDateString("zh-TW"),
      dateKey: formatTaipeiDateKey(nextTimestamp),
      monthKey: getMonthValue(nextTimestamp),
      updatedAt: Date.now(),
    });

    await recalcEmployeeStatus(editingRecord.empId);

    setShowRecordEditModal(false);
    setEditingRecord(null);
    alert("打卡紀錄已修改");
  };

  const deleteRecord = async (record) => {
    if (!window.confirm(`確定刪除 ${record.name} 的這筆「${record.type}」紀錄嗎？`)) {
      return;
    }

    await remove(ref(db, `records/${record.id}`));
    await recalcEmployeeStatus(record.empId);
    alert("打卡紀錄已刪除");
  };

  const getAllRecordsForExport = async () => {
    const snap = await get(ref(db, "records"));
    const data = snap.val() || {};
    return Object.keys(data)
      .map((key) => ({
        id: key,
        ...data[key],
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  };

  const downloadCsv = (filename, header, rows) => {
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const downloadExcelHtml = (filename, html) => {
    const excelFile = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:x="urn:schemas-microsoft-com:office:excel"
            xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="UTF-8" />
          <!--[if gte mso 9]>
          <xml>
            <x:ExcelWorkbook>
              <x:ExcelWorksheets>
                <x:ExcelWorksheet>
                  <x:Name>薪資核對</x:Name>
                  <x:WorksheetOptions>
                    <x:FreezePanes />
                    <x:FrozenNoSplit />
                    <x:SplitHorizontal>1</x:SplitHorizontal>
                    <x:SplitVertical>3</x:SplitVertical>
                    <x:TopRowBottomPane>1</x:TopRowBottomPane>
                    <x:LeftColumnRightPane>3</x:LeftColumnRightPane>
                    <x:ActivePane>0</x:ActivePane>
                  </x:WorksheetOptions>
                </x:ExcelWorksheet>
              </x:ExcelWorksheets>
            </x:ExcelWorkbook>
          </xml>
          <![endif]-->
          <style>
            table { border-collapse: collapse; font-family: Arial, 'Microsoft JhengHei', sans-serif; font-size: 11pt; }
            th, td { border: 1px solid #999; padding: 5px 7px; text-align: center; white-space: nowrap; mso-number-format:'\@'; }
            th { background: #d9ead3; font-weight: bold; }
            .name, .role { font-weight: bold; background: #f7f7f7; }
            .item { background: #eef2ff; font-weight: bold; }
            .off { background: #f3f4f6; color: #666; }
            .late { background: #ffffff; color: #8b0000; font-weight: bold; }
            .missing { background: #fce4ec; color: #b91c1c; font-weight: bold; }
            .longBreak { background: #fde68a; color: #92400e; font-weight: bold; }
            .support { background: #dbeafe; color: #1d4ed8; font-weight: bold; }
            .hours { mso-number-format:'0.00'; }
            .total { background: #fff2cc; font-weight: bold; mso-number-format:'0.00'; }
            .gap td { height: 8px; background: #ffffff; border-left: none; border-right: none; }
          </style>
        </head>
        <body>${html}</body>
      </html>`;

    const blob = new Blob(["\uFEFF" + excelFile], {
      type: "application/vnd.ms-excel;charset=utf-8;",
    });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const escapeExcelText = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const formatExcelTime = (timestamp) => {
    if (!timestamp) return "";
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return "";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const getDaysInSelectedMonth = (monthKey) => {
    const [year, month] = String(monthKey || getMonthValue()).split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return Array.from({ length: lastDay }, (_, index) => {
      const day = index + 1;
      return {
        day,
        dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        label: `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`,
      };
    });
  };

  const getAllSchedulesForMonth = async (monthKey) => {
    const snap = await get(ref(db, "schedules"));
    const data = snap.val() || {};
    return Object.fromEntries(
      Object.entries(data).filter(([dateKey]) => String(dateKey || "").startsWith(monthKey))
    );
  };

  const getFirstRecord = (recordsOfDay, type) => {
    return recordsOfDay
      .filter((r) => r.type === type)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0] || null;
  };

  const getLastRecord = (recordsOfDay, type) => {
    return recordsOfDay
      .filter((r) => r.type === type)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
  };

  const minutesBetween = (startTs, endTs) => {
    if (!startTs || !endTs || endTs <= startTs) return 0;
    return Math.round((endTs - startTs) / 60000);
  };

  const buildCell = (value, className = "", title = "") => `<td class="${className}"${title ? ` title="${escapeExcelText(title)}"` : ""}>${escapeExcelText(value)}</td>`;

  const exportAllCSV = async () => {
    try {
      const allRecords = await getAllRecordsForExport();

      if (!allRecords.length) {
        alert("目前沒有紀錄可匯出");
        return;
      }

      const header = ["員工姓名", "工號", "店名", "身分", "類型", "日期", "時間", "設備"];
      const rows = allRecords.map((r) => [
        r.name || "",
        r.empId || "",
        r.store || "",
        r.role || "",
        r.type || "",
        r.date || "",
        r.time || "",
        r.device || "",
      ]);

      downloadCsv("打卡紀錄.csv", header, rows);
    } catch (error) {
      console.error("匯出全部打卡紀錄失敗：", error);
      alert("匯出全部打卡紀錄失敗，請稍後再試");
    }
  };

  const monthRecords = useMemo(() => {
    return records.filter((r) => {
      const key = r.monthKey || getMonthValue(r.createdAt || Date.now());
      return key === selectedMonth;
    });
  }, [records, selectedMonth]);

  const exportMonthlyCSV = async () => {
    try {
      const allRecords = await getAllRecordsForExport();
      const targetMonthRecords = allRecords.filter((r) => {
        const key = r.monthKey || getMonthValue(r.createdAt || Date.now());
        return key === selectedMonth;
      });

      if (!targetMonthRecords.length) {
        alert(`${selectedMonth} 沒有統計資料可匯出`);
        return;
      }

      const schedulesByDate = await getAllSchedulesForMonth(selectedMonth);
      const days = getDaysInSelectedMonth(selectedMonth);
      const employeeMap = {};

      employees.forEach((emp) => {
        const key = emp.empId || emp.id;
        employeeMap[key] = {
          empId: key,
          name: emp.name || "",
          store: emp.store || "",
          role: emp.role || "",
        };
      });

      targetMonthRecords.forEach((r) => {
        const key = r.empId || r.id || "UNKNOWN";
        if (!employeeMap[key]) {
          employeeMap[key] = {
            empId: key,
            name: r.name || key,
            store: r.store || "",
            role: r.role || "",
          };
        }
      });

      const recordsByEmployeeDate = {};
      targetMonthRecords.forEach((r) => {
        const empKey = r.empId || r.id || "UNKNOWN";
        const dateKey = r.dateKey || formatTaipeiDateKey(r.createdAt || Date.now());
        const key = `${empKey}__${dateKey}`;
        if (!recordsByEmployeeDate[key]) recordsByEmployeeDate[key] = [];
        recordsByEmployeeDate[key].push(r);
      });

      const headerHtml = [
        "<tr>",
        "<th>姓名</th><th>身分</th><th>項目</th>",
        ...days.map((d) => `<th>${d.label}</th>`),
        "<th>總工時</th>",
        "</tr>",
      ].join("");

      const employeeList = Object.values(employeeMap).sort((a, b) => {
        if ((a.store || "") !== (b.store || "")) return String(a.store || "").localeCompare(String(b.store || ""), "zh-Hant");
        return String(a.name || a.empId).localeCompare(String(b.name || b.empId), "zh-Hant");
      });

      const bodyRows = [];

      employeeList.forEach((emp) => {
        const rowData = {
          workIn: [],
          breakStart: [],
          breakEnd: [],
          workOut: [],
          hours: [],
        };
        let totalHours = 0;

        days.forEach((day) => {
          const dayRecords = (recordsByEmployeeDate[`${emp.empId}__${day.dateKey}`] || [])
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

          const schedule = schedulesByDate?.[day.dateKey]?.[emp.empId] || null;
          const isSupportDay = !!schedule?.isSupport || dayRecords.some((record) => record?.isSupport);
          const supportClass = isSupportDay ? "support" : "";
          const workIn = getFirstRecord(dayRecords, "上班");
          const breakStart = getFirstRecord(dayRecords, "休息開始");
          const breakEnd = getFirstRecord(dayRecords, "休息結束");
          const workOut = getLastRecord(dayRecords, "下班");
          const hasAnyRecord = dayRecords.length > 0;

          if (!hasAnyRecord) {
            rowData.workIn.push(buildCell("休假", "off"));
            rowData.breakStart.push(buildCell(""));
            rowData.breakEnd.push(buildCell(""));
            rowData.workOut.push(buildCell(""));
            rowData.hours.push(buildCell(""));
            return;
          }

          const breakMinutes = minutesBetween(breakStart?.createdAt, breakEnd?.createdAt);
          const isLongBreak = breakMinutes > 30;
          const isLate = Boolean(
            schedule?.working &&
            schedule?.startTime &&
            workIn?.createdAt &&
            workIn.createdAt > getTaipeiTimestampFromDateTime(day.dateKey, schedule.startTime)
          );
          const missingWorkIn = !workIn;
          const missingWorkOut = !workOut;
          const breakPairMissing = Boolean((breakStart && !breakEnd) || (!breakStart && breakEnd));

          rowData.workIn.push(buildCell(
            missingWorkIn ? "未打卡" : formatExcelTime(workIn.createdAt),
            [missingWorkIn ? "missing" : (isLate ? "late" : ""), supportClass].filter(Boolean).join(" ")
          ));
          rowData.breakStart.push(buildCell(
            breakStart ? formatExcelTime(breakStart.createdAt) : (breakEnd ? "未打卡" : ""),
            [breakEnd && !breakStart ? "missing" : (isLongBreak ? "longBreak" : ""), supportClass].filter(Boolean).join(" ")
          ));
          rowData.breakEnd.push(buildCell(
            breakEnd ? formatExcelTime(breakEnd.createdAt) : (breakStart ? "未打卡" : ""),
            [breakStart && !breakEnd ? "missing" : (isLongBreak ? "longBreak" : ""), supportClass].filter(Boolean).join(" ")
          ));
          rowData.workOut.push(buildCell(
            missingWorkOut ? "未打卡" : formatExcelTime(workOut.createdAt),
            [missingWorkOut ? "missing" : "", supportClass].filter(Boolean).join(" ")
          ));

          if (missingWorkIn || missingWorkOut || breakPairMissing) {
            rowData.hours.push(buildCell("異常", ["missing", supportClass].filter(Boolean).join(" ")));
            return;
          }

          const totalMinutes = minutesBetween(workIn.createdAt, workOut.createdAt) - breakMinutes;
          const hours = Math.max(0, totalMinutes / 60);
          totalHours += hours;
          rowData.hours.push(buildCell(hours.toFixed(2), ["hours", supportClass].filter(Boolean).join(" ")));
        });

        bodyRows.push(`
          <tr>
            <td class="name">${escapeExcelText(emp.name || emp.empId)}</td>
            <td class="role">${escapeExcelText(emp.role || "")}</td>
            <td class="item">上班</td>
            ${rowData.workIn.join("")}
            <td></td>
          </tr>
          <tr>
            <td></td><td></td><td class="item">休息</td>
            ${rowData.breakStart.join("")}
            <td></td>
          </tr>
          <tr>
            <td></td><td></td><td class="item">休息結束</td>
            ${rowData.breakEnd.join("")}
            <td></td>
          </tr>
          <tr>
            <td></td><td></td><td class="item">下班</td>
            ${rowData.workOut.join("")}
            <td></td>
          </tr>
          <tr>
            <td></td><td></td><td class="item">工時</td>
            ${rowData.hours.join("")}
            <td class="total">${totalHours ? totalHours.toFixed(2) : ""}</td>
          </tr>
          <tr class="gap"><td colspan="${days.length + 4}"></td></tr>
        `);
      });

      const html = `<table>${headerHtml}${bodyRows.join("")}</table>`;
      downloadExcelHtml(`薪資核對版-${selectedMonth}.xls`, html);
    } catch (error) {
      console.error("匯出薪資核對版失敗：", error);
      alert("匯出薪資核對版失敗，請稍後再試");
    }
  };

  const toggleAdminPanel = (key) => {
    setAdminPanels((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const historyScheduleDates = useMemo(() => {
    return Object.keys(scheduleHistory || {}).sort((a, b) => b.localeCompare(a));
  }, [scheduleHistory]);

  const publicStoreOptions = useMemo(() => {
    const stores = Object.values(publicScheduleData || {})
      .filter((item) => item?.working)
      .flatMap((item) => [
        item.store || "未填店名",
        item.isSupport && item.supportStore ? item.supportStore : null,
      ])
      .filter(Boolean);
    return ["全部", ...Array.from(new Set(stores))];
  }, [publicScheduleData]);

  const publicScheduleList = useMemo(() => {
    const keyword = publicEmployeeKeyword.trim().toLowerCase();
    return Object.values(publicScheduleData || {})
      .filter((item) => item?.working)
      .filter((item) => isScheduleVisibleForStore(item, publicScheduleStore))
      .filter((item) => {
        if (!keyword) return true;
        return (
          String(item.name || "").toLowerCase().includes(keyword) ||
          String(item.empId || "").toLowerCase().includes(keyword)
        );
      })
      .sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")));
  }, [publicScheduleData, publicScheduleStore, publicEmployeeKeyword]);

  const publicScheduledCount = useMemo(() => {
    if (publicScheduleStore === "全部") return publicScheduleList.length;
    return publicScheduleList.filter(
      (item) => getScheduleWorkStore(item) === publicScheduleStore
    ).length;
  }, [publicScheduleList, publicScheduleStore]);

  const publicOutgoingSupportCount =
    publicScheduleStore === "全部"
      ? 0
      : publicScheduleList.length - publicScheduledCount;

  const openPublicSchedule = (storeName = "全部", dateKey = getTomorrowTaipeiDateKey()) => {
    setPublicScheduleStore(storeName);
    setPublicScheduleDate(dateKey);
    setPublicViewMode("schedule");
    const params = new URLSearchParams();
    params.set("view", "schedule");
    params.set("date", dateKey);
    if (storeName && storeName !== "全部") params.set("store", storeName);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  const closePublicSchedule = () => {
    setPublicViewMode("checkin");
    window.history.replaceState(null, "", window.location.pathname);
  };

  const adminFilteredRecords = useMemo(() => {
    return records.filter((r) => {
      const keyword = recordSearch.trim().toLowerCase();
      return (
        !keyword ||
        String(r.name || "").toLowerCase().includes(keyword) ||
        String(r.empId || "").toLowerCase().includes(keyword)
      );
    });
  }, [records, recordSearch]);

  const longBreakExceptionRecords = useMemo(() => {
    return records
      .filter((record) => Number(record.longBreakMinutes) > LONG_BREAK_MINUTES || String(record.exceptionReason || "").trim())
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }, [records]);

  const adminRecordMonthGroups = useMemo(() => {
    const groups = {};
    adminFilteredRecords.forEach((record) => {
      const monthKey = record.monthKey || getMonthValue(record.createdAt || Date.now());
      if (!groups[monthKey]) groups[monthKey] = [];
      groups[monthKey].push(record);
    });
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [adminFilteredRecords]);

  const toggleRecordMonth = (monthKey) => {
    setExpandedRecordMonths((prev) => ({ ...prev, [monthKey]: !prev[monthKey] }));
  };

  const getLastMonthKey = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return getMonthValue(d.getTime());
  };

  const deleteLastMonthRecords = async () => {
    const monthKey = getLastMonthKey();
    const password = window.prompt("請輸入刪除密碼");

    if (password !== "8888") {
      alert("密碼錯誤，已取消刪除");
      return;
    }

    const ok = window.confirm(`確定要刪除 ${monthKey} 的全部打卡紀錄嗎？此動作無法復原。`);
    if (!ok) return;

    try {
      const snap = await get(ref(db, "records"));
      const data = snap.val() || {};
      const targets = Object.entries(data).filter(([_, value]) => {
        const key = value?.monthKey || getMonthValue(value?.createdAt || Date.now());
        return key === monthKey;
      });

      if (!targets.length) {
        alert(`${monthKey} 沒有可刪除的打卡紀錄`);
        return;
      }

      await Promise.all(targets.map(([id]) => remove(ref(db, `records/${id}`))));
      alert(`已刪除 ${monthKey} 的 ${targets.length} 筆打卡紀錄`);
    } catch (error) {
      console.error(error);
      alert("刪除上個月打卡紀錄失敗");
    }
  };


  const todayScheduleList = useMemo(() => {
    return Object.entries(todayScheduleData || {})
      .map(([empKey, item]) => ({
        empId: item?.empId || empKey,
        name: item?.name || empKey,
        store: item?.store || "未填店名",
        startTime: item?.startTime || "",
        endTime: item?.endTime || "",
        working: !!item?.working,
        isSupport: !!item?.isSupport,
        supportStore: item?.supportStore || "",
      }))
      .filter((item) => item.working)
      .sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")));
  }, [todayScheduleData]);

  const firstWorkInByEmpToday = useMemo(() => {
    const map = {};
    todayRecords
      .filter((record) => record?.type === "上班")
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .forEach((record) => {
        const empId = String(record?.empId || "").trim();
        if (!empId) return;
        if (!map[empId]) map[empId] = record;
      });
    return map;
  }, [todayRecords]);

  const lateDashboardList = useMemo(() => {
    const nowTs = Date.now();
    return todayScheduleList
      .map((item) => {
        const startTs = getTaipeiTimestampFromDateTime(todayKey, item.startTime);
        if (!startTs) return null;

        const workIn = firstWorkInByEmpToday[item.empId];
        const actualTs = workIn?.createdAt || 0;

        let lateMinutes = 0;
        let actualTime = workIn?.time || "尚未打卡";
        let status = "準時";

        if (actualTs) {
          lateMinutes = Math.max(0, Math.floor((actualTs - startTs) / 60000));
          status = lateMinutes > 0 ? "已遲到" : "準時";
        } else if (nowTs > startTs) {
          lateMinutes = Math.max(0, Math.floor((nowTs - startTs) / 60000));
          status = "尚未打卡";
        }

        if (lateMinutes <= 0) return null;

        return {
          ...item,
          actualTime,
          lateMinutes,
          status,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.lateMinutes - a.lateMinutes);
  }, [todayScheduleList, firstWorkInByEmpToday, todayKey, nowTime]);

  const dashboardStats = useMemo(() => {
    const scheduledCount = todayScheduleList.length;
    const checkedInCount = todayScheduleList.filter((item) => firstWorkInByEmpToday[item.empId]).length;
    const lateCount = lateDashboardList.length;
    const notCheckedCount = todayScheduleList.filter((item) => {
      const startTs = getTaipeiTimestampFromDateTime(todayKey, item.startTime);
      return startTs && Date.now() > startTs && !firstWorkInByEmpToday[item.empId];
    }).length;

    return {
      scheduledCount,
      checkedInCount,
      lateCount,
      notCheckedCount,
    };
  }, [todayScheduleList, firstWorkInByEmpToday, lateDashboardList, todayKey, nowTime]);


  const recentRecords = records.slice(0, 8);

  if (!authReady) {
    return (
      <div style={styles.loadingPage}>
        <div style={styles.loadingCard}>
          <div style={styles.loadingTitle}>店面打卡系統</div>
          <div style={styles.loadingText}>系統連線中…</div>
          {authError ? <div style={styles.errorText}>{authError}</div> : null}
          {authError ? (
            <button
              style={styles.retryBtn}
              onClick={() => window.location.reload()}
            >
              重新整理再試一次
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!isAdmin && publicViewMode === "schedule") {
    return (
      <div style={styles.page}>
        {scoreToast && (
          <div style={styles.scoreToastOverlay}>
            <div style={styles.scoreToastCard}>
              <button style={styles.scoreToastClose} onClick={closeScoreToast}>×</button>
              <div style={styles.scoreToastIcon}>✓</div>
              <div style={styles.scoreToastTitle}>{scoreToast.name} {scoreToast.type}成功</div>
              <div style={styles.scoreToastSub}>{formatDateTime(scoreToast.createdAt)}</div>
              {scoreToast.pointsResult?.found ? (
                <div style={styles.scoreToastScoreBox}>
                  <div style={styles.scoreToastLabel}>本月目前積分</div>
                  <div style={styles.scoreToastScore}>{scoreToast.pointsResult.monthlyPoints} 分</div>
                  <div style={styles.scoreToastDetail}>
                    基本 {MONTHLY_BASE_POINTS} 分｜本月紀錄 {scoreToast.pointsResult.logCount} 筆｜加分 {scoreToast.pointsResult.bonusCount} 筆｜扣分 {scoreToast.pointsResult.penaltyCount} 筆
                  </div>
                </div>
              ) : (
                <div style={styles.scoreToastNotice}>{scoreToast.pointsResult?.message || "尚無積分資料"}</div>
              )}
            </div>
          </div>
        )}
        <div style={styles.overlay} />

        <div style={styles.topRightBar}>
          <button
            style={{
              ...styles.adminTopBtn,
              marginRight: 10,
              background: "#16a34a",
            }}
            onClick={() =>
              window.open(
                "https://staff-meal-system.vercel.app/",
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            員工餐
          </button>

          <button
            style={styles.adminTopBtn}
            onClick={() => setShowLoginModal(true)}
          >
            管理員
          </button>
        </div>

        {showLoginModal && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalCard}>
              <div style={styles.modalTitle}>管理員登入</div>
              <input
                style={styles.modalInput}
                type="password"
                placeholder="請輸入密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") login();
                }}
              />
              <div style={styles.modalActions}>
                <button
                  style={styles.modalCancelBtn}
                  onClick={() => {
                    setShowLoginModal(false);
                    setPassword("");
                  }}
                >
                  取消
                </button>
                <button style={styles.modalLoginBtn} onClick={login}>
                  進入後台
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={styles.mainWrap}>
          <div style={styles.brandBar}>
            <div style={styles.brandDot} />
            <div>
              <div style={styles.brandTitle}>店面班表查詢</div>
              <div style={styles.brandSub}>Schedule Viewer</div>
            </div>
          </div>

          <div style={styles.schedulePublicCard}>
            <div style={styles.schedulePublicHeader}>
              <div>
                <h1 style={styles.kioskTitle}>📅 班表查詢</h1>
                <p style={styles.kioskDesc}>預設顯示明日班表，可手動切換日期與店別。</p>
              </div>
              <button style={styles.backBtn} onClick={closePublicSchedule}>
                ← 返回打卡
              </button>
            </div>

            <div style={styles.scheduleFilterGrid}>
              <div>
                <div style={styles.filterLabel}>班表日期</div>
                <input
                  type="date"
                  value={publicScheduleDate}
                  onChange={(e) => {
                    const nextDate = e.target.value;
                    setPublicScheduleDate(nextDate);
                    openPublicSchedule(publicScheduleStore, nextDate);
                  }}
                  style={styles.scheduleInput}
                />
              </div>

              <div>
                <div style={styles.filterLabel}>店別</div>
                <select
                  value={publicScheduleStore}
                  onChange={(e) => openPublicSchedule(e.target.value, publicScheduleDate)}
                  style={styles.scheduleInput}
                >
                  {publicStoreOptions.map((storeName) => (
                    <option key={storeName} value={storeName}>{storeName}</option>
                  ))}
                </select>
              </div>

              <div>
                <div style={styles.filterLabel}>查自己班表</div>
                <input
                  type="text"
                  placeholder="輸入姓名或工號"
                  value={publicEmployeeKeyword}
                  onChange={(e) => setPublicEmployeeKeyword(e.target.value)}
                  style={styles.scheduleInput}
                />
              </div>
            </div>

            <div style={styles.scheduleSummaryBar}>
              <div>日期：{publicScheduleDate}</div>
              <div>店別：{publicScheduleStore}</div>
              <div>排班：{publicScheduledCount} 人</div>
              {publicOutgoingSupportCount > 0 ? (
                <div>支援他店：{publicOutgoingSupportCount} 人</div>
              ) : null}
            </div>

            {publicScheduleList.length === 0 ? (
              <div style={styles.emptyScheduleBox}>目前沒有符合條件的排班</div>
            ) : (
              <div style={styles.publicScheduleList}>
                {publicScheduleList.map((item) => (
                  <div key={`${item.empId}-${item.startTime}`} style={{
                    ...styles.publicScheduleRow,
                    ...(item.isSupport ? { background: "#dbeafe", borderColor: "#93c5fd" } : {}),
                  }}>
                    <div>
                      <div style={styles.publicScheduleName}>{item.name}</div>
                      <div style={styles.publicScheduleMeta}>
                        {item.empId} ・ {item.isSupport && item.supportStore
                          ? `所屬${item.store || "未填店名"}・支援${item.supportStore}`
                          : (item.store || "未填店名")}
                      </div>
                    </div>
                    <div style={styles.publicScheduleTime}>
                      {item.startTime || "未填"} - {item.endTime || "未填"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
            if (!isAdmin) {
    return (
      <div className="checkin-page" style={styles.tabletPage}>
        {scoreToast && (
          <div style={styles.scoreToastOverlay}>
            <div style={styles.scoreToastCard}>
              <button style={styles.scoreToastClose} onClick={closeScoreToast}>×</button>
              <div style={styles.scoreToastIcon}>✓</div>
              <div style={styles.scoreToastTitle}>{scoreToast.name} {scoreToast.type}成功</div>
              <div style={styles.scoreToastSub}>{formatDateTime(scoreToast.createdAt)}</div>
              {scoreToast.pointsResult?.found ? (
                <div style={styles.scoreToastScoreBox}>
                  <div style={styles.scoreToastLabel}>本月目前積分</div>
                  <div style={styles.scoreToastScore}>{scoreToast.pointsResult.monthlyPoints} 分</div>
                  <div style={styles.scoreToastDetail}>
                    基本 {MONTHLY_BASE_POINTS} 分｜本月紀錄 {scoreToast.pointsResult.logCount} 筆｜加分 {scoreToast.pointsResult.bonusCount} 筆｜扣分 {scoreToast.pointsResult.penaltyCount} 筆
                  </div>
                </div>
              ) : (
                <div style={styles.scoreToastNotice}>{scoreToast.pointsResult?.message || "尚無積分資料"}</div>
              )}
            </div>
          </div>
        )}

        {breakReminderModal && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalCard}>
              <div style={{ fontSize: 46, textAlign: "center", marginBottom: 8 }}>⏰</div>
              <div style={styles.modalTitle}>
                {breakReminderModal.stage === 25 ? "休息剩下 5 分鐘" : "休息時間已到"}
              </div>
              <div style={{ color: "#475569", lineHeight: 1.8, margin: "12px 0 18px", textAlign: "center", fontWeight: 800 }}>
                {breakReminderModal.name} 已休息 {breakReminderModal.elapsedMinutes} 分鐘。<br />
                {breakReminderModal.stage === 25
                  ? "請同事幫忙提醒，5 分鐘後記得回來。"
                  : "請提醒本人回來後立刻打休息結束卡。"}
              </div>
              <button
                style={{ ...styles.modalLoginBtn, width: "100%" }}
                onClick={() => setBreakReminderModal(null)}
              >
                我知道了
              </button>
            </div>
          </div>
        )}

        {lateCheckInModal && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalCard}>
              <div style={styles.modalTitle}>確認上班狀況</div>
              <div style={{ color: "#475569", lineHeight: 1.7, marginBottom: 16 }}>
                {lateCheckInModal.emp.name} 已超過排班時間 {lateCheckInModal.lateMinutes} 分鐘。請確認是真的遲到，還是已經上班但忘記打卡。
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <button
                  style={styles.modalLoginBtn}
                  onClick={() => {
                    const emp = lateCheckInModal.emp;
                    setLateCheckInModal(null);
                    checkIn("上班", { emp, skipLateConfirmation: true });
                  }}
                >
                  我是真的遲到，正常打上班卡
                </button>
                <button
                  style={{ ...styles.modalLoginBtn, background: "linear-gradient(135deg, #f97316, #ea580c)" }}
                  onClick={() => {
                    const emp = lateCheckInModal.emp;
                    setLateCheckInModal(null);
                    openMissedPunchRequest(emp, "上班", "上班");
                  }}
                >
                  我已經上班，只是忘記打卡
                </button>
                <button style={styles.modalCancelBtn} onClick={() => setLateCheckInModal(null)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {longBreakModal && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalCard}>
              <div style={styles.modalTitle}>休息已超過 30 分鐘</div>
              <div style={{ color: "#475569", lineHeight: 1.7, marginBottom: 14 }}>
                {longBreakModal.emp.name} 本次休息已經 {longBreakModal.breakMinutes} 分鐘。請先選擇這次是哪一種狀況。
              </div>
              {!longBreakModal.showReasonForm ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <button
                    style={{ ...styles.modalLoginBtn, width: "100%", background: "linear-gradient(135deg, #f97316, #ea580c)" }}
                    onClick={() => {
                      const emp = longBreakModal.emp;
                      setLongBreakModal(null);
                      setLongBreakReason("");
                      openMissedPunchRequest(emp, "休息結束", "休息結束");
                    }}
                  >
                    已回去工作，只是忘記打卡
                  </button>
                  <button
                    style={{ ...styles.modalLoginBtn, width: "100%" }}
                    onClick={() => setLongBreakModal((prev) => ({ ...prev, showReasonForm: true }))}
                  >
                    確實休息超過 30 分鐘
                  </button>
                  <button style={styles.modalCancelBtn} onClick={() => setLongBreakModal(null)}>
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <div style={styles.deviceLabel}>休息超時原因</div>
                  <textarea
                    style={{ ...styles.modalInput, minHeight: 100, resize: "vertical" }}
                    placeholder="例如：身體不舒服，需要多休息一下"
                    value={longBreakReason}
                    onChange={(e) => setLongBreakReason(e.target.value)}
                  />
                  <div style={styles.modalActions}>
                    <button
                      style={styles.modalCancelBtn}
                      onClick={() => {
                        setLongBreakReason("");
                        setLongBreakModal((prev) => ({ ...prev, showReasonForm: false }));
                      }}
                    >
                      返回選擇
                    </button>
                    <button style={styles.modalLoginBtn} onClick={confirmLongBreak}>
                      填寫原因並打休息結束卡
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {missedPunchModal && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalCard}>
              <div style={styles.modalTitle}>申請忘打卡</div>
              <div style={{ color: "#475569", lineHeight: 1.7, marginBottom: 14 }}>
                {missedPunchModal.emp.name} 要執行「{missedPunchModal.targetType}」，但缺少「{missedPunchModal.missingType}」紀錄。送出後即可繼續打卡，申請會送到積分系統由管理員審核。
              </div>

              <div style={styles.deviceLabel}>忘打卡時間</div>
              <input
                style={styles.modalInput}
                type="datetime-local"
                value={missedPunchTime}
                onChange={(e) => setMissedPunchTime(e.target.value)}
              />

              <div style={styles.deviceLabel}>忘打卡原因</div>
              <textarea
                style={{ ...styles.modalInput, minHeight: 100, resize: "vertical" }}
                placeholder="例如：早上忙著備料，忘記打上班卡"
                value={missedPunchReason}
                onChange={(e) => setMissedPunchReason(e.target.value)}
              />

              <div style={styles.modalActions}>
                <button
                  style={styles.modalCancelBtn}
                  onClick={() => setMissedPunchModal(null)}
                  disabled={missedPunchSaving}
                >
                  取消
                </button>
                <button
                  style={styles.modalLoginBtn}
                  onClick={submitMissedPunchRequest}
                  disabled={missedPunchSaving}
                >
                  {missedPunchSaving ? "送出中…" : "送出申請並繼續打卡"}
                </button>
              </div>
            </div>
          </div>
        )}

        {mealModalData && (
          <div style={styles.modalOverlay}>
            <div style={styles.mealModalCard}>
              <div style={styles.mealModalIcon}>🍽️</div>
              <div style={styles.modalTitle}>下班員工餐登記</div>
              <div style={styles.mealModalDesc}>
                {mealModalData.name} 今天有吃員工餐嗎？請輸入金額，沒有吃就按「沒有吃」。
              </div>
              <input
                style={styles.mealAmountInput}
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="輸入員工餐金額，例如 80"
                value={mealAmount}
                onChange={(e) => setMealAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveCheckoutMeal();
                }}
                autoFocus
              />
              <div style={styles.mealModalActions}>
                <button
                  style={styles.mealNoBtn}
                  onClick={skipCheckoutMeal}
                  disabled={mealSaving}
                >
                  沒有吃
                </button>
                <button
                  style={styles.mealSaveBtn}
                  onClick={() => saveCheckoutMeal()}
                  disabled={mealSaving}
                >
                  {mealSaving ? "儲存中…" : "確認登記"}
                </button>
              </div>
              <button
                style={styles.mealLaterBtn}
                onClick={closeMealModalWithoutSaving}
                disabled={mealSaving}
              >
                稍後再填
              </button>
            </div>
          </div>
        )}

        {announcementModalData && (
          <div style={styles.modalOverlay}>
            <div style={styles.announcementModalCard}>
              <div style={styles.announcementIcon}>📢</div>
              <div style={styles.announcementTitle}>{announcementModalData.title}</div>
              <div style={styles.announcementGreeting}>
                {announcementModalData.name}，下班辛苦了！
              </div>
              <div style={styles.announcementContent}>
                {announcementModalData.content}
              </div>
              <button style={styles.announcementConfirmBtn} onClick={acknowledgeAnnouncement}>
                我知道了
              </button>
            </div>
          </div>
        )}

        {showLoginModal && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalCard}>
              <div style={styles.modalTitle}>管理員登入</div>
              <input
                style={styles.modalInput}
                type="password"
                placeholder="請輸入密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") login();
                }}
              />
              <div style={styles.modalActions}>
                <button
                  style={styles.modalCancelBtn}
                  onClick={() => {
                    setShowLoginModal(false);
                    setPassword("");
                  }}
                >
                  取消
                </button>
                <button style={styles.modalLoginBtn} onClick={login}>
                  進入後台
                </button>
              </div>
            </div>
          </div>
        )}

        <aside className="checkin-sidebar" style={styles.tabletSidebar}>
          <div className="checkin-sidebar-logo" style={styles.sidebarLogoBox}>
            <div style={styles.sidebarLogo}>MWD</div>
            <div style={styles.sidebarBrand}>麥味登<br />打卡系統</div>
          </div>

          <button
            className="checkin-sidebar-nav"
            style={styles.sidebarNavActive}
            onClick={() => openPublicSchedule("全部", getTomorrowTaipeiDateKey())}
          >
            📅 查看班表
          </button>

          <button
            className="checkin-sidebar-nav"
            style={styles.sidebarNav}
            onClick={() =>
              window.open(
                "https://staff-meal-system.vercel.app/",
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            🍱 員工餐
          </button>

          <button
            className="checkin-sidebar-nav"
            style={styles.sidebarNav}
            onClick={() =>
              window.open(
                "https://breakfast-system.vercel.app/",
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            ⭐ 積分系統
          </button>

          <button
            className="checkin-sidebar-admin"
            style={styles.sidebarAdminBtn}
            onClick={() => setShowLoginModal(true)}
          >
            管理員
          </button>
        </aside>

        <main className="checkin-main" style={styles.tabletMain}>
          <section className="checkin-header" style={styles.dashboardHeader}>
            <div>
              <div style={styles.dashboardHello}>早安，店長 👋</div>
              <div style={styles.dashboardSub}>今天也一起加油！</div>
            </div>

            <div className="checkin-clock" style={styles.clockBox}>
              <div style={styles.clockTime}>{nowTime ? nowTime.split(" ")[1] : "--:--:--"}</div>
              <div style={styles.clockDate}>{todayKey.replace(/-/g, "/")}</div>
            </div>

            <div className="checkin-header-actions" style={styles.headerActions}>
              <button style={styles.refreshMiniBtn} onClick={() => window.location.reload()}>
                重新整理
              </button>
              <button style={styles.headerScheduleBtn} onClick={() => openPublicSchedule("全部", getTomorrowTaipeiDateKey())}>
                查看班表
              </button>
            </div>
          </section>

          {!isAuthorizedDevice && (
            <div style={styles.dashboardWarning}>
              此設備尚未授權，請先由管理員進入後台綁定西螺或斗南設備。
            </div>
          )}

          <section className="checkin-top-grid" style={styles.dashboardTopGrid}>
            <div style={styles.latePanel}>
              <div style={styles.cardTitleRed}>⚠ 今日遲到看板</div>
              {lateDashboardList.length === 0 ? (
                <div style={styles.noLateBox}>🎉 今日目前沒有遲到紀錄</div>
              ) : (
                <>
                  <div style={styles.lateCountText}>遲到 {lateDashboardList.length} 人</div>
                  {lateDashboardList.slice(0, 3).map((item) => (
                    <div key={`${item.empId}-${item.startTime}`} style={styles.latePersonRow}>
                      <div style={styles.staffMiniInfo}>
                        <div style={styles.latePersonName}>{item.name}</div>
                        <div style={styles.latePersonMeta}>
                          {item.isSupport && item.supportStore ? `支援${item.supportStore}` : item.store}｜排班 {item.startTime}｜{item.actualTime === "尚未打卡" ? "尚未打卡" : `打卡 ${item.actualTime}`}
                        </div>
                      </div>
                      <div style={styles.lateMinutes}>遲到 {item.lateMinutes} 分</div>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div style={styles.statsPanel}>
              <div style={styles.cardTitleGreen}>今日出勤狀況</div>
              <div className="checkin-stats-grid" style={styles.statsGrid}>
                <div style={styles.statBox}>
                  <div style={styles.statValue}>{dashboardStats.checkedInCount}</div>
                  <div style={styles.statLabel}>已打卡</div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statValue}>{dashboardStats.scheduledCount}</div>
                  <div style={styles.statLabel}>排班</div>
                </div>
                <div style={styles.statBox}>
                  <div style={{ ...styles.statValue, color: "#dc2626" }}>{dashboardStats.lateCount}</div>
                  <div style={styles.statLabel}>遲到</div>
                </div>
                <div style={styles.statBox}>
                  <div style={{ ...styles.statValue, color: "#f97316" }}>{dashboardStats.notCheckedCount}</div>
                  <div style={styles.statLabel}>未打卡</div>
                </div>
              </div>
            </div>
          </section>

          <section className="checkin-panel" style={styles.checkinPanel}>
            <input
              style={styles.dashboardInput}
              placeholder="請輸入工號"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") checkIn("上班");
              }}
            />

            <div className="checkin-action-grid" style={styles.dashboardButtonGrid}>
              <button
                style={{ ...styles.dashboardActionBtn, ...styles.dashboardBlueBtn, opacity: !isAuthorizedDevice ? 0.5 : 1 }}
                onClick={() => checkIn("上班")}
              >
                ⬆ 上班打卡
                <span>開始今天的工作</span>
              </button>
              <button
                style={{ ...styles.dashboardActionBtn, ...styles.dashboardOrangeBtn, opacity: !isAuthorizedDevice ? 0.5 : 1 }}
                onClick={() => checkIn("休息開始")}
              >
                ☕ 休息開始
                <span>開始休息時間</span>
              </button>
              <button
                style={{ ...styles.dashboardActionBtn, ...styles.dashboardGreenBtn, opacity: !isAuthorizedDevice ? 0.5 : 1 }}
                onClick={() => checkIn("休息結束")}
              >
                🍵 休息結束
                <span>結束休息時間</span>
              </button>
              <button
                style={{ ...styles.dashboardActionBtn, ...styles.dashboardDarkBtn, opacity: !isAuthorizedDevice ? 0.5 : 1 }}
                onClick={() => checkIn("下班")}
              >
                ⬇ 下班打卡
                <span>下班時登記員工餐</span>
              </button>
            </div>
          </section>

          <section className="checkin-bottom-grid" style={styles.dashboardBottomGrid}>
            <div style={styles.dashboardCard}>
              <div style={styles.sectionTitle}>今日有上班人員狀態</div>
              <div className="checkin-staff-grid" style={styles.staffMiniGrid}>
                {liveStatusList.length === 0 && (
                  <div style={{ color: "#94a3b8", padding: "12px 0" }}>今天目前還沒有人打卡</div>
                )}
                {liveStatusList.map((emp) => {
                  const statusStyle = getStatusStyle(emp.status);
                  return (
                    <div key={emp.empId} style={styles.staffMiniCard}>
                      <div>
                        <div style={styles.staffMiniName}>{emp.name}</div>
                        <div style={styles.staffMiniMeta}>{emp.empId}｜{emp.store || "未填店名"}</div>
                      </div>
                      <span style={{ ...styles.staffMiniBadge, color: statusStyle.color, background: statusStyle.background }}>
                        {emp.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={styles.dashboardCard}>
              <div style={styles.sectionTitle}>近期打卡紀錄</div>
              {recentRecords.slice(0, 6).map((r) => (
                <div key={r.id} style={{
                  ...styles.compactRecordRow,
                  ...(r.isSupport ? { background: "#dbeafe", borderRadius: 12, padding: "10px 12px" } : {}),
                }}>
                  <div style={styles.recordAdminInfo}>
                    <div style={styles.recordName}>{r.name}</div>
                    <div style={styles.recordMeta}>
                      {r.empId}・{r.isSupport && r.supportStore ? `支援${r.supportStore}` : (r.store || "未填店名")}
                    </div>
                  </div>
                  <div style={styles.recordRight}>
                    <div style={styles.recordType}>{r.type}</div>
                    <div style={styles.recordTime}>{r.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div style={styles.systemNotice}>
            📣 系統公告：請大家準時打卡，遲到超過 10 分鐘將自動通知店長群組。
          </div>
          <button
            type="button"
            style={{ ...styles.fullMainBtn, marginTop: 12, width: "100%" }}
            onClick={() => unlockMobileAudio(true)}
          >
            🔊 啟用／測試平板聲音
          </button>
        </main>
      </div>
    );
  }


  return (
    <div className="admin-page" style={styles.adminPage}>
      {scoreToast && (
        <div style={styles.scoreToastOverlay}>
          <div style={styles.scoreToastCard}>
            <button style={styles.scoreToastClose} onClick={closeScoreToast}>×</button>
            <div style={styles.scoreToastIcon}>✓</div>
            <div style={styles.scoreToastTitle}>{scoreToast.name} {scoreToast.type}成功</div>
            <div style={styles.scoreToastSub}>{formatDateTime(scoreToast.createdAt)}</div>
            {scoreToast.pointsResult?.found ? (
              <div style={styles.scoreToastScoreBox}>
                <div style={styles.scoreToastLabel}>本月目前積分</div>
                <div style={styles.scoreToastScore}>{scoreToast.pointsResult.monthlyPoints} 分</div>
                <div style={styles.scoreToastDetail}>
                  基本 {MONTHLY_BASE_POINTS} 分｜本月紀錄 {scoreToast.pointsResult.logCount} 筆｜加分 {scoreToast.pointsResult.bonusCount} 筆｜扣分 {scoreToast.pointsResult.penaltyCount} 筆
                </div>
              </div>
            ) : (
              <div style={styles.scoreToastNotice}>{scoreToast.pointsResult?.message || "尚無積分資料"}</div>
            )}
          </div>
        </div>
      )}
      {showAddModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={styles.modalTitle}>新增員工</div>

            <input
              style={styles.modalInput}
              placeholder="請輸入員工工號，例如 A01"
              value={newEmpId}
              onChange={(e) => setNewEmpId(e.target.value)}
            />

            <input
              style={styles.modalInput}
              placeholder="請輸入員工姓名"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />

            <input
              style={styles.modalInput}
              placeholder="請輸入店名"
              value={store}
              onChange={(e) => setStore(e.target.value)}
            />

            <select
              style={styles.modalInput}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="正職">正職</option>
              <option value="PT">PT</option>
            </select>

            <div style={styles.modalActions}>
              <button
                style={styles.modalCancelBtn}
                onClick={() => {
                  setShowAddModal(false);
                  setNewEmpId("");
                  setNewName("");
                  setStore("");
                  setRole("正職");
                }}
              >
                取消
              </button>
              <button style={styles.modalLoginBtn} onClick={addEmployee}>
                確認新增
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={styles.modalTitle}>編輯員工</div>

            <input
              style={styles.modalInput}
              placeholder="員工姓名"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />

            <input
              style={styles.modalInput}
              placeholder="店名"
              value={editStore}
              onChange={(e) => setEditStore(e.target.value)}
            />

            <select
              style={styles.modalInput}
              value={editRole}
              onChange={(e) => setEditRole(e.target.value)}
            >
              <option value="正職">正職</option>
              <option value="PT">PT</option>
            </select>

            <div style={styles.modalActions}>
              <button
                style={styles.modalCancelBtn}
                onClick={() => {
                  setShowEditModal(false);
                  setEditingEmp(null);
                }}
              >
                取消
              </button>
              <button style={styles.modalLoginBtn} onClick={updateEmployee}>
                儲存修改
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecordEditModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={styles.modalTitle}>修改打卡紀錄</div>

            <input
              style={styles.modalInput}
              value={editingRecord?.name || ""}
              readOnly
            />

            <select
              style={styles.modalInput}
              value={editRecordType}
              onChange={(e) => setEditRecordType(e.target.value)}
            >
              <option value="上班">上班</option>
              <option value="下班">下班</option>
              <option value="休息開始">休息開始</option>
              <option value="休息結束">休息結束</option>
            </select>

            <input
              style={styles.modalInput}
              type="datetime-local"
              value={editRecordTime}
              onChange={(e) => setEditRecordTime(e.target.value)}
            />

            <div style={styles.modalActions}>
              <button
                style={styles.modalCancelBtn}
                onClick={() => {
                  setShowRecordEditModal(false);
                  setEditingRecord(null);
                }}
              >
                取消
              </button>
              <button style={styles.modalLoginBtn} onClick={saveRecordEdit}>
                儲存修改
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="admin-header" style={styles.adminHeader}>
        <div>
          <div style={styles.adminTitle}>管理後台</div>
          <div style={styles.adminSub}>員工、設備、紀錄、月報表匯出管理中心</div>
        </div>
        <button style={styles.logoutBtn} onClick={logout}>
          離開管理模式
        </button>
      </div>

      <div className="admin-grid" style={styles.adminGrid}>
        <div className="admin-left-col" style={styles.leftCol}>
          <div className="admin-announcement-panel" style={styles.panelCard}>
            <div style={styles.listHeader}>
              <div style={styles.panelTitle}>每日員工公告</div>
              <div style={styles.badge}>📢</div>
            </div>

            <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>
              員工下班打卡並完成員工餐登記後，系統會自動顯示當天公告。
            </div>

            <div style={styles.deviceLabel}>公告日期</div>
            <input
              type="date"
              value={announcementDate}
              onChange={(e) => setAnnouncementDate(e.target.value)}
              style={styles.monthInput}
            />

            <div style={{ ...styles.deviceLabel, marginTop: 12 }}>公告內容</div>
            <textarea
              value={announcementContent}
              onChange={(e) => setAnnouncementContent(e.target.value)}
              placeholder="輸入今天要給員工看的公告，例如：明天新品上市，請大家先確認製作流程。"
              rows={7}
              style={styles.announcementTextarea}
            />

            <button
              style={{ ...styles.fullMainBtn, marginTop: 12, opacity: announcementSaving ? 0.7 : 1 }}
              onClick={saveDailyAnnouncement}
              disabled={announcementSaving}
            >
              {announcementSaving ? "儲存中…" : "儲存當日公告"}
            </button>
            <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
              將內容全部清空後再按儲存，可刪除該日公告。
            </div>
          </div>

          <div className="admin-schedule-panel" style={styles.panelCard}>
            <div style={styles.listHeader}>
              <div style={styles.panelTitle}>班表發布</div>
              <div style={styles.badge}>{adminStoreTab === "全部" ? publishStore : adminStoreTab}</div>
            </div>

            <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.7, marginTop: 6 }}>
              排班設定已整合進員工名單。現在改為「儲存班表＋複製班表連結」，不再自動 LINE 推播完整班表。
            </div>

            <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
              <div style={{
                display: "grid",
                gap: 8,
                padding: "12px",
                borderRadius: 14,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>發布班表日期</div>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  style={{
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid #cbd5e1",
                    padding: "12px 14px",
                    fontSize: 15,
                    outline: "none",
                    background: "#fff",
                  }}
                />
                <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
                  例如今天先發布明天早班，就把日期改成明天再傳送。
                </div>
              </div>

              <select
                value={publishStore}
                onChange={(e) => setPublishStore(e.target.value)}
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid #d1d5db",
                  padding: "12px 14px",
                  fontSize: 15,
                  outline: "none",
                }}
              >
                <option value="西螺文昌店">西螺文昌店</option>
                <option value="斗南站前店">斗南站前店</option>
              </select>

              <button
                style={{
                  ...styles.fullMainBtn,
                  background: scheduleSent
                    ? "linear-gradient(135deg, #10b981, #22c55e)"
                    : "linear-gradient(135deg, #2563eb, #3b82f6)",
                  opacity: scheduleSaving ? 0.7 : 1,
                }}
                onClick={saveAndSendSchedule}
                disabled={scheduleSaving}
              >
                {scheduleSaving
                  ? "儲存中…"
                  : scheduleSent
                  ? `✓ ${publishStore} ${scheduleDate} 已儲存`
                  : `儲存班表 ${publishStore} ${scheduleDate}`}
              </button>
              <button
                style={{
                  ...styles.fullGreenBtn,
                  marginTop: 0,
                }}
                onClick={copyScheduleLink}
              >
                {scheduleLinkCopied ? "✓ 已複製 LINE 分享文字" : "複製班表連結給 LINE 群組"}
              </button>

              <div style={styles.shareLinkBox}>
                {getScheduleShareUrl(scheduleDate, publishStore)}
              </div>

            </div>
          </div>

          <div className="admin-device-panel" style={styles.panelCard}>
            <div style={styles.panelTitle}>設備設定</div>
            <div style={styles.deviceBox}>
              <div style={styles.deviceLabel}>目前設備 ID</div>
              <div style={styles.deviceId}>{myDevice}</div>
              <div style={{ marginTop: 6, fontSize: 12, color: isAuthorizedDevice ? "#16a34a" : "#dc2626", fontWeight: 800 }}>
                {isAuthorizedDevice ? `此設備已授權：${currentDeviceStoreName}` : "此設備尚未授權"}
              </div>
            </div>

            <div style={styles.deviceBox}>
              <div style={styles.deviceLabel}>選擇要綁定的店別</div>
              <select
                value={bindStore}
                onChange={(e) => setBindStore(e.target.value)}
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid #cbd5e1",
                  padding: "10px 12px",
                  fontSize: 14,
                  outline: "none",
                  marginTop: 8,
                  background: "#fff",
                }}
              >
                {DEVICE_BIND_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <button style={styles.fullDarkBtn} onClick={bindDevice}>
              綁定這台設備到 {bindStore}
            </button>

            <div style={{ marginTop: 14 }}>
              <div style={styles.deviceLabel}>已授權設備列表</div>
              {Object.keys(authorizedDevices || {}).length === 0 ? (
                <div style={styles.emptyText}>尚未綁定任何設備</div>
              ) : (
                Object.entries(authorizedDevices || {}).map(([storeName, item]) => (
                  <div key={storeName} style={{ ...styles.deviceBox, marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={styles.deviceLabel}>{storeName}</div>
                        <div style={styles.deviceId}>{item?.id || "未設定"}</div>
                      </div>
                      <button
                        style={{
                          border: "none",
                          borderRadius: 10,
                          padding: "8px 10px",
                          background: "#fee2e2",
                          color: "#b91c1c",
                          fontWeight: 900,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                        onClick={() => unbindDevice(storeName)}
                      >
                        解除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="admin-export-panel" style={styles.panelCard}>
            <div style={styles.panelTitle}>資料匯出</div>
            <button style={styles.fullGreenBtn} onClick={exportAllCSV}>
              匯出全部打卡 CSV
            </button>

            <div style={styles.exportDivider} />

            <div style={styles.deviceLabel}>月報表月份</div>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={styles.monthInput}
            />

            <button style={styles.fullOrangeBtn} onClick={exportMonthlyCSV}>
              匯出薪資核對版 Excel
            </button>
          </div>

          <div className="admin-history-panel" style={styles.panelCard}>
            <button style={styles.collapseBtn} onClick={() => toggleAdminPanel("scheduleHistory")}>
              歷史班表 {adminPanels.scheduleHistory ? "－" : "＋"}
            </button>
            {adminPanels.scheduleHistory ? (
              <div style={styles.collapseContent}>
                {historyScheduleDates.length === 0 ? (
                  <div style={styles.emptyText}>目前沒有歷史班表</div>
                ) : (
                  historyScheduleDates.slice(0, 14).map((dateKey) => {
                    const dayData = scheduleHistory[dateKey] || {};
                    const storeMap = {};
                    Object.entries(dayData).forEach(([empId, item]) => {
                      if (!item?.working) return;
                      const storeName = (item.isSupport && item.supportStore) ? item.supportStore : (item.store || "未填店名");
                      if (!storeMap[storeName]) storeMap[storeName] = [];
                      storeMap[storeName].push({ empId, ...item });
                    });

                    return (
                      <div key={dateKey} style={styles.historyBlock}>
                        <div style={styles.historyDate}>{dateKey}</div>
                        {Object.keys(storeMap).length === 0 ? (
                          <div style={styles.historyItem}>無排班資料</div>
                        ) : (
                          Object.entries(storeMap).map(([storeName, list]) => (
                            <div key={storeName} style={{ marginTop: 8 }}>
                              <div style={styles.storeLabel}>{storeName}</div>
                              {list
                                .sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")))
                                .map((item) => (
                                  <div key={`${dateKey}-${storeName}-${item.empId}`} style={styles.historyItem}>
                                    {item.name}｜{item.startTime || "未填"} - {item.endTime || "未填"}{item.isSupport && item.supportStore ? `｜支援${item.supportStore}` : ""}
                                  </div>
                                ))}
                            </div>
                          ))
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

        </div>

        <div className="admin-right-col" style={styles.rightCol}>
          <div className="admin-employees-panel" style={styles.panelCard}>
            <div style={styles.listHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={styles.panelTitle}>排班設定＋員工名單</div>
                <div style={styles.badge}>{employees.length}</div>
              </div>
            </div>

            <button style={styles.addEmployeeFullBtn} onClick={() => setShowAddModal(true)}>
              ＋ 新增員工
            </button>

            <div style={styles.storeSwitchWrap}>
              {["全部", "西螺文昌店", "斗南站前店"].map((storeName) => (
                <button
                  key={storeName}
                  style={{
                    ...styles.storeSwitchBtn,
                    ...(adminStoreTab === storeName ? styles.storeSwitchBtnActive : {}),
                  }}
                  onClick={() => setAdminStoreTab(storeName)}
                >
                  {storeName}
                </button>
              ))}
            </div>

            {employees.length === 0 ? (
              <div style={styles.emptyText}>目前沒有員工資料</div>
            ) : (
              employees
                .filter((emp) => adminStoreTab === "全部" || emp.store === adminStoreTab)
                .map((emp) => {
                  const statusStyle = getStatusStyle(emp.status || "未打卡");
                  const key = emp.empId || emp.id;
                  const item = scheduleItems[key] || {
                    working: false,
                    startTime: getDefaultScheduleStartTime(emp.store, scheduleDate),
                    endTime: "14:00",
                    isSupport: false,
                  };

                  return (
                    <div key={emp.id} style={styles.integratedEmployeeCard}>
                      <div style={styles.integratedTopRow}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                          <label style={styles.scheduleCheckWrap}>
                            <input
                              type="checkbox"
                              checked={!!item.working}
                              onChange={() => toggleScheduleWorking(key)}
                              style={{ width: 18, height: 18, cursor: "pointer" }}
                            />
                          </label>

                          <div>
                            <div style={styles.employeeTopRow}>
                              <div style={styles.employeeName}>{emp.name}</div>
                              <span
                                style={{
                                  ...styles.statusBadge,
                                  background: statusStyle.background,
                                  color: statusStyle.color,
                                }}
                              >
                                {emp.status || "未打卡"}
                              </span>
                            </div>
                            <div style={styles.employeeId}>
                              工號：{emp.empId || emp.id} ・ 所屬 {emp.store || "未填店名"} ・ {emp.role || "未設定"}
                            </div>
                          </div>
                        </div>

                        <div style={styles.actionBtns}>
                          <button style={styles.editBtn} onClick={() => openEdit(emp)}>
                            編輯
                          </button>
                          <button style={styles.deleteBtn} onClick={() => deleteEmployee(emp)}>
                            停用
                          </button>
                        </div>
                      </div>

                      <div style={styles.integratedSchedulePanel}>
                        <div style={styles.integratedScheduleLabel}>
                          {item.working ? "今日已排班" : "未排班"}
                        </div>

                        <label style={{
                          marginBottom: 8,
                          padding: "8px 10px",
                          borderRadius: 12,
                          background: item.isSupport ? "#dbeafe" : "#f8fafc",
                          color: item.isSupport ? "#1d4ed8" : "#475569",
                          fontWeight: 900,
                          opacity: item.working ? 1 : 0.45,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          cursor: item.working ? "pointer" : "not-allowed",
                          border: item.isSupport ? "1px solid #93c5fd" : "1px solid #e2e8f0",
                        }}>
                          <input
                            type="checkbox"
                            checked={!!item.isSupport}
                            onChange={() => toggleScheduleSupport(key, emp.store)}
                            disabled={!item.working}
                            style={{ width: 17, height: 17, cursor: item.working ? "pointer" : "not-allowed" }}
                          />
                          <span>
                            支援{getOtherStoreName(emp.store)}
                          </span>
                        </label>

                        <div style={styles.integratedTimeRow}>
                          <div style={{ ...styles.integratedTimeBox, opacity: item.working ? 1 : 0.45 }}>
                            <div style={styles.integratedTimeTitle}>上班</div>
                            <input
                              type="time"
                              value={item.startTime || getDefaultScheduleStartTime(emp.store, scheduleDate)}
                              onChange={(e) => setScheduleTime(key, e.target.value)}
                              disabled={!item.working}
                              style={styles.integratedTimeInput}
                            />
                          </div>

                          <div style={{ ...styles.integratedTimeBox, opacity: item.working ? 1 : 0.45 }}>
                            <div style={styles.integratedTimeTitle}>下班</div>
                            <input
                              type="time"
                              value={item.endTime || "14:00"}
                              onChange={(e) => setScheduleEndTime(key, e.target.value)}
                              disabled={!item.working}
                              style={styles.integratedTimeInput}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
            )}
          </div>

          <div className="admin-exceptions-panel" style={styles.panelCard}>
            <button style={styles.collapseBtn} onClick={() => toggleAdminPanel("exceptionRecords")}>
              異常／忘打卡紀錄 {adminPanels.exceptionRecords ? "－" : "＋"}
            </button>

            {adminPanels.exceptionRecords ? (
              <div style={styles.collapseContent}>
                <div style={styles.listHeader}>
                  <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700, lineHeight: 1.6 }}>
                    忘打卡由積分系統審核；休息超時原因保留在打卡系統。
                  </div>
                  <button
                    style={styles.refreshMiniBtn}
                    onClick={loadMissedPunchRequests}
                    disabled={exceptionRecordsLoading}
                  >
                    {exceptionRecordsLoading ? "讀取中…" : "重新整理"}
                  </button>
                </div>

                {exceptionRecordsError ? (
                  <div style={{ ...styles.emptyText, color: "#b91c1c" }}>{exceptionRecordsError}</div>
                ) : null}

            <div style={{ ...styles.deviceLabel, marginTop: 14 }}>忘打卡申請</div>
            {missedPunchRequests.length === 0 && !exceptionRecordsLoading ? (
              <div style={styles.emptyText}>目前沒有忘打卡申請</div>
            ) : (
              missedPunchRequests.slice(0, 20).map((request) => {
                const statusMeta = getRequestStatusMeta(request.requestStatus);
                return (
                  <div key={`${request.storeId}-${request.id}`} style={styles.exceptionRecordCard}>
                    <div style={styles.exceptionRecordHeader}>
                      <div>
                        <div style={styles.employeeName}>{request.name || "未具名員工"}</div>
                        <div style={styles.employeeId}>
                          {request.operatorStoreLabel || POINTS_STORE_LABELS[request.storeId] || "未填店名"}
                        </div>
                        <div style={{ ...styles.employeeId, marginTop: 6 }}>
                          申請時間：{formatAnyDateTime(request.createdAt || request.timestamp)}
                        </div>
                        <div style={{ ...styles.employeeId, marginTop: 3 }}>
                          實際修正時間：{formatAnyDateTime(request.requestDateTime || request.requestDate)}
                        </div>
                      </div>
                      <span style={{ ...styles.statusBadge, color: statusMeta.color, background: statusMeta.background }}>
                        {statusMeta.label}
                      </span>
                    </div>
                    <div style={styles.exceptionReasonText}>
                      {request.note || `${request.missingType || "打卡"}忘打卡：未填原因`}
                    </div>
                  </div>
                );
              })
            )}

                <div style={{ ...styles.deviceLabel, marginTop: 18 }}>確實休息超時</div>
                {longBreakExceptionRecords.length === 0 ? (
                  <div style={styles.emptyText}>目前沒有休息超時原因紀錄</div>
                ) : (
                  longBreakExceptionRecords.slice(0, 20).map((record) => (
                    <div key={`long-break-${record.id}`} style={styles.exceptionRecordCard}>
                      <div style={styles.exceptionRecordHeader}>
                        <div>
                          <div style={styles.employeeName}>{record.name}</div>
                          <div style={styles.employeeId}>
                            {record.empId} ・ {record.store || "未填店名"} ・ {record.date} {record.time}
                          </div>
                        </div>
                        <span style={{ ...styles.statusBadge, color: "#9a3412", background: "#ffedd5" }}>
                          休息 {record.longBreakMinutes || 0} 分鐘
                        </span>
                      </div>
                      <div style={styles.exceptionReasonText}>
                        原因：{record.exceptionReason || "未填原因"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div className="admin-record-panel" style={styles.panelCard}>
            <div style={styles.listHeader}>
              <div style={styles.panelTitle}>打卡紀錄</div>
              <div style={styles.badge}>最新 {records.length} 筆</div>
            </div>

            <div className="admin-record-toolbar" style={styles.recordToolbar}>
              <input
                type="text"
                placeholder="搜尋員工姓名或工號"
                value={recordSearch}
                onChange={(e) => setRecordSearch(e.target.value)}
                style={styles.recordFilterInput}
              />
              <button style={styles.recordDangerBtn} onClick={deleteLastMonthRecords}>
                刪除上個月打卡紀錄
              </button>
            </div>

            {adminFilteredRecords.length === 0 ? (
              <div style={styles.emptyText}>目前沒有符合條件的打卡紀錄</div>
            ) : (
              adminRecordMonthGroups.map(([monthKey, monthRecords]) => {
                const isExpanded = !!expandedRecordMonths[monthKey];
                const [year, month] = monthKey.split("-");
                return (
                  <div key={monthKey} style={styles.recordMonthGroup}>
                    <button
                      className="admin-record-month-button"
                      style={styles.recordMonthButton}
                      onClick={() => toggleRecordMonth(monthKey)}
                    >
                      <span>{year} 年 {Number(month)} 月</span>
                      <span style={styles.recordMonthCount}>{monthRecords.length} 筆 {isExpanded ? "－" : "＋"}</span>
                    </button>
                    {isExpanded ? (
                      <div style={styles.recordMonthContent}>
                        {monthRecords.map((r) => (
                          <div className="admin-record-row" key={r.id} style={{
                            ...styles.recordAdminRow,
                            ...(r.isSupport ? { background: "#dbeafe", borderRadius: 14, padding: "14px 12px", marginBottom: 6 } : {}),
                          }}>
                            <div style={styles.recordAdminInfo}>
                              <div style={styles.employeeName}>{r.name}</div>
                              <div style={styles.employeeId}>
                                {r.empId} ・ {r.isSupport && r.supportStore ? `支援${r.supportStore}` : (r.store || "未填店名")} ・ {r.role || "未設定"} ・ {r.date}
                              </div>
                            </div>
                            <div className="admin-record-actions" style={styles.recordAdminActions}>
                              <div className="admin-record-summary" style={styles.recordAdminRight}>
                                <div style={styles.recordTypeBadge}>{r.type}</div>
                                <div style={styles.recordTime}>{r.time}</div>
                              </div>
                              <button style={styles.editBtn} onClick={() => openRecordEdit(r)}>
                                修改
                              </button>
                              <button style={styles.deleteBtn} onClick={() => deleteRecord(r)}>
                                刪除
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {

  tabletPage: {
    minHeight: "100vh",
    display: "grid",
    gridTemplateColumns: "170px 1fr",
    background: "linear-gradient(135deg, #e8f5ef 0%, #f8fafc 45%, #eef6ff 100%)",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  tabletSidebar: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #064e3b 0%, #047857 100%)",
    color: "#fff",
    padding: "20px 14px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    boxShadow: "10px 0 30px rgba(15,23,42,0.12)",
  },
  sidebarLogoBox: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 4px 20px",
    marginBottom: 6,
  },
  sidebarLogo: {
    width: 52,
    height: 52,
    borderRadius: 18,
    background: "rgba(255,255,255,0.16)",
    border: "1px solid rgba(255,255,255,0.28)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 950,
  },
  sidebarBrand: {
    fontSize: 14,
    fontWeight: 950,
    lineHeight: 1.25,
  },
  sidebarNav: {
    width: "100%",
    border: "none",
    borderRadius: 16,
    padding: "14px 12px",
    background: "rgba(255,255,255,0.10)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 900,
    textAlign: "left",
    cursor: "pointer",
  },
  sidebarNavActive: {
    width: "100%",
    border: "none",
    borderRadius: 16,
    padding: "14px 12px",
    background: "#ffffff",
    color: "#047857",
    fontSize: 15,
    fontWeight: 950,
    textAlign: "left",
    cursor: "pointer",
    boxShadow: "0 12px 26px rgba(0,0,0,0.16)",
  },
  sidebarAdminBtn: {
    marginTop: "auto",
    border: "1px solid rgba(255,255,255,0.24)",
    borderRadius: 999,
    padding: "11px 12px",
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    fontWeight: 950,
    cursor: "pointer",
  },
  tabletMain: {
    padding: "24px 26px",
    boxSizing: "border-box",
    minWidth: 0,
  },
  dashboardHeader: {
    display: "grid",
    gridTemplateColumns: "1fr 260px 230px",
    gap: 16,
    alignItems: "center",
    marginBottom: 16,
  },
  dashboardHello: {
    fontSize: 26,
    fontWeight: 950,
    color: "#0f172a",
  },
  dashboardSub: {
    marginTop: 4,
    color: "#64748b",
    fontWeight: 800,
  },
  clockBox: {
    textAlign: "center",
    background: "#ffffff",
    borderRadius: 24,
    padding: "12px 18px",
    boxShadow: "0 14px 34px rgba(15,23,42,0.08)",
    border: "1px solid #e2e8f0",
  },
  clockTime: {
    fontSize: 38,
    lineHeight: 1,
    color: "#047857",
    fontWeight: 950,
    letterSpacing: 1,
  },
  clockDate: {
    marginTop: 6,
    color: "#475569",
    fontSize: 13,
    fontWeight: 900,
  },
  headerActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  refreshMiniBtn: {
    border: "none",
    borderRadius: 999,
    background: "#f1f5f9",
    color: "#334155",
    padding: "11px 14px",
    fontWeight: 900,
    cursor: "pointer",
  },
  headerScheduleBtn: {
    border: "none",
    borderRadius: 999,
    background: "#2563eb",
    color: "#fff",
    padding: "11px 14px",
    fontWeight: 900,
    cursor: "pointer",
  },
  dashboardWarning: {
    background: "#fff7ed",
    color: "#c2410c",
    border: "1px solid #fdba74",
    padding: 13,
    borderRadius: 18,
    marginBottom: 14,
    fontWeight: 900,
    textAlign: "center",
  },
  dashboardTopGrid: {
    display: "grid",
    gridTemplateColumns: "1.15fr 1fr",
    gap: 16,
    marginBottom: 16,
  },
  latePanel: {
    background: "linear-gradient(180deg, #fff7f7, #ffffff)",
    border: "1px solid #fecaca",
    borderRadius: 26,
    padding: 18,
    boxShadow: "0 16px 36px rgba(220,38,38,0.08)",
    minHeight: 150,
  },
  statsPanel: {
    background: "linear-gradient(180deg, #f0fdf4, #ffffff)",
    border: "1px solid #bbf7d0",
    borderRadius: 26,
    padding: 18,
    boxShadow: "0 16px 36px rgba(22,163,74,0.08)",
  },
  cardTitleRed: {
    color: "#b91c1c",
    fontSize: 16,
    fontWeight: 950,
    marginBottom: 10,
  },
  cardTitleGreen: {
    color: "#047857",
    fontSize: 16,
    fontWeight: 950,
    marginBottom: 12,
  },
  noLateBox: {
    background: "#fff",
    borderRadius: 18,
    padding: 18,
    color: "#166534",
    fontWeight: 950,
    textAlign: "center",
    border: "1px solid #dcfce7",
  },
  lateCountText: {
    fontSize: 26,
    fontWeight: 950,
    color: "#dc2626",
    marginBottom: 8,
  },
  latePersonRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "10px 0",
    borderTop: "1px solid #fee2e2",
  },
  latePersonName: {
    fontSize: 16,
    fontWeight: 950,
    color: "#0f172a",
  },
  latePersonMeta: {
    marginTop: 3,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
  },
  lateMinutes: {
    color: "#dc2626",
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 10,
  },
  statBox: {
    background: "#fff",
    borderRadius: 18,
    padding: "16px 8px",
    textAlign: "center",
    border: "1px solid #e2e8f0",
  },
  statValue: {
    fontSize: 30,
    fontWeight: 950,
    color: "#047857",
  },
  statLabel: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 900,
  },
  checkinPanel: {
    background: "#fff",
    borderRadius: 28,
    padding: 18,
    boxShadow: "0 16px 38px rgba(15,23,42,0.08)",
    border: "1px solid #e2e8f0",
    marginBottom: 16,
  },
  dashboardInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "20px 18px",
    borderRadius: 22,
    border: "2px solid #dbeafe",
    background: "#f8fafc",
    fontSize: 28,
    fontWeight: 950,
    textAlign: "center",
    outline: "none",
    marginBottom: 14,
  },
  dashboardButtonGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 12,
  },
  dashboardActionBtn: {
    border: "none",
    borderRadius: 20,
    padding: "18px 10px",
    color: "#fff",
    fontSize: 20,
    fontWeight: 950,
    cursor: "pointer",
    boxShadow: "0 14px 26px rgba(15,23,42,0.12)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
  },
  dashboardBlueBtn: {
    background: "linear-gradient(135deg, #2563eb, #3b82f6)",
  },
  dashboardDarkBtn: {
    background: "linear-gradient(135deg, #334155, #0f172a)",
  },
  dashboardOrangeBtn: {
    background: "linear-gradient(135deg, #f59e0b, #f97316)",
  },
  dashboardGreenBtn: {
    background: "linear-gradient(135deg, #10b981, #22c55e)",
  },
  dashboardBottomGrid: {
    display: "grid",
    gridTemplateColumns: "1.3fr 0.85fr",
    gap: 16,
  },
  dashboardCard: {
    background: "#fff",
    borderRadius: 26,
    padding: 18,
    boxShadow: "0 16px 38px rgba(15,23,42,0.08)",
    border: "1px solid #e2e8f0",
  },
  staffMiniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 10,
  },
  staffMiniCard: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: "12px 14px",
    height: 76,
    boxSizing: "border-box",
    overflow: "hidden",
  },
  staffMiniInfo: {
    minWidth: 0,
    flex: 1,
  },
  staffMiniName: {
    fontSize: 15,
    fontWeight: 950,
    color: "#0f172a",
  },
  staffMiniMeta: {
    marginTop: 3,
    fontSize: 11,
    color: "#64748b",
    fontWeight: 800,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  staffMiniBadge: {
    borderRadius: 999,
    padding: "6px 9px",
    fontSize: 12,
    fontWeight: 950,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  compactRecordRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "10px 0",
    borderBottom: "1px solid #eef2f7",
  },
  systemNotice: {
    marginTop: 16,
    background: "#ecfdf5",
    color: "#047857",
    border: "1px solid #bbf7d0",
    borderRadius: 18,
    padding: "12px 16px",
    fontWeight: 900,
  },

  loadingPage: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "linear-gradient(135deg, #0f172a 0%, #1e3a8a 45%, #60a5fa 100%)",
    padding: 24,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  loadingCard: {
    background: "rgba(255,255,255,0.95)",
    borderRadius: 28,
    padding: 32,
    boxShadow: "0 20px 60px rgba(15,23,42,0.22)",
    minWidth: 280,
    textAlign: "center",
  },
  loadingTitle: {
    fontSize: 28,
    fontWeight: 900,
    color: "#0f172a",
    marginBottom: 10,
  },
  loadingText: {
    color: "#475569",
    fontWeight: 700,
  },
  errorText: {
    marginTop: 14,
    padding: "12px 14px",
    borderRadius: 14,
    background: "#fef2f2",
    color: "#b91c1c",
    border: "1px solid #fecaca",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  retryBtn: {
    marginTop: 14,
    border: "none",
    background: "#2563eb",
    color: "#fff",
    padding: "12px 18px",
    borderRadius: 14,
    fontWeight: 800,
    cursor: "pointer",
  },
  page: {
    minHeight: "100vh",
    background:
      "linear-gradient(135deg, #0f172a 0%, #1e3a8a 45%, #60a5fa 100%)",
    position: "relative",
    overflow: "hidden",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  overlay: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(circle at top left, rgba(255,255,255,0.18), transparent 28%), radial-gradient(circle at bottom right, rgba(255,255,255,0.12), transparent 24%)",
  },
  topRightBar: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "flex-end",
    padding: "20px 20px 0",
  },
  adminTopBtn: {
    border: "1px solid rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    padding: "12px 18px",
    borderRadius: 999,
    fontWeight: 900,
    cursor: "pointer",
    backdropFilter: "blur(10px)",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 30,
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    background: "#fff",
    borderRadius: 24,
    padding: 24,
    boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 900,
    color: "#0f172a",
    marginBottom: 16,
    textAlign: "center",
  },
  modalInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "14px 16px",
    borderRadius: 14,
    border: "1px solid #cbd5e1",
    outline: "none",
    fontSize: 16,
    marginBottom: 14,
    background: "#fff",
  },
  modalActions: {
    display: "flex",
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    border: "none",
    background: "#e2e8f0",
    color: "#334155",
    padding: "12px 16px",
    borderRadius: 14,
    fontWeight: 800,
    cursor: "pointer",
  },
  modalLoginBtn: {
    flex: 1,
    border: "none",
    background: "#2563eb",
    color: "#fff",
    padding: "12px 16px",
    borderRadius: 14,
    fontWeight: 800,
    cursor: "pointer",
  },
  mainWrap: {
    position: "relative",
    zIndex: 1,
    maxWidth: 1100,
    margin: "0 auto",
    padding: "10px 18px 40px",
  },
  brandBar: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    color: "#fff",
    marginBottom: 24,
  },
  brandDot: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "#93c5fd",
    boxShadow: "0 0 20px rgba(147,197,253,0.9)",
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: 800,
    letterSpacing: 0.5,
  },
  brandSub: {
    fontSize: 13,
    opacity: 0.85,
  },
  kioskCard: {
    background: "rgba(255,255,255,0.95)",
    backdropFilter: "blur(12px)",
    borderRadius: 32,
    padding: 28,
    boxShadow: "0 20px 60px rgba(15,23,42,0.22)",
    marginBottom: 20,
  },
  kioskHeader: {
    textAlign: "center",
    marginBottom: 24,
  },
  kioskTitle: {
    fontSize: 34,
    margin: 0,
    color: "#0f172a",
    fontWeight: 900,
  },
  kioskDesc: {
    marginTop: 8,
    color: "#64748b",
    fontSize: 14,
    fontWeight: 600,
  },
  timeBox: {
    textAlign: "center",
    fontSize: 22,
    fontWeight: 900,
    color: "#0f172a",
    marginBottom: 16,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    padding: "12px 14px",
    borderRadius: 16,
  },
  warningBox: {
    background: "#fff7ed",
    color: "#c2410c",
    border: "1px solid #fdba74",
    padding: 14,
    borderRadius: 16,
    marginBottom: 18,
    fontWeight: 700,
    textAlign: "center",
  },
  bigInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "22px 20px",
    borderRadius: 22,
    border: "2px solid #dbeafe",
    background: "#f8fafc",
    fontSize: 30,
    fontWeight: 800,
    textAlign: "center",
    outline: "none",
    marginBottom: 18,
  },
  btnGridFour: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
  },
  actionBtn: {
    padding: "22px 12px",
    borderRadius: 22,
    border: "none",
    cursor: "pointer",
    color: "#fff",
    fontSize: 22,
    fontWeight: 900,
    boxShadow: "0 14px 28px rgba(0,0,0,0.12)",
  },
  primaryBtn: {
    background: "linear-gradient(135deg, #2563eb, #3b82f6)",
  },
  darkBtn: {
    background: "linear-gradient(135deg, #0f172a, #334155)",
  },
  orangeBtn: {
    background: "linear-gradient(135deg, #f59e0b, #f97316)",
  },
  greenBtn: {
    background: "linear-gradient(135deg, #10b981, #22c55e)",
  },
  liveStatusCard: {
    background: "rgba(255,255,255,0.95)",
    backdropFilter: "blur(12px)",
    borderRadius: 28,
    padding: 22,
    boxShadow: "0 20px 60px rgba(15,23,42,0.16)",
    marginBottom: 20,
  },
  liveStatusRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 18,
    border: "1px solid #e2e8f0",
    marginBottom: 12,
    flexWrap: "wrap",
  },
  liveStatusLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  statusDot: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    flexShrink: 0,
  },
  recentCard: {
    background: "rgba(255,255,255,0.95)",
    backdropFilter: "blur(12px)",
    borderRadius: 28,
    padding: 22,
    boxShadow: "0 20px 60px rgba(15,23,42,0.16)",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 900,
    color: "#0f172a",
    marginBottom: 14,
  },
  recordRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 0",
    borderBottom: "1px solid #eef2f7",
    gap: 12,
  },
  recordName: {
    fontSize: 16,
    fontWeight: 800,
    color: "#0f172a",
  },
  recordMeta: {
    marginTop: 4,
    fontSize: 12,
    color: "#64748b",
  },
  recordRight: {
    textAlign: "right",
  },
  recordType: {
    fontSize: 13,
    fontWeight: 800,
    color: "#2563eb",
  },
  recordTime: {
    marginTop: 4,
    fontSize: 13,
    color: "#475569",
    fontWeight: 700,
  },
  adminPage: {
    minHeight: "100vh",
    background: "#f8fafc",
    padding: 24,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  adminHeader: {
    maxWidth: 1200,
    margin: "0 auto 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
  },
  adminTitle: {
    fontSize: 32,
    fontWeight: 900,
    color: "#0f172a",
  },
  adminSub: {
    marginTop: 4,
    color: "#64748b",
    fontWeight: 600,
  },
  logoutBtn: {
    border: "none",
    background: "#0f172a",
    color: "#fff",
    padding: "12px 18px",
    borderRadius: 14,
    fontWeight: 800,
    cursor: "pointer",
  },
  adminGrid: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "320px 1fr",
    gap: 20,
  },
  leftCol: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  rightCol: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  panelCard: {
    background: "#fff",
    borderRadius: 24,
    padding: 20,
    boxShadow: "0 12px 30px rgba(15,23,42,0.06)",
    border: "1px solid #e2e8f0",
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: 900,
    color: "#0f172a",
    marginBottom: 14,
  },
  fullMainBtn: {
    width: "100%",
    border: "none",
    background: "linear-gradient(135deg, #2563eb, #3b82f6)",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 14,
    fontWeight: 900,
    cursor: "pointer",
  },
  fullDarkBtn: {
    width: "100%",
    border: "none",
    background: "#0f172a",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 14,
    fontWeight: 900,
    cursor: "pointer",
  },
  fullGreenBtn: {
    width: "100%",
    border: "none",
    background: "#059669",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 14,
    fontWeight: 900,
    cursor: "pointer",
  },
  fullOrangeBtn: {
    width: "100%",
    border: "none",
    background: "#ea580c",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 14,
    fontWeight: 900,
    cursor: "pointer",
    marginTop: 12,
  },
  collapseBtn: {
    width: "100%",
    border: "1px solid #dbeafe",
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "14px 16px",
    borderRadius: 14,
    fontWeight: 900,
    cursor: "pointer",
    textAlign: "left",
  },
  collapseContent: {
    marginTop: 12,
    display: "grid",
    gap: 10,
  },
  historyBlock: {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 12,
    background: "#fafafa",
  },
  historyDate: {
    fontSize: 14,
    fontWeight: 800,
    color: "#111827",
    marginBottom: 6,
  },
  historyItem: {
    fontSize: 13,
    color: "#4b5563",
    lineHeight: 1.7,
  },
  errorMini: {
    marginTop: 6,
    fontSize: 12,
    color: "#b91c1c",
    background: "#fee2e2",
    borderRadius: 10,
    padding: "8px 10px",
  },
  monthInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid #cbd5e1",
    fontSize: 15,
    outline: "none",
    background: "#fff",
  },
  exportDivider: {
    height: 1,
    background: "#e2e8f0",
    margin: "16px 0",
  },
  deviceBox: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  deviceLabel: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: 700,
    marginBottom: 6,
  },
  deviceId: {
    fontSize: 14,
    color: "#0f172a",
    fontWeight: 800,
    wordBreak: "break-all",
  },
  listHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
    flexWrap: "wrap",
  },

  storeSwitchWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  storeSwitchBtn: {
    padding: "10px 16px",
    borderRadius: 999,
    border: "none",
    background: "#f1f5f9",
    color: "#475569",
    fontWeight: 800,
    fontSize: 14,
    cursor: "pointer",
    boxShadow: "inset 0 0 0 1px #e2e8f0",
    transition: "all 0.2s ease",
  },
  storeSwitchBtnActive: {
    background: "linear-gradient(135deg, #60a5fa, #3b82f6)",
    color: "#fff",
    boxShadow: "0 10px 24px rgba(59,130,246,0.28)",
  },
  addEmployeeFullBtn: {
    width: "100%",
    border: "none",
    background: "linear-gradient(135deg, #10b981, #22c55e)",
    color: "#fff",
    padding: "12px 16px",
    borderRadius: 16,
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 15,
    boxShadow: "0 12px 24px rgba(34,197,94,0.22)",
    transition: "all 0.2s ease",
    marginBottom: 14,
  },
  integratedEmployeeCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 12,
    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
    boxShadow: "0 10px 24px rgba(15,23,42,0.04)",
    marginBottom: 10,
  },
  integratedTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    flexWrap: "wrap",
  },
  scheduleCheckWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    flexShrink: 0,
  },
  integratedSchedulePanel: {
    marginTop: 10,
    padding: 10,
    borderRadius: 14,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
  },
  integratedScheduleLabel: {
    fontSize: 13,
    fontWeight: 800,
    color: "#475569",
    marginBottom: 8,
  },
  integratedTimeRow: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
  },
  integratedTimeBox: {
    borderRadius: 12,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    padding: 8,
  },
  integratedTimeTitle: {
    fontSize: 12,
    fontWeight: 800,
    color: "#64748b",
    marginBottom: 4,
  },
  integratedTimeInput: {
    width: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: 16,
    fontWeight: 900,
    color: "#0f172a",
    letterSpacing: 1,
  },
  badge: {
    minWidth: 32,
    height: 32,
    borderRadius: 999,
    background: "#dbeafe",
    color: "#1d4ed8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 13,
    padding: "0 8px",
  },
  employeeRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 0",
    borderBottom: "1px solid #eef2f7",
    gap: 12,
  },
  employeeTopRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  employeeName: {
    fontSize: 16,
    fontWeight: 800,
    color: "#0f172a",
  },
  employeeId: {
    marginTop: 4,
    fontSize: 12,
    color: "#64748b",
    fontWeight: 600,
  },
  statusBadge: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
  },
  actionBtns: {
    display: "flex",
    gap: 8,
    flexShrink: 0,
  },
  editBtn: {
    border: "none",
    background: "#dbeafe",
    color: "#1d4ed8",
    padding: "10px 14px",
    borderRadius: 12,
    fontWeight: 800,
    cursor: "pointer",
  },
  deleteBtn: {
    border: "none",
    background: "#fee2e2",
    color: "#dc2626",
    padding: "10px 14px",
    borderRadius: 12,
    fontWeight: 800,
    cursor: "pointer",
    flexShrink: 0,
  },
  recordToolbar: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
    marginBottom: 14,
  },
  recordFilterInput: {
    width: "100%",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    padding: "12px 14px",
    fontSize: 14,
    outline: "none",
    background: "#fff",
  },
  recordDangerBtn: {
    border: "none",
    borderRadius: 10,
    background: "#fee2e2",
    color: "#b91c1c",
    fontWeight: 800,
    fontSize: 12,
    padding: "8px 12px",
    cursor: "pointer",
    boxShadow: "inset 0 0 0 1px #fecaca",
    justifySelf: "start",
    width: "fit-content",
  },
  exceptionRecordCard: {
    marginTop: 10,
    padding: "12px 14px",
    borderRadius: 16,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },
  exceptionRecordHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  exceptionReasonText: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 12,
    background: "#ffffff",
    color: "#334155",
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  recordMonthGroup: {
    marginTop: 12,
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    overflow: "hidden",
    background: "#ffffff",
  },
  recordMonthButton: {
    width: "100%",
    border: "none",
    padding: "14px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    background: "#f8fafc",
    color: "#0f172a",
    fontSize: 15,
    fontWeight: 900,
    cursor: "pointer",
    textAlign: "left",
  },
  recordMonthCount: {
    color: "#2563eb",
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  recordMonthContent: {
    padding: "0 14px",
  },
  recordAdminRow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    padding: "14px 0",
    borderBottom: "1px solid #eef2f7",
    gap: 10,
    minHeight: 112,
    boxSizing: "border-box",
  },
  recordAdminInfo: {
    width: "100%",
    minWidth: 0,
  },
  recordAdminActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
    flexWrap: "wrap",
  },
  recordAdminRight: {
    textAlign: "right",
    flexShrink: 0,
    minWidth: 90,
  },
  recordTypeBadge: {
    display: "inline-block",
    background: "#e0f2fe",
    color: "#0369a1",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
  },
  emptyText: {
    color: "#94a3b8",
    padding: "12px 0",
    fontWeight: 700,
  },
  storeLabel: {
    fontSize: 13,
    fontWeight: 800,
    color: "#475569",
    marginTop: 12,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottom: "1px solid #e2e8f0",
  },
  scheduleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 0",
    borderBottom: "1px solid #f1f5f9",
  },
  scheduleEmpName: {
    flex: 1,
    fontSize: 14,
    fontWeight: 700,
    color: "#0f172a",
  },
  timeInput: {
    padding: "6px 8px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    fontSize: 14,
    fontWeight: 700,
    outline: "none",
    background: "#fff",
    width: 108,
  },
  scheduleEntryBtn: {
    marginTop: 14,
    border: "1px solid rgba(255,255,255,0.28)",
    background: "linear-gradient(135deg, #0ea5e9, #2563eb)",
    color: "#fff",
    padding: "12px 18px",
    borderRadius: 999,
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(37,99,235,0.25)",
  },
  schedulePublicCard: {
    background: "rgba(255,255,255,0.96)",
    borderRadius: 28,
    padding: 24,
    boxShadow: "0 20px 60px rgba(15,23,42,0.18)",
    border: "1px solid rgba(255,255,255,0.65)",
  },
  schedulePublicHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 18,
  },
  backBtn: {
    border: "none",
    background: "#0f172a",
    color: "#fff",
    padding: "12px 16px",
    borderRadius: 999,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  scheduleFilterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: 900,
    color: "#334155",
    marginBottom: 6,
  },
  scheduleInput: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: 14,
    padding: "13px 14px",
    fontSize: 15,
    outline: "none",
    background: "#fff",
  },
  scheduleSummaryBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    background: "#eff6ff",
    color: "#1d4ed8",
    border: "1px solid #bfdbfe",
    borderRadius: 16,
    padding: "12px 14px",
    fontWeight: 900,
    marginBottom: 16,
  },
  emptyScheduleBox: {
    border: "1px dashed #cbd5e1",
    background: "#f8fafc",
    color: "#64748b",
    borderRadius: 18,
    padding: 28,
    textAlign: "center",
    fontWeight: 800,
  },
  publicScheduleList: {
    display: "grid",
    gap: 10,
  },
  publicScheduleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "16px",
    borderRadius: 18,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 8px 22px rgba(15,23,42,0.05)",
  },
  publicScheduleName: {
    fontSize: 18,
    fontWeight: 950,
    color: "#0f172a",
  },
  publicScheduleMeta: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 13,
    fontWeight: 700,
  },
  publicScheduleTime: {
    background: "linear-gradient(135deg, #dbeafe, #eff6ff)",
    color: "#1d4ed8",
    borderRadius: 999,
    padding: "10px 14px",
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  shareLinkBox: {
    marginTop: 0,
    padding: "12px 14px",
    borderRadius: 14,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#475569",
    fontSize: 12,
    lineHeight: 1.5,
    wordBreak: "break-all",
  },
  announcementModalCard: {
    width: "100%",
    maxWidth: 520,
    background: "#fff",
    borderRadius: 28,
    padding: 26,
    boxShadow: "0 24px 70px rgba(15,23,42,0.28)",
    textAlign: "center",
  },
  announcementIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    margin: "0 auto 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#eff6ff",
    fontSize: 34,
  },
  announcementTitle: {
    fontSize: 26,
    fontWeight: 950,
    color: "#0f172a",
  },
  announcementGreeting: {
    marginTop: 8,
    color: "#047857",
    fontWeight: 900,
  },
  announcementContent: {
    marginTop: 16,
    padding: 18,
    borderRadius: 20,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#334155",
    fontSize: 17,
    fontWeight: 800,
    lineHeight: 1.8,
    textAlign: "left",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  announcementConfirmBtn: {
    width: "100%",
    marginTop: 16,
    border: "none",
    borderRadius: 16,
    padding: "15px 16px",
    background: "linear-gradient(135deg, #2563eb, #3b82f6)",
    color: "#fff",
    fontSize: 17,
    fontWeight: 950,
    cursor: "pointer",
  },
  announcementTextarea: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: 14,
    padding: "13px 14px",
    fontSize: 15,
    lineHeight: 1.7,
    resize: "vertical",
    outline: "none",
    fontFamily: "inherit",
    background: "#fff",
  },
  mealModalCard: {
    width: "100%",
    maxWidth: 430,
    background: "#fff",
    borderRadius: 28,
    padding: 24,
    boxShadow: "0 24px 70px rgba(15,23,42,0.28)",
    textAlign: "center",
  },
  mealModalIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    margin: "0 auto 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#fff7ed",
    fontSize: 32,
  },
  mealModalDesc: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.7,
    marginBottom: 16,
  },
  mealAmountInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "18px 16px",
    borderRadius: 18,
    border: "2px solid #fed7aa",
    outline: "none",
    fontSize: 24,
    fontWeight: 900,
    textAlign: "center",
    marginBottom: 14,
    background: "#fff7ed",
    color: "#0f172a",
  },
  mealModalActions: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  mealNoBtn: {
    border: "none",
    background: "#e2e8f0",
    color: "#334155",
    padding: "14px 16px",
    borderRadius: 16,
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 16,
  },
  mealSaveBtn: {
    border: "none",
    background: "linear-gradient(135deg, #ea580c, #f97316)",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 16,
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 16,
  },
  mealLaterBtn: {
    marginTop: 10,
    border: "none",
    background: "transparent",
    color: "#64748b",
    padding: "10px 12px",
    borderRadius: 14,
    fontWeight: 800,
    cursor: "pointer",
  },

  scoreToastOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    background: "rgba(15,23,42,0.35)",
    backdropFilter: "blur(6px)",
  },
  scoreToastCard: {
    position: "relative",
    width: "min(420px, 100%)",
    borderRadius: 30,
    background: "linear-gradient(180deg, #ffffff, #fff7ed)",
    border: "1px solid rgba(251,146,60,0.35)",
    boxShadow: "0 28px 80px rgba(15,23,42,0.28)",
    padding: "34px 24px 24px",
    textAlign: "center",
  },
  scoreToastClose: {
    position: "absolute",
    top: 14,
    right: 16,
    width: 34,
    height: 34,
    borderRadius: 999,
    border: "none",
    background: "#f1f5f9",
    color: "#64748b",
    fontSize: 24,
    lineHeight: "30px",
    fontWeight: 900,
    cursor: "pointer",
  },
  scoreToastIcon: {
    width: 62,
    height: 62,
    borderRadius: 22,
    margin: "0 auto 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #16a34a, #22c55e)",
    color: "#fff",
    fontSize: 34,
    fontWeight: 950,
    boxShadow: "0 14px 30px rgba(34,197,94,0.28)",
  },
  scoreToastTitle: {
    fontSize: 24,
    fontWeight: 950,
    color: "#0f172a",
    letterSpacing: "-0.02em",
  },
  scoreToastSub: {
    marginTop: 6,
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: 800,
  },
  scoreToastScoreBox: {
    marginTop: 18,
    padding: 18,
    borderRadius: 24,
    background: "#fff",
    border: "1px solid #fed7aa",
    boxShadow: "0 12px 30px rgba(251,146,60,0.12)",
  },
  scoreToastLabel: {
    color: "#ea580c",
    fontSize: 13,
    fontWeight: 950,
    letterSpacing: "0.08em",
  },
  scoreToastScore: {
    marginTop: 4,
    fontSize: 42,
    lineHeight: 1.1,
    fontWeight: 950,
    color: "#c2410c",
  },
  scoreToastDetail: {
    marginTop: 10,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.7,
  },
  scoreToastNotice: {
    marginTop: 18,
    padding: "16px 18px",
    borderRadius: 20,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#475569",
    fontSize: 15,
    fontWeight: 900,
  },
};
