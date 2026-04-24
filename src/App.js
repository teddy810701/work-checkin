import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "./firebase";
import { ref, set, onValue, update, remove, get, query, orderByChild, limitToLast } from "firebase/database";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";

const ADMIN_PASSWORD = "8888";
const CHECKIN_COOLDOWN = 30000;

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

const getMonthValue = (ts = Date.now()) => {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
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

const buildLateLineMessage = (storeName, lateList, dateKey, reason = "") => {
  const title = `⚠️ ${dateKey} ${storeName} 遲到提醒`;
  const reasonText = reason ? `觸發來源：${reason}` : "";

  return [
    title,
    reasonText,
    ...lateList.map((item) => {
      const statusText = item.status === "not_checked"
        ? "超過 1 分鐘尚未打上班卡"
        : `上班打卡 ${item.actualTime}，已超過排班時間`;
      return `• ${item.name}（${item.empId}）排班 ${item.startTime}｜${statusText}`;
    }),
  ].filter(Boolean).join("\n");
};


export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [employeeId, setEmployeeId] = useState("");

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

  const [authorizedDevice, setAuthorizedDevice] = useState("");
  const [nowTime, setNowTime] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(getMonthValue());
  const [recordSearch, setRecordSearch] = useState("");

  const myDevice = getDeviceId();
  const lateCheckRunningRef = useRef(false);

  const [scheduleItems, setScheduleItems] = useState({});
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSent, setScheduleSent] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(formatTaipeiDateKey());
  const [publishStore, setPublishStore] = useState("西螺文昌店");
  const [adminStoreTab, setAdminStoreTab] = useState("全部");
  const [scheduleHistory, setScheduleHistory] = useState({});
  const [scheduleNotifyHistory, setScheduleNotifyHistory] = useState({});
  const [lineStatus, setLineStatus] = useState({});
  const [adminPanels, setAdminPanels] = useState({
    scheduleHistory: false,
    lateCheck: false,
    lineQuery: false,
  });

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

    const recordsRef = query(ref(db, "records"), orderByChild("createdAt"), limitToLast(50));
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
      const data = snap.val();
      setAuthorizedDevice(data?.id || "");
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
          next[key] = { working: false, startTime: "06:00", endTime: "14:00" };
        }
      });
      return next;
    });
  }, [employees, isAdmin]);

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
          next[key] = { working: false, startTime: "06:00", endTime: "14:00" };
        });
        Object.entries(data).forEach(([empId, schedData]) => {
          next[empId] = {
            working: schedData.working || false,
            startTime: schedData.startTime || "06:00",
            endTime: schedData.endTime || "14:00",
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
    if (!authReady || !isAdmin) return;
    const notifyRef = ref(db, "schedule_notify");
    return onValue(notifyRef, (snap) => {
      setScheduleNotifyHistory(snap.val() || {});
    });
  }, [authReady, isAdmin]);

  useEffect(() => {
    if (!authReady || !isAdmin) return;
    const lineStatusRef = ref(db, "line_status");
    return onValue(lineStatusRef, (snap) => {
      setLineStatus(snap.val() || {});
    });
  }, [authReady, isAdmin]);

  useEffect(() => {
    if (!authReady) return;
    triggerAutoLateCheck("app-open");
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;

    const timer = setInterval(() => {
      triggerAutoLateCheck("auto-timer");
    }, 60000);

    return () => clearInterval(timer);
  }, [authReady]);

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
        };
      }
    });

    return Object.values(map).sort((a, b) => {
      const statusOrder = { "上班中": 0, "休息中": 1, "已下班": 2, "未打卡": 3 };
      const orderA = statusOrder[a.status] ?? 9;
      const orderB = statusOrder[b.status] ?? 9;
      if (orderA !== orderB) return orderA - orderB;
      return (a.empId || "").localeCompare(b.empId || "");
    });
  }, [employees, todayRecords]);

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
            startTime: item.startTime || "06:00",
            endTime: item.endTime || "14:00",
            working: true,
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

      const groupedByStore = scheduleList.reduce((acc, item) => {
        const storeName = item.store || "未填店名";
        if (!acc[storeName]) acc[storeName] = [];
        acc[storeName].push(item);
        return acc;
      }, {});

      const targetStoreName = publishStore;
      const targetScheduleList = groupedByStore[targetStoreName] || [];

      if (!targetScheduleList.length) {
        alert(`${targetStoreName} 在 ${targetDate} 沒有排班，已完成儲存`);
        return;
      }

      const message = buildLineScheduleMessage(
        targetStoreName,
        targetScheduleList,
        targetDate
      );

      const response = await fetch("/api/send-schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          store: targetStoreName,
          message,
          dateKey: targetDate,
          schedule: targetScheduleList,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result?.success) {
        const errorText = `${targetStoreName}：${result?.error || result?.message || "LINE 發送失敗"}`;
        const detailText = result?.detail ? `｜${result.detail}` : "";
        await set(ref(db, `schedule_notify/${targetDate}`), {
          pending: true,
          createdAt: Date.now(),
          lastError: `${errorText}${detailText}`,
          targetStore: targetStoreName,
        });
        console.error("send-schedule failed", result);
        throw new Error(`${errorText}${detailText}`);
      }

      await set(ref(db, `schedule_notify/${targetDate}`), {
        pending: false,
        sentAt: Date.now(),
        source: "saveAndSendSchedule",
        stores: [targetStoreName],
        targetStore: targetStoreName,
      });

      setScheduleSent(true);
      setTimeout(() => setScheduleSent(false), 4000);
      alert(`班表已成功傳送：${targetStoreName}（${targetDate}）`);
    } catch (err) {
      alert(`班表已儲存，但 LINE 發送失敗：${err.message}`);
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

  const checkIn = async (type) => {
    if (myDevice !== authorizedDevice) {
      alert("此設備未授權");
      return;
    }

    const inputId = employeeId.trim().toUpperCase();
    const emp = employees.find((e) => e.id === inputId || e.empId === inputId);

    if (!emp) {
      alert("找不到工號");
      return;
    }

    if (!isValidTransition(emp.status, type)) {
      alert(`目前狀態為「${emp.status || "未打卡"}」，不能執行「${type}」`);
      return;
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

    await set(ref(db, `records/${recordId}`), {
      empId: emp.empId || emp.id,
      name: emp.name,
      store: emp.store || "",
      role: emp.role || "",
      type,
      time: now.toLocaleTimeString("zh-TW", { hour12: false }),
      date: now.toLocaleDateString("zh-TW"),
      dateKey: formatTaipeiDateKey(createdAt),
      device: myDevice,
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
    if (type === "上班") {
      triggerAutoLateCheck("checkin");
    }
    alert(`${emp.name} ${type}成功`);
  };

  const bindDevice = async () => {
    await set(ref(db, "config/device"), {
      id: myDevice,
      boundAt: Date.now(),
    });
    alert("此設備已綁定成功");
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

  const exportAllCSV = () => {
    if (!records.length) {
      alert("目前沒有紀錄可匯出");
      return;
    }

    const header = ["員工姓名", "工號", "店名", "身分", "類型", "日期", "時間", "設備"];
    const rows = records.map((r) => [
      r.name || "",
      r.empId || "",
      r.store || "",
      r.role || "",
      r.type || "",
      r.date || "",
      r.time || "",
      r.device || "",
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "打卡紀錄.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const monthRecords = useMemo(() => {
    return records.filter((r) => {
      const key = r.monthKey || getMonthValue(r.createdAt || Date.now());
      return key === selectedMonth;
    });
  }, [records, selectedMonth]);

  const exportMonthlyCSV = () => {
    if (!monthRecords.length) {
      alert("本月沒有統計資料可匯出");
      return;
    }

    const map = {};

    employees.forEach((emp) => {
      const key = emp.empId || emp.id;
      map[key] = {
        empId: key,
        name: emp.name || "",
        store: emp.store || "",
        role: emp.role || "",
        workIn: 0,
        workOut: 0,
        breakStart: 0,
        breakEnd: 0,
        totalRecords: 0,
        lastRecordAt: 0,
      };
    });

    monthRecords.forEach((r) => {
      const key = r.empId || r.id || "UNKNOWN";
      if (!map[key]) {
        map[key] = {
          empId: key,
          name: r.name || "",
          store: r.store || "",
          role: r.role || "",
          workIn: 0,
          workOut: 0,
          breakStart: 0,
          breakEnd: 0,
          totalRecords: 0,
          lastRecordAt: 0,
        };
      }

      map[key].totalRecords += 1;
      map[key].lastRecordAt = Math.max(map[key].lastRecordAt, r.createdAt || 0);

      if (r.type === "上班") map[key].workIn += 1;
      if (r.type === "下班") map[key].workOut += 1;
      if (r.type === "休息開始") map[key].breakStart += 1;
      if (r.type === "休息結束") map[key].breakEnd += 1;
    });

    const stats = Object.values(map).sort((a, b) => {
      if (b.totalRecords !== a.totalRecords) return b.totalRecords - a.totalRecords;
      return a.empId.localeCompare(b.empId);
    });

    const header = ["月份", "員工姓名", "工號", "店名", "身分", "上班次數", "下班次數", "休息開始", "休息結束", "總筆數", "最後打卡日"];
    const rows = stats.map((item) => [
      selectedMonth,
      item.name,
      item.empId,
      item.store,
      item.role,
      item.workIn,
      item.workOut,
      item.breakStart,
      item.breakEnd,
      item.totalRecords,
      formatDate(item.lastRecordAt),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `打卡月報表-${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const toggleAdminPanel = (key) => {
    setAdminPanels((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const runClientLateCheck = async (reason = "") => {
    if (lateCheckRunningRef.current) return;

    lateCheckRunningRef.current = true;

    try {
      const dateKey = formatTaipeiDateKey();
      const nowTs = Date.now();
      const graceMs = 60 * 1000;

      const [scheduleSnap, recordsSnap, sentSnap] = await Promise.all([
        get(ref(db, `schedules/${dateKey}`)),
        get(ref(db, "records")),
        get(ref(db, `line_status/attendance_sent/${dateKey}`)),
      ]);

      const scheduleData = scheduleSnap.val() || {};
      const recordsData = recordsSnap.val() || {};
      const sentData = sentSnap.val() || {};

      const todayWorkInRecords = Object.values(recordsData)
        .filter((record) => {
          const recordDateKey = record?.dateKey || (record?.createdAt ? formatTaipeiDateKey(record.createdAt) : "");
          return recordDateKey === dateKey && record?.type === "上班";
        })
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

      const firstWorkInByEmp = {};
      todayWorkInRecords.forEach((record) => {
        const empId = record?.empId || "";
        if (!empId) return;
        if (!firstWorkInByEmp[empId]) {
          firstWorkInByEmp[empId] = record;
        }
      });

      const lateByStore = {};

      Object.entries(scheduleData).forEach(([empIdFromKey, item]) => {
        if (!item?.working) return;

        const empId = item.empId || empIdFromKey;
        const startTime = item.startTime || "06:00";
        const startTs = getTaipeiTimestampFromDateTime(dateKey, startTime);
        if (!startTs) return;

        const shouldCheckTs = startTs + graceMs;
        if (nowTs < shouldCheckTs) return;

        const storeName = item.store || "未填店名";
        const sentStoreKey = safeFirebaseKey(storeName);
        const sentEmpKey = safeFirebaseKey(empId);
        if (sentData?.[sentStoreKey]?.[sentEmpKey]?.sent) return;

        const workInRecord = firstWorkInByEmp[empId];
        const actualTs = workInRecord?.createdAt || 0;
        const isNotChecked = !workInRecord;
        const isLateCheckedIn = actualTs > shouldCheckTs;

        if (!isNotChecked && !isLateCheckedIn) return;

        if (!lateByStore[storeName]) lateByStore[storeName] = [];
        lateByStore[storeName].push({
          empId,
          name: item.name || empId,
          store: storeName,
          startTime,
          actualTime: workInRecord?.time || "未打卡",
          status: isNotChecked ? "not_checked" : "late_checked_in",
        });
      });

      const entries = Object.entries(lateByStore);
      if (!entries.length) return;

      for (const [storeName, lateList] of entries) {
        const message = buildLateLineMessage(storeName, lateList, dateKey, reason);

        const response = await fetch("/api/send-schedule", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            store: storeName,
            message,
            dateKey,
            type: "late_notice",
            lateList,
          }),
        });

        const result = await response.json().catch(() => ({}));
        const sent = response.ok && result?.success;
        const sentAt = Date.now();
        const sentStoreKey = safeFirebaseKey(storeName);
        const updatePayload = {};

        lateList.forEach((item) => {
          const sentEmpKey = safeFirebaseKey(item.empId);
          updatePayload[`line_status/attendance_sent/${dateKey}/${sentStoreKey}/${sentEmpKey}`] = {
            sent,
            sentAt,
            dateKey,
            store: storeName,
            empId: item.empId,
            name: item.name,
            startTime: item.startTime,
            actualTime: item.actualTime,
            status: item.status,
            reason,
            result: sent ? "已發送" : "發送失敗",
            error: sent ? "" : (result?.error || result?.message || "LINE 發送失敗"),
          };
        });

        updatePayload[`line_status/manual_late_checks/${dateKey}_${safeFirebaseKey(reason || "auto")}_${sentStoreKey}_${sentAt}`] = {
          checkedAt: sentAt,
          sentAt,
          sent,
          dateKey,
          store: storeName,
          names: lateList.map((item) => item.name),
          result: sent ? "已發送" : "發送失敗",
          reason,
          error: sent ? "" : (result?.error || result?.message || "LINE 發送失敗"),
        };

        await update(ref(db), updatePayload);
      }
    } catch (error) {
      console.error("client late check failed:", error);
    } finally {
      lateCheckRunningRef.current = false;
    }
  };

  const triggerAutoLateCheck = async (reason = "") => {
    try {
      await fetch("/api/auto-check-late", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason }),
      });
    } catch (error) {
      console.error("auto-check-late api failed:", error);
    }

    // 前端補強：即使 Vercel /api/auto-check-late 尚未建立或沒有排程，
    // 只要有人打開打卡頁或有人上班打卡，就會立即檢查當天班表並發送遲到通知。
    await runClientLateCheck(reason);
  };

  const historyScheduleDates = useMemo(() => {
    return Object.keys(scheduleHistory || {}).sort((a, b) => b.localeCompare(a));
  }, [scheduleHistory]);

  const lateNoticeEntries = useMemo(() => {
    const attendanceSent = lineStatus?.attendance_sent || {};
    const manualChecks = lineStatus?.manual_late_checks || {};

    return [
      ...Object.entries(attendanceSent).map(([key, value]) => ({
        id: `attendance-${key}`,
        dateKey: key,
        type: "自動遲到通知",
        ...value,
      })),
      ...Object.entries(manualChecks).map(([key, value]) => ({
        id: `manual-${key}`,
        dateKey: value?.dateKey || key,
        type: "手動遲到檢查",
        ...value,
      })),
    ].sort((a, b) => (b.sentAt || b.checkedAt || 0) - (a.sentAt || a.checkedAt || 0));
  }, [lineStatus]);

  const lineQueryEntries = useMemo(() => {
    const scheduleSent = lineStatus?.schedule_sent || {};
    const scheduleNotify = scheduleNotifyHistory || {};

    return [
      ...Object.entries(scheduleSent).map(([key, value]) => ({
        id: `staff-${key}`,
        dateKey: key,
        type: "班表推播",
        ...value,
      })),
      ...Object.entries(scheduleNotify).map(([key, value]) => ({
        id: `notify-${key}`,
        dateKey: key,
        type: "發布紀錄",
        ...value,
      })),
    ].sort((a, b) => (b.sentAt || b.createdAt || 0) - (a.sentAt || a.createdAt || 0));
  }, [lineStatus, scheduleNotifyHistory]);


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

  if (!isAdmin) {
    return (
      <div style={styles.page}>
        <div style={styles.overlay} />

        <div style={styles.topRightBar}>
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
              <div style={styles.brandTitle}>店面打卡系統</div>
              <div style={styles.brandSub}>Store Check-in Terminal</div>
            </div>
          </div>

          <div style={styles.kioskCard}>
            <div style={styles.kioskHeader}>
              <h1 style={styles.kioskTitle}>員工打卡入口</h1>
              <p style={styles.kioskDesc}>請輸入員工工號後打卡</p>
            </div>

            <div style={styles.timeBox}>台北標準時間：{nowTime}</div>

            {myDevice !== authorizedDevice && (
              <div style={styles.warningBox}>
                此設備尚未授權，請先由管理員進入後台綁定設備。
              </div>
            )}

            <input
              style={styles.bigInput}
              placeholder="請輸入工號"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") checkIn("上班");
              }}
            />

            <div style={styles.btnGridFour}>
              <button
                style={{
                  ...styles.actionBtn,
                  ...styles.primaryBtn,
                  opacity: myDevice !== authorizedDevice ? 0.5 : 1,
                }}
                onClick={() => checkIn("上班")}
              >
                上班打卡
              </button>

              <button
                style={{
                  ...styles.actionBtn,
                  ...styles.darkBtn,
                  opacity: myDevice !== authorizedDevice ? 0.5 : 1,
                }}
                onClick={() => checkIn("下班")}
              >
                下班打卡
              </button>

              <button
                style={{
                  ...styles.actionBtn,
                  ...styles.orangeBtn,
                  opacity: myDevice !== authorizedDevice ? 0.5 : 1,
                }}
                onClick={() => checkIn("休息開始")}
              >
                休息開始
              </button>

              <button
                style={{
                  ...styles.actionBtn,
                  ...styles.greenBtn,
                  opacity: myDevice !== authorizedDevice ? 0.5 : 1,
                }}
                onClick={() => checkIn("休息結束")}
              >
                休息結束
              </button>
            </div>
          </div>

          <div style={styles.liveStatusCard}>
            <div style={styles.sectionTitle}>今日上班／休息狀態</div>
            {liveStatusList.length === 0 ? (
              <div style={styles.emptyText}>目前沒有員工資料</div>
            ) : (
              liveStatusList.map((emp) => {
                const statusStyle = getStatusStyle(emp.status);
                return (
                  <div
                    key={emp.empId}
                    style={{
                      ...styles.liveStatusRow,
                      borderColor: statusStyle.border,
                      background: statusStyle.background,
                    }}
                  >
                    <div style={styles.liveStatusLeft}>
                      <span
                        style={{
                          ...styles.statusDot,
                          background: statusStyle.dot,
                          boxShadow: `0 0 14px ${statusStyle.dot}`,
                        }}
                      />
                      <div>
                        <div style={styles.employeeName}>{emp.name}</div>
                        <div style={styles.employeeId}>
                          {emp.empId} ・ {emp.store || "未填店名"} ・ {emp.role || "未設定"}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        ...styles.statusBadge,
                        background: "#ffffffcc",
                        color: statusStyle.color,
                      }}
                    >
                      {emp.status}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={styles.recentCard}>
            <div style={styles.sectionTitle}>近期打卡紀錄</div>
            {recentRecords.length === 0 ? (
              <div style={styles.emptyText}>目前尚無紀錄</div>
            ) : (
              recentRecords.map((r) => (
                <div key={r.id} style={styles.recordRow}>
                  <div>
                    <div style={styles.recordName}>{r.name}</div>
                    <div style={styles.recordMeta}>
                      {r.empId} ・ {r.date} ・ {r.store || "未填店名"}
                    </div>
                  </div>
                  <div style={styles.recordRight}>
                    <div style={styles.recordType}>{r.type}</div>
                    <div style={styles.recordTime}>{r.time}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.adminPage}>
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

      <div style={styles.adminHeader}>
        <div>
          <div style={styles.adminTitle}>管理後台</div>
          <div style={styles.adminSub}>員工、設備、紀錄、月報表匯出管理中心</div>
        </div>
        <button style={styles.logoutBtn} onClick={logout}>
          離開管理模式
        </button>
      </div>

      <div style={styles.adminGrid}>
        <div style={styles.leftCol}>
          <div style={styles.panelCard}>
            <div style={styles.listHeader}>
              <div style={styles.panelTitle}>班表發布</div>
              <div style={styles.badge}>{adminStoreTab === "全部" ? publishStore : adminStoreTab}</div>
            </div>

            <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.7, marginTop: 6 }}>
              排班設定已整合進員工名單，直接在右側員工卡上勾選上班與調整上下班時間。
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
                  ? "傳送中…"
                  : scheduleSent
                  ? `✓ ${publishStore} ${scheduleDate} 已傳送`
                  : `儲存並傳送 ${publishStore} ${scheduleDate}`}
              </button>
            </div>
          </div>

          <div style={styles.panelCard}>
            <div style={styles.panelTitle}>設備設定</div>
            <div style={styles.deviceBox}>
              <div style={styles.deviceLabel}>目前設備 ID</div>
              <div style={styles.deviceId}>{myDevice}</div>
            </div>
            <div style={styles.deviceBox}>
              <div style={styles.deviceLabel}>已授權設備</div>
              <div style={styles.deviceId}>
                {authorizedDevice || "尚未綁定"}
              </div>
            </div>
            <button style={styles.fullDarkBtn} onClick={bindDevice}>
              綁定這台設備
            </button>
          </div>

          <div style={styles.panelCard}>
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
              匯出月報表 Excel
            </button>
          </div>

          <div style={styles.panelCard}>
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
                      const storeName = item.store || "未填店名";
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
                                    {item.name}｜{item.startTime || "未填"} - {item.endTime || "未填"}
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

          <div style={styles.panelCard}>
            <button style={styles.collapseBtn} onClick={() => toggleAdminPanel("lateCheck")}>
              自動抓遲到 {adminPanels.lateCheck ? "－" : "＋"}
            </button>
            {adminPanels.lateCheck ? (
              <div style={styles.collapseContent}>
                <div style={styles.historyItem}>系統會依班表自動抓遲到，超過 1 分鐘未打上班卡就通知對應店長群組。</div>
                <div style={{ ...styles.deviceLabel, marginTop: 14 }}>遲到通知紀錄</div>
                {lateNoticeEntries.length === 0 ? (
                  <div style={styles.emptyText}>目前沒有遲到通知紀錄</div>
                ) : (
                  lateNoticeEntries.slice(0, 12).map((item) => (
                    <div key={item.id} style={styles.historyBlock}>
                      <div style={styles.historyDate}>
                        {item.type}｜{item.store || item.dateKey || "未分類"}
                      </div>
                      <div style={styles.historyItem}>時間：{formatDateTime(item.sentAt || item.checkedAt)}</div>
                      <div style={styles.historyItem}>結果：{item.result || (item.sent ? "已發送" : "未發送")}</div>
                      {Array.isArray(item.names) && item.names.length ? (
                        <div style={styles.historyItem}>名單：{item.names.join("、")}</div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div style={styles.panelCard}>
            <button style={styles.collapseBtn} onClick={() => toggleAdminPanel("lineQuery")}>
              LINE 查詢頁 {adminPanels.lineQuery ? "－" : "＋"}
            </button>
            {adminPanels.lineQuery ? (
              <div style={styles.collapseContent}>
                {lineQueryEntries.length === 0 ? (
                  <div style={styles.emptyText}>目前沒有 LINE 發送紀錄</div>
                ) : (
                  lineQueryEntries.slice(0, 14).map((item) => (
                    <div key={item.id} style={styles.historyBlock}>
                      <div style={styles.historyDate}>{item.type}｜{item.targetStore || item.store || item.dateKey}</div>
                      <div style={styles.historyItem}>時間：{formatDateTime(item.sentAt || item.createdAt)}</div>
                      <div style={styles.historyItem}>狀態：{item.pending ? "待處理" : item.sent === false ? "未發送" : "已發送"}</div>
                      {item.lastError ? <div style={styles.errorMini}>錯誤：{item.lastError}</div> : null}
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div style={styles.rightCol}>
          <div style={styles.panelCard}>
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
                    startTime: "06:00",
                    endTime: "14:00",
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
                              工號：{emp.empId || emp.id} ・ {emp.store || "未填店名"} ・ {emp.role || "未設定"}
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

                        <div style={styles.integratedTimeRow}>
                          <div style={{ ...styles.integratedTimeBox, opacity: item.working ? 1 : 0.45 }}>
                            <div style={styles.integratedTimeTitle}>上班</div>
                            <input
                              type="time"
                              value={item.startTime || "06:00"}
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

          <div style={styles.panelCard}>
            <div style={styles.listHeader}>
              <div style={styles.panelTitle}>打卡紀錄</div>
              <div style={styles.badge}>最新 {records.length} 筆</div>
            </div>

            <div style={styles.recordToolbar}>
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
              adminFilteredRecords.map((r) => (
                <div key={r.id} style={styles.recordAdminRow}>
                  <div>
                    <div style={styles.employeeName}>{r.name}</div>
                    <div style={styles.employeeId}>
                      {r.empId} ・ {r.store || "未填店名"} ・ {r.role || "未設定"} ・ {r.date}
                    </div>
                  </div>
                  <div style={styles.recordAdminActions}>
                    <div style={styles.recordAdminRight}>
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
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
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
    borderRadius: 22,
    padding: 18,
    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
    boxShadow: "0 10px 24px rgba(15,23,42,0.04)",
    marginBottom: 14,
  },
  integratedTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },
  scheduleCheckWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    flexShrink: 0,
  },
  integratedSchedulePanel: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
  },
  integratedScheduleLabel: {
    fontSize: 13,
    fontWeight: 800,
    color: "#475569",
    marginBottom: 10,
  },
  integratedTimeRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  integratedTimeBox: {
    borderRadius: 16,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    padding: 12,
  },
  integratedTimeTitle: {
    fontSize: 12,
    fontWeight: 800,
    color: "#64748b",
    marginBottom: 6,
  },
  integratedTimeInput: {
    width: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: 24,
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
  recordAdminRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 0",
    borderBottom: "1px solid #eef2f7",
    gap: 12,
    flexWrap: "wrap",
  },
  recordAdminActions: {
    display: "flex",
    alignItems: "center",
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
};
