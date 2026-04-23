import React, { useEffect, useMemo, useState } from "react";
import { db, auth } from "./firebase";
import { ref, set, onValue, update, remove } from "firebase/database";
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
    ...scheduleList.map((item) => `• ${item.name} ${item.startTime}`),
  ].join("
");
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

  const myDevice = getDeviceId();

  const [scheduleItems, setScheduleItems] = useState({});
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSent, setScheduleSent] = useState(false);

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

    const recordsRef = ref(db, "records");
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
          next[key] = { working: false, startTime: "06:00" };
        }
      });
      return next;
    });
  }, [employees, isAdmin]);

  useEffect(() => {
    if (!authReady || !isAdmin) return;
    const today = formatTaipeiDateKey();
    const schedRef = ref(db, `schedules/${today}`);
    return onValue(schedRef, (snap) => {
      const data = snap.val() || {};
      setScheduleItems((prev) => {
        const next = { ...prev };
        Object.entries(data).forEach(([empId, schedData]) => {
          next[empId] = {
            working: schedData.working || false,
            startTime: schedData.startTime || "06:00",
          };
        });
        return next;
      });
    });
  }, [authReady, isAdmin]);

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

  const saveAndSendSchedule = async () => {
    setScheduleSaving(true);
    try {
      const today = formatTaipeiDateKey();
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
            working: true,
          };
        }
      });

      await set(
        ref(db, `schedules/${today}`),
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

      const storeNames = Object.keys(groupedByStore);

      for (const storeName of storeNames) {
        const message = buildLineScheduleMessage(
          storeName,
          groupedByStore[storeName],
          today
        );

        const response = await fetch("/api/send-schedule", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            store: storeName,
            message,
            dateKey: today,
            schedule: groupedByStore[storeName],
          }),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result?.success) {
          const errorText = `${storeName}：${result?.error || result?.message || "LINE 發送失敗"}`;
          const detailText = result?.detail ? `｜${result.detail}` : "";
          await set(ref(db, `schedule_notify/${today}`), {
            pending: true,
            createdAt: Date.now(),
            lastError: `${errorText}${detailText}`,
          });
          console.error("send-schedule failed", result);
          throw new Error(`${errorText}${detailText}`);
        }
      }

      await set(ref(db, `schedule_notify/${today}`), {
        pending: false,
        sentAt: Date.now(),
        source: "saveAndSendSchedule",
        stores: storeNames,
      });

      setScheduleSent(true);
      setTimeout(() => setScheduleSent(false), 4000);
      alert(storeNames.length ? `班表已成功傳送：${storeNames.join("、")}` : "今日沒有排班，已完成儲存");
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
            <div style={styles.panelTitle}>今日排班</div>

            {Object.keys(storeGroups).length === 0 ? (
              <div style={styles.emptyText}>尚無員工資料</div>
            ) : (
              Object.entries(storeGroups).map(([storeName, storeEmps]) => (
                <div key={storeName}>
                  <div style={styles.storeLabel}>{storeName}</div>
                  {storeEmps.map((emp) => {
                    const key = emp.empId || emp.id;
                    const item = scheduleItems[key] || {
                      working: false,
                      startTime: "06:00",
                    };
                    return (
                      <div key={key} style={styles.scheduleRow}>
                        <input
                          type="checkbox"
                          checked={!!item.working}
                          onChange={() => toggleScheduleWorking(key)}
                          style={{ width: 18, height: 18, cursor: "pointer", flexShrink: 0 }}
                        />
                        <span style={styles.scheduleEmpName}>{emp.name}</span>
                        <input
                          type="time"
                          value={item.startTime || "06:00"}
                          onChange={(e) => setScheduleTime(key, e.target.value)}
                          disabled={!item.working}
                          style={{
                            ...styles.timeInput,
                            opacity: item.working ? 1 : 0.35,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              ))
            )}

            <button
              style={{
                ...styles.fullMainBtn,
                marginTop: 16,
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
                ? "✓ 班表已傳送"
                : "儲存並傳送班表"}
            </button>
          </div>

          <div style={styles.panelCard}>
            <div style={styles.listHeader}>
              <div style={styles.panelTitle}>員工管理</div>
            </div>
            <button style={styles.fullMainBtn} onClick={() => setShowAddModal(true)}>
              ＋ 新增員工
            </button>
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
        </div>

        <div style={styles.rightCol}>
          <div style={styles.panelCard}>
            <div style={styles.listHeader}>
              <div style={styles.panelTitle}>員工名單</div>
              <div style={styles.badge}>{employees.length}</div>
            </div>

            {employees.length === 0 ? (
              <div style={styles.emptyText}>目前沒有員工資料</div>
            ) : (
              employees.map((emp) => {
                const statusStyle = getStatusStyle(emp.status || "未打卡");
                return (
                  <div key={emp.id} style={styles.employeeRow}>
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
                    <div style={styles.actionBtns}>
                      <button
                        style={styles.editBtn}
                        onClick={() => openEdit(emp)}
                      >
                        編輯
                      </button>
                      <button
                        style={styles.deleteBtn}
                        onClick={() => deleteEmployee(emp)}
                      >
                        停用
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={styles.panelCard}>
            <div style={styles.listHeader}>
              <div style={styles.panelTitle}>打卡紀錄</div>
              <div style={styles.badge}>{records.length}</div>
            </div>

            {records.length === 0 ? (
              <div style={styles.emptyText}>目前沒有打卡紀錄</div>
            ) : (
              records.map((r) => (
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
