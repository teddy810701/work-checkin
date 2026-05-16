/* eslint-disable */
import { db, auth } from './firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc
} from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  PlusCircle,
  AlertTriangle,
  ShieldCheck,
  History,
  Calendar,
  Store,
  Trash2,
  Lock,
  Edit3,
  X,
  Search,
  ArrowRight,
  RotateCcw,
  Save,
  Settings,
  CheckCircle2,
  Cloud,
  Clock3,
  Utensils
} from 'lucide-react';

const App = () => {
  const DEFAULT_INITIAL_POINTS = 600;
  const MONTHLY_BASE_POINTS = 50;
  const GLOBAL_BASE_BONUS = 600;

  const STORE_CONFIG = {
    storeA: { label: '西螺文昌店', managerKey: 'managerA' },
    storeB: { label: '斗南站前店', managerKey: 'managerB' }
  };

  const PERFORMANCE_ITEMS = {
    penalty: [
      { label: '遲到 (預設1分/可修改)', val: -1 },
      { label: '延遲開工 (15分以上)', val: -10 },
      { label: '工作態度不佳 (不服管教)', val: -5 },
      { label: '作業失誤-輕 (漏餐具等)', val: -2 },
      { label: '作業失誤-重 (燒焦/客訴)', val: -5 },
      { label: '環境責任 (收班不確實)', val: -3 },
      { label: '服儀不整', val: -2 },
      { label: '其他扣分事項', val: -1 }
    ],
    bonus: [
      { label: '申請打掃環境', val: 2 },
      { label: '支援另一間店', val: 1 },
      { label: '獲得顧客五星評論', val: 2 },
      { label: '表現優異 (店長推薦)', val: 5 },
      { label: '其他加分事項', val: 1 }
    ]
  };

  const [employees, setEmployees] = useState([]);
  const [logs, setLogs] = useState([]);

  const [activeTab, setActiveTab] = useState('employee');
  const [selectedEmpId, setSelectedEmpId] = useState(null);

  const [authMode, setAuthMode] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [managerLoginKey, setManagerLoginKey] = useState('managerA');
  const [currentManager, setCurrentManager] = useState(null);

  const [selectedItemLabel, setSelectedItemLabel] = useState('');
  const [customPoints, setCustomPoints] = useState('0');
  const [occurrenceDate, setOccurrenceDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [note, setNote] = useState('');
  const [systemMessage, setSystemMessage] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(
    new Date().toISOString().substring(0, 7)
  );
  const [personalLogCategory, setPersonalLogCategory] = useState('all');
  const [personalLogSearch, setPersonalLogSearch] = useState('');
  const [editingEmp, setEditingEmp] = useState(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [deletingEmpId, setDeletingEmpId] = useState(null);

  const [authConfig, setAuthConfig] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);

  const [passwordPanel, setPasswordPanel] = useState({
    adminPassword: '',
    managerAName: '店長A',
    managerAPassword: '',
    managerBName: '店長B',
    managerBPassword: ''
  });
  const [savingPassword, setSavingPassword] = useState(false);
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminStoreFilter, setAdminStoreFilter] = useState('all');
  const [adminStatusFilter, setAdminStatusFilter] = useState('all');

  const [missedClockForm, setMissedClockForm] = useState({
    requestDate: new Date().toISOString().split('T')[0],
    requestTime: '',
    reason: ''
  });

  const getStoreLabel = useCallback(
    (storeId) => STORE_CONFIG[storeId]?.label || storeId || '未設定店鋪',
    []
  );

  const currentStoreId = currentManager?.storeId || null;

  const normalizeBirthdayId = (value) => {
    return String(value || '').replace(/\D/g, '').slice(0, 4);
  };

  const showMessage = (text, type = 'info') => {
    setSystemMessage({ text, type });
    setTimeout(() => setSystemMessage(null), 3000);
  };

  const formatDate = (value) => {
    if (!value) return '';

    if (typeof value === 'string') {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('zh-TW');
      return value;
    }

    if (value?.toDate) {
      return value.toDate().toLocaleDateString('zh-TW');
    }

    if (value?.seconds) {
      return new Date(value.seconds * 1000).toLocaleDateString('zh-TW');
    }

    return String(value);
  };


  const formatDateTime = (value) => {
    const d = toJsDate(value);
    if (!d || Number.isNaN(d.getTime())) return value || '';
    return d.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const toJsDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;

    if (typeof value === 'string') {
      const raw = value.trim();

      // Safari / 手機瀏覽器對 2026/5/9、2026-5-9、2026-05-09T08:30
      // 的解析有時不穩，統一手動轉成台灣本地時間，排序才不會亂。
      const match = raw.match(
        /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/
      );

      if (match) {
        const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
        return new Date(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          Number(second)
        );
      }

      return new Date(raw);
    }

    if (value?.toDate) return value.toDate();
    if (value?.seconds) return new Date(value.seconds * 1000);
    return new Date(value);
  };

  const getLogSortTime = (log) => {
    // 先用實際建立時間排序；如果舊資料沒有 timestamp，再用發生日期。
    // 同一天多筆資料時，timestamp 可以讓最新新增的紀錄排在前面。
    const mainTime = toJsDate(
      log?.timestamp ||
        log?.requestDateTime ||
        log?.createdAt ||
        log?.occurrenceDate
    )?.getTime();

    if (Number.isFinite(mainTime)) return mainTime;

    const fallbackTime = toJsDate(log?.occurrenceDate)?.getTime();
    return Number.isFinite(fallbackTime) ? fallbackTime : 0;
  };

  const sortLogsByNewestFirst = (list) => {
    return [...list].sort((a, b) => getLogSortTime(b) - getLogSortTime(a));
  };

  const getPersonalLogCategory = (log) => {
    const actionType = String(log?.actionType || '');
    const reason = String(log?.reason || '');
    const amount = Number(log?.amount) || 0;

    if (actionType.includes('missed_clock') || reason.includes('忘打卡')) {
      return 'missedClock';
    }

    if (actionType === 'score_change' || actionType === 'delete_score_change' || amount !== 0) {
      return 'score';
    }

    return 'other';
  };

  const getPersonalLogCategoryLabel = (category) => {
    if (category === 'score') return '加扣分';
    if (category === 'missedClock') return '忘打卡';
    return '其他';
  };

  const getPersonalLogCategoryClass = (category) => {
    if (category === 'score') return 'bg-blue-50 text-blue-600 border-blue-100';
    if (category === 'missedClock') return 'bg-orange-50 text-orange-600 border-orange-100';
    return 'bg-gray-100 text-gray-500 border-gray-200';
  };

  const getCurrentYear = () => new Date().getFullYear();

  const getLogDate = (log) => {
    return toJsDate(log?.occurrenceDate || log?.timestamp);
  };

  const getLogYear = (log) => {
    const d = getLogDate(log);
    if (!d || Number.isNaN(d.getTime())) return null;
    return d.getFullYear();
  };

  const getMonthKeyFromDate = (value) => {
    const d = toJsDate(value);
    if (!d || Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const getCurrentMonthKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  const calculateSeniority = (startDate) => {
    if (!startDate) {
      return { years: 0, months: 0, isEligible: false, text: '未設定' };
    }

    const start = toJsDate(startDate);
    if (!start || Number.isNaN(start.getTime())) {
      return { years: 0, months: 0, isEligible: false, text: '未設定' };
    }

    const now = new Date();

    let years = now.getFullYear() - start.getFullYear();
    const anniversaryThisYear = new Date(start);
    anniversaryThisYear.setFullYear(now.getFullYear());

    if (now < anniversaryThisYear) years--;

    let months = now.getMonth() - start.getMonth();
    if (now.getDate() < start.getDate()) months--;
    if (months < 0) months += 12;

    return {
      years: Math.max(0, years),
      months: Math.max(0, months),
      isEligible: years >= 1,
      text: `${Math.max(0, years)}年${Math.max(0, months)}個月`
    };
  };

  const getEmployeeYearLogs = useCallback(
    (empId, year) => {
      return logs.filter(
        (log) => log.empId === empId && getLogYear(log) === year
      );
    },
    [logs]
  );

  const getEmployeeYearPoints = useCallback(
    (emp, year) => {
      if (!emp) return DEFAULT_INITIAL_POINTS;

      const initial =
        typeof emp.initialPoints === 'number'
          ? emp.initialPoints
          : DEFAULT_INITIAL_POINTS;

      const yearLogs = getEmployeeYearLogs(emp.id, year);
      const delta = yearLogs.reduce(
        (sum, log) => sum + (Number(log.amount) || 0),
        0
      );

      return initial + delta;
    },
    [getEmployeeYearLogs]
  );

  const calculateResult = (
    points,
    lastYearPoints,
    lastYearLowFallback = false
  ) => {
    const lastYearIsLow = lastYearPoints < 499 || lastYearLowFallback;

    if (lastYearIsLow && points < 499) {
      return {
        status: 'D (淘汰)',
        color: 'text-gray-900',
        bg: 'bg-gray-900 text-white',
        desc: '連兩年低於499'
      };
    }
    if (points >= 500) {
      return {
        status: 'A (合格)',
        color: 'text-green-600',
        bg: 'bg-green-100 text-green-800',
        desc: '年度加級正常發放'
      };
    }
    if (points >= 481) {
      return {
        status: 'B (警示)',
        color: 'text-orange-600',
        bg: 'bg-yellow-100 text-yellow-800',
        desc: '金額減半'
      };
    }
    return {
      status: 'C (重罰)',
      color: 'text-red-600',
      bg: 'bg-red-100 text-red-800',
      desc: '取消年度加級資格'
    };
  };

  const getEmployeeAssessment = useCallback(
    (emp, year = getCurrentYear()) => {
      const thisYearPoints = getEmployeeYearPoints(emp, year);
      const lastYearPoints = getEmployeeYearPoints(emp, year - 1);
      const result = calculateResult(
        thisYearPoints,
        lastYearPoints,
        emp?.lastYearLow || false
      );

      return {
        year,
        thisYearPoints,
        lastYearPoints,
        result
      };
    },
    [getEmployeeYearPoints]
  );

  const calculateFinalPay = useCallback(
    (emp) => {
      if (!emp || emp.skillsPassed < 2) return 0;

      const seniority = calculateSeniority(emp.startDate);
      if (!seniority.isEligible) return 0;

      const { result } = getEmployeeAssessment(emp);
      const base = GLOBAL_BASE_BONUS * (emp.multiplier || 1);

      if (result.status.includes('A')) return Math.round(base);
      if (result.status.includes('B')) return Math.round(base / 2);
      return 0;
    },
    [getEmployeeAssessment]
  );
  // ===== Firebase 正式版匿名登入 =====
  // Firestore 正式規則會要求 request.auth != null，
  // 所以系統載入時先自動匿名登入，再讀取 stores / settings 資料。
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          setFirebaseUser(user);
          setFirebaseAuthReady(true);
          return;
        }

        await signInAnonymously(auth);
      } catch (error) {
        console.error('Firebase 匿名登入失敗:', error);
        setFirebaseAuthReady(true);
        showMessage('Firebase 登入失敗，請確認 Anonymous 已啟用', 'error');
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // ===== Firebase 初始化（權限設定） =====
  useEffect(() => {
    if (!firebaseAuthReady) return;

    const initAuthConfig = async () => {
      try {
        const ref = doc(db, 'settings', 'auth');
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          const initData = {
            adminPassword: '9999',
            managerA: {
              name: '店長A',
              password: 'a8888',
              storeId: 'storeA'
            },
            managerB: {
              name: '店長B',
              password: 'b8888',
              storeId: 'storeB'
            }
          };

          await setDoc(ref, initData);
          setAuthConfig(initData);
          setPasswordPanel({
            adminPassword: initData.adminPassword,
            managerAName: initData.managerA.name,
            managerAPassword: initData.managerA.password,
            managerBName: initData.managerB.name,
            managerBPassword: initData.managerB.password
          });
        } else {
          const data = snap.data();
          setAuthConfig(data);
          setPasswordPanel({
            adminPassword: data.adminPassword || '9999',
            managerAName: data.managerA?.name || '店長A',
            managerAPassword: data.managerA?.password || 'a8888',
            managerBName: data.managerB?.name || '店長B',
            managerBPassword: data.managerB?.password || 'b8888'
          });
        }
      } catch (e) {
        console.error('讀取 Firebase 權限設定失敗:', e);
        const fallbackData = {
          adminPassword: '9999',
          managerA: { name: '店長A', password: 'a8888', storeId: 'storeA' },
          managerB: { name: '店長B', password: 'b8888', storeId: 'storeB' }
        };
        setAuthConfig(fallbackData);
        setPasswordPanel({
          adminPassword: fallbackData.adminPassword,
          managerAName: fallbackData.managerA.name,
          managerAPassword: fallbackData.managerA.password,
          managerBName: fallbackData.managerB.name,
          managerBPassword: fallbackData.managerB.password
        });
        showMessage('讀取權限設定失敗，已暫用預設密碼 9999', 'error');
      } finally {
        setAuthReady(true);
      }
    };

    initAuthConfig();
  }, [firebaseAuthReady]);

  // ===== Firebase 即時資料 =====
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    const unsubs = [];

    // 確保分店主文件存在，避免 Firebase Console 顯示「此文件不存在」造成誤判。
    ['storeA', 'storeB'].forEach((storeId) => {
      setDoc(
        doc(db, 'stores', storeId),
        { name: getStoreLabel(storeId), active: true, updatedAt: new Date().toISOString() },
        { merge: true }
      ).catch((error) => console.warn(`建立 ${storeId} 主文件失敗:`, error));
    });

    ['storeA', 'storeB'].forEach((storeId) => {
      const unsubEmp = onSnapshot(
        collection(db, 'stores', storeId, 'employees'),
        (snap) => {
          setEmployees((prev) => {
            const others = prev.filter((e) => e.storeId !== storeId);

            const data = snap.docs.map((d) => ({
              id: d.id,
              storeId,
              ...d.data()
            }));

            return [...others, ...data];
          });
        },
        (error) => {
          console.error(`讀取 ${storeId} 員工失敗:`, error);
          showMessage('讀取員工資料失敗，請檢查 Firestore 規則', 'error');
        }
      );

      const unsubLogs = onSnapshot(
        collection(db, 'stores', storeId, 'logs'),
        (snap) => {
          setLogs((prev) => {
            const others = prev.filter((l) => l.storeId !== storeId);

            const data = snap.docs.map((d) => ({
              id: d.id,
              storeId,
              ...d.data()
            }));

            return [...others, ...data];
          });
        },
        (error) => {
          console.error(`讀取 ${storeId} 紀錄失敗:`, error);
          showMessage('讀取操作紀錄失敗，請檢查 Firestore 規則', 'error');
        }
      );

      unsubs.push(unsubEmp, unsubLogs);
    });

    return () => unsubs.forEach((u) => u && u());
  }, [authReady, firebaseUser, getStoreLabel]);

  // ===== 登入 =====
  const handleAuth = (e) => {
    e.preventDefault();

    const inputPassword = String(passwordInput || '').trim();
    const config = authConfig || {
      adminPassword: '9999',
      managerA: { name: '店長A', password: 'a8888', storeId: 'storeA' },
      managerB: { name: '店長B', password: 'b8888', storeId: 'storeB' }
    };

    if (authMode === 'admin') {
      const adminPassword = String(config.adminPassword || '9999').trim();
      if (inputPassword === adminPassword) {
        setActiveTab('admin');
        setAuthMode(null);
      } else {
        showMessage('密碼錯誤，請確認 Firebase settings/auth 的 adminPassword', 'error');
      }
    }

    if (authMode === 'manager') {
      const data = config[managerLoginKey];
      const managerPassword = String(data?.password || '').trim();

      if (inputPassword === managerPassword) {
        setCurrentManager({
          name: data.name,
          storeId: data.storeId,
          key: managerLoginKey
        });
        setActiveTab('manager');
        setAuthMode(null);
      } else {
        showMessage('密碼錯誤，請確認 Firebase settings/auth 的店長密碼', 'error');
      }
    }

    setPasswordInput('');
  };

  const leaveManagerMode = () => {
    setCurrentManager(null);
    setActiveTab('employee');
  };

  const handleMissedClockRequest = async () => {
    if (!selectedEmp?.id) {
      showMessage('請先選擇員工', 'error');
      return;
    }

    if (!missedClockForm.requestDate || !missedClockForm.requestTime || !missedClockForm.reason.trim()) {
      showMessage('請完整填寫忘打卡日期、時間與原因', 'error');
      return;
    }

    const requestDateTime = `${missedClockForm.requestDate}T${missedClockForm.requestTime}`;

    try {
      await addDoc(collection(db, 'stores', selectedEmp.storeId, 'logs'), {
        empId: selectedEmp.id,
        amount: 0,
        reason: '忘打卡申請',
        note: missedClockForm.reason.trim(),
        occurrenceDate: missedClockForm.requestDate,
        requestDate: missedClockForm.requestDate,
        requestTime: missedClockForm.requestTime,
        requestDateTime,
        timestamp: new Date().toISOString(),
        createdAt: Date.now(),
        name: selectedEmp.name,
        operator: selectedEmp.name,
        operatorKey: 'employee_request',
        operatorStoreId: selectedEmp.storeId,
        operatorStoreLabel: getStoreLabel(selectedEmp.storeId),
        actionType: 'missed_clock_request',
        requestStatus: 'pending'
      });

      setMissedClockForm({
        requestDate: new Date().toISOString().split('T')[0],
        requestTime: '',
        reason: ''
      });
      showMessage('忘打卡申請已送出', 'success');
    } catch (error) {
      console.error('送出忘打卡申請失敗:', error);
      showMessage('送出忘打卡申請失敗', 'error');
    }
  };

  const handleMissedClockReview = async (log, nextStatus) => {
    if (!log?.id || !log?.storeId) {
      showMessage('找不到忘打卡申請資料', 'error');
      return;
    }

    try {
      await updateDoc(doc(db, 'stores', log.storeId, 'logs', log.id), {
        requestStatus: nextStatus,
        reviewedAt: new Date().toISOString(),
        reviewedBy: '管理員',
        reviewerKey: 'admin'
      });

      await addDoc(collection(db, 'stores', log.storeId, 'logs'), {
        empId: log.empId,
        amount: 0,
        reason: nextStatus === 'approved' ? '批准忘打卡申請' : '退回忘打卡申請',
        note: `${log.name || '員工'}｜${log.requestDate || log.occurrenceDate || ''} ${log.requestTime || ''}｜原因：${log.note || '未填寫'}`,
        occurrenceDate: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        createdAt: Date.now(),
        name: log.name || '未知員工',
        operator: '管理員',
        operatorKey: 'admin',
        operatorStoreId: log.storeId,
        operatorStoreLabel: getStoreLabel(log.storeId),
        actionType: nextStatus === 'approved' ? 'approve_missed_clock_request' : 'reject_missed_clock_request',
        requestStatus: nextStatus,
        targetRequestId: log.id,
        requestDate: log.requestDate || log.occurrenceDate || '',
        requestTime: log.requestTime || ''
      });

      showMessage(nextStatus === 'approved' ? '已批准忘打卡申請' : '已退回忘打卡申請', 'success');
    } catch (error) {
      console.error('審核忘打卡申請失敗:', error);
      showMessage('審核忘打卡申請失敗', 'error');
    }
  };


  const handleDeleteMissedClockRequest = async (log) => {
    if (!log?.id || !log?.storeId) {
      showMessage('找不到忘打卡申請資料', 'error');
      return;
    }

    try {
      await addDoc(collection(db, 'stores', log.storeId, 'logs'), {
        empId: log.empId,
        amount: 0,
        reason: '刪除忘打卡申請',
        note: `${log.name || '員工'}｜${log.requestDate || log.occurrenceDate || ''} ${log.requestTime || ''}｜狀態：${log.requestStatus || 'pending'}｜原因：${log.note || '未填寫'}`,
        occurrenceDate: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        createdAt: Date.now(),
        name: log.name || '未知員工',
        operator: '管理員',
        operatorKey: 'admin',
        operatorStoreId: log.storeId,
        operatorStoreLabel: getStoreLabel(log.storeId),
        actionType: 'delete_missed_clock_request',
        deletedRequestId: log.id,
        deletedRequestStatus: log.requestStatus || 'pending',
        requestDate: log.requestDate || log.occurrenceDate || '',
        requestTime: log.requestTime || ''
      });

      await deleteDoc(doc(db, 'stores', log.storeId, 'logs', log.id));
      showMessage('忘打卡申請已刪除', 'success');
    } catch (error) {
      console.error('刪除忘打卡申請失敗:', error);
      showMessage('刪除忘打卡申請失敗', 'error');
    }
  };

  // ===== 新增員工 =====
  const handleAddEmployee = async () => {
    if (!editingEmp?.name) {
      showMessage('請輸入姓名', 'error');
      return;
    }

    const birthdayId = normalizeBirthdayId(editingEmp?.birthdayId);
    if (birthdayId && birthdayId.length !== 4) {
      showMessage('生日月日請輸入 4 碼，例如 0512', 'error');
      return;
    }

    const storeId =
      editingEmp?.storeId ||
      (activeTab === 'manager' ? currentStoreId : null);

    if (!storeId) {
      showMessage('請先選擇所屬分店', 'error');
      return;
    }

    try {
      const newEmpRef = await addDoc(collection(db, 'stores', storeId, 'employees'), {
        ...editingEmp,
        birthdayId,
        storeId,
        shop: getStoreLabel(storeId),
        currentPoints: editingEmp.initialPoints || DEFAULT_INITIAL_POINTS
      });

      await addDoc(collection(db, 'stores', storeId, 'logs'), {
        empId: newEmpRef.id,
        amount: 0,
        reason: '新增員工資料',
        note: `${editingEmp.name} 已被新增`,
        occurrenceDate: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        createdAt: Date.now(),
        name: editingEmp.name,
        operator: currentManager?.name || '管理員',
        operatorKey: currentManager?.key || 'admin',
        operatorStoreId: currentManager?.storeId || storeId,
        operatorStoreLabel: getStoreLabel(currentManager?.storeId || storeId),
        actionType: 'create_employee'
      });

      setEditingEmp(null);
      setIsAddingNew(false);
      showMessage('夥伴資料已新增', 'success');
    } catch (error) {
      console.error('新增夥伴失敗:', error);
      showMessage('新增夥伴失敗', 'error');
    }
  };

  // ===== 加扣分 =====
  const handlePointChange = async (empId, amount, reason) => {
    const emp = employees.find((e) => e.id === empId);
    if (!emp) {
      showMessage('找不到員工資料', 'error');
      return;
    }

    try {
      await addDoc(collection(db, 'stores', emp.storeId, 'logs'), {
        empId,
        amount,
        reason,
        note,
        occurrenceDate,
        timestamp: new Date().toISOString(),
        createdAt: Date.now(),
        name: emp.name,
        operator: currentManager?.name || '管理員',
        operatorKey: currentManager?.key || 'admin',
        operatorStoreId: currentManager?.storeId || emp.storeId,
        operatorStoreLabel: getStoreLabel(currentManager?.storeId || emp.storeId),
        actionType: 'score_change'
      });

      setNote('');
      setSelectedItemLabel('');
      setCustomPoints('0');
      showMessage('紀錄已新增', 'success');
    } catch (error) {
      console.error('新增紀錄失敗:', error);
      showMessage('新增紀錄失敗', 'error');
    }
  };

  const handleDeleteScoreLog = async (log) => {
    if (!log?.id || !log?.storeId) {
      showMessage('找不到評分紀錄', 'error');
      return;
    }

    try {
      await addDoc(collection(db, 'stores', log.storeId, 'logs'), {
        empId: log.empId || 'UNKNOWN',
        amount: 0,
        reason: '刪除加扣分紀錄',
        note: `已刪除「${log.reason || '未命名項目'}」${Number(log.amount) || 0} 分`,
        occurrenceDate: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        createdAt: Date.now(),
        name: log.name || '未知員工',
        operator: currentManager?.name || '管理員',
        operatorKey: currentManager?.key || 'admin',
        operatorStoreId: currentManager?.storeId || log.storeId,
        operatorStoreLabel: getStoreLabel(currentManager?.storeId || log.storeId),
        actionType: 'delete_score_change',
        deletedLogId: log.id,
        deletedReason: log.reason || '',
        deletedAmount: Number(log.amount) || 0,
        deletedOccurrenceDate: log.occurrenceDate || '',
        deletedOriginalTimestamp: log.timestamp || ''
      });

      await deleteDoc(doc(db, 'stores', log.storeId, 'logs', log.id));
      showMessage('加扣分紀錄已刪除', 'success');
    } catch (error) {
      console.error('刪除評分紀錄失敗:', error);
      showMessage('刪除評分紀錄失敗', 'error');
    }
  };

  // ===== 刪除員工 =====
  const deleteEmployee = async (id) => {
    const emp = employees.find((e) => e.id === id);
    if (!emp) {
      showMessage('找不到員工資料', 'error');
      return;
    }

    try {
      await addDoc(collection(db, 'stores', emp.storeId, 'logs'), {
        empId: emp.id,
        name: emp.name,
        storeId: emp.storeId,
        reason: '刪除員工資料',
        amount: 0,
        note: `${emp.name} 的員工資料已被刪除`,
        occurrenceDate: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        createdAt: Date.now(),
        operator: currentManager?.name || '管理員',
        operatorKey: currentManager?.key || 'admin',
        operatorStoreId: currentManager?.storeId || emp.storeId,
        operatorStoreLabel: getStoreLabel(currentManager?.storeId || emp.storeId),
        actionType: 'delete_employee'
      });

      await deleteDoc(
        doc(db, 'stores', emp.storeId, 'employees', id)
      );

      setDeletingEmpId(null);
      showMessage('夥伴資料已刪除', 'success');
    } catch (error) {
      console.error('刪除夥伴失敗:', error);
      showMessage('刪除夥伴失敗', 'error');
    }
  };

  // ===== 更新員工 =====
  const handleSaveEmpEdit = async () => {
    if (!editingEmp?.storeId || !editingEmp?.id) {
      showMessage('員工資料不完整', 'error');
      return;
    }

    const birthdayId = normalizeBirthdayId(editingEmp?.birthdayId);
    if (birthdayId && birthdayId.length !== 4) {
      showMessage('生日月日請輸入 4 碼，例如 0512', 'error');
      return;
    }

    try {
      await updateDoc(
        doc(db, 'stores', editingEmp.storeId, 'employees', editingEmp.id),
        {
          ...editingEmp,
          birthdayId,
          shop: getStoreLabel(editingEmp.storeId)
        }
      );

      await addDoc(collection(db, 'stores', editingEmp.storeId, 'logs'), {
        empId: editingEmp.id,
        amount: 0,
        reason: '修改員工資料',
        note: `${editingEmp.name} 資料已被修改`,
        occurrenceDate: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        createdAt: Date.now(),
        name: editingEmp.name,
        operator: currentManager?.name || '管理員',
        operatorKey: currentManager?.key || 'admin',
        operatorStoreId: editingEmp.storeId,
        operatorStoreLabel: getStoreLabel(editingEmp.storeId),
        actionType: 'edit_employee'
      });

      setEditingEmp(null);
      showMessage('夥伴資料已更新', 'success');
    } catch (error) {
      console.error('更新夥伴失敗:', error);
      showMessage('更新夥伴失敗', 'error');
    }
  };
  const visibleEmployees = useMemo(() => {
    if (activeTab === 'manager' && currentStoreId) {
      return employees.filter((emp) => emp.storeId === currentStoreId);
    }
    return employees;
  }, [employees, activeTab, currentStoreId]);

  const selectedEmp =
    visibleEmployees.find((e) => e.id === selectedEmpId) ||
    null;

  const monthlyPersonalLogs = sortLogsByNewestFirst(
    logs
      .filter((log) => log.empId === selectedEmp?.id)
      .filter((log) => {
        const monthKey = getMonthKeyFromDate(log.occurrenceDate || log.timestamp);
        return monthKey === selectedMonth;
      })
  );

  const filteredPersonalLogs = monthlyPersonalLogs.filter((log) => {
    const category = getPersonalLogCategory(log);
    const keyword = personalLogSearch.trim().toLowerCase();

    const matchesCategory =
      personalLogCategory === 'all' || category === personalLogCategory;

    const searchableText = [
      log.reason,
      log.note,
      log.name,
      log.operator,
      log.requestDate,
      log.requestTime,
      log.requestDateTime,
      log.occurrenceDate
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const matchesSearch = !keyword || searchableText.includes(keyword);

    return matchesCategory && matchesSearch;
  });

  const managerViewLogs = sortLogsByNewestFirst(
    logs
      .filter((log) => log.empId === selectedEmpId)
      .filter((log) => !currentStoreId || log.storeId === currentStoreId)
  ).slice(0, 10);

  const employeeMissedClockLogs = useMemo(() => {
    return [...logs]
      .filter((log) => log.actionType === 'missed_clock_request')
      .sort((a, b) => {
        const aTime = toJsDate(a.timestamp || a.requestDateTime || a.occurrenceDate)?.getTime() || 0;
        const bTime = toJsDate(b.timestamp || b.requestDateTime || b.occurrenceDate)?.getTime() || 0;
        return bTime - aTime;
      });
  }, [logs]);

  const selectedEmpMissedClockLogs = useMemo(() => {
    if (!selectedEmp?.id) return [];
    return employeeMissedClockLogs.filter((log) => log.empId === selectedEmp.id).slice(0, 8);
  }, [employeeMissedClockLogs, selectedEmp]);

  const pendingMissedClockRequests = useMemo(() => {
    return employeeMissedClockLogs.filter((log) => log.requestStatus === 'pending');
  }, [employeeMissedClockLogs]);

  const reviewedMissedClockRequests = useMemo(() => {
    return employeeMissedClockLogs
      .filter((log) => log.requestStatus === 'approved' || log.requestStatus === 'rejected')
      .slice(0, 30);
  }, [employeeMissedClockLogs]);

  const getEmployeeMonthlyMissedClockCount = (empId, monthKey = getCurrentMonthKey()) => {
    return employeeMissedClockLogs.filter((log) => {
      if (log.empId !== empId) return false;
      const targetMonthKey = getMonthKeyFromDate(log.requestDate || log.occurrenceDate || log.timestamp);
      return targetMonthKey === monthKey;
    }).length;
  };

  const adminManagerLogs = useMemo(() => {
    return [...logs]
      .filter((log) => log.operatorKey === 'managerA' || log.operatorKey === 'managerB')
      .sort((a, b) => {
        const aTime = toJsDate(a.timestamp || a.occurrenceDate)?.getTime() || 0;
        const bTime = toJsDate(b.timestamp || b.occurrenceDate)?.getTime() || 0;
        return bTime - aTime;
      })
      .slice(0, 80);
  }, [logs]);

  const sortedEmployees = useMemo(() => {
    return [...employees].sort((a, b) => {
      const aPoints = getEmployeeYearPoints(a, getCurrentYear());
      const bPoints = getEmployeeYearPoints(b, getCurrentYear());
      return aPoints - bPoints;
    });
  }, [employees, getEmployeeYearPoints]);

  const sortedVisibleEmployees = useMemo(() => {
    return [...visibleEmployees].sort((a, b) => {
      const aPoints = getEmployeeYearPoints(a, getCurrentYear());
      const bPoints = getEmployeeYearPoints(b, getCurrentYear());
      return aPoints - bPoints;
    });
  }, [visibleEmployees, getEmployeeYearPoints]);

  const getEmployeeMonthLogs = (empId, monthKey = getCurrentMonthKey()) => {
    return sortLogsByNewestFirst(
      logs.filter((log) => {
        if (log.empId !== empId) return false;
        return getMonthKeyFromDate(log.occurrenceDate || log.timestamp) === monthKey;
      })
    );
  };

  const getEmployeeMonthlyPoints = (empId, monthKey = getCurrentMonthKey()) => {
    const monthLogs = getEmployeeMonthLogs(empId, monthKey);
    const monthlyDelta = monthLogs.reduce(
      (sum, log) => sum + (Number(log.amount) || 0),
      0
    );

    return MONTHLY_BASE_POINTS + monthlyDelta;
  };

  const isLateLog = (log) => {
    const reason = String(log.reason || '');
    return reason.includes('遲到');
  };

  const isMajorMistakeLog = (log) => {
    const reason = String(log.reason || '');
    return (
      reason.includes('作業失誤-重') ||
      reason.includes('燒焦') ||
      reason.includes('客訴')
    );
  };

  const getEmployeeMonthlyWarningStats = (
    empId,
    monthKey = getCurrentMonthKey()
  ) => {
    const monthLogs = getEmployeeMonthLogs(empId, monthKey);

    const lateCount = monthLogs.filter(isLateLog).length;
    const majorMistakeCount = monthLogs.filter(isMajorMistakeLog).length;
    const totalPenaltyPoints = monthLogs
      .filter((log) => Number(log.amount) < 0)
      .reduce((sum, log) => sum + Math.abs(Number(log.amount) || 0), 0);
    const totalPenaltyCount = monthLogs.filter(
      (log) => Number(log.amount) < 0
    ).length;

    return {
      lateCount,
      majorMistakeCount,
      totalPenaltyPoints,
      totalPenaltyCount
    };
  };

  const getEmployeeWarnings = (emp) => {
    if (!emp) return [];

    const warnings = [];
    const stats = getEmployeeMonthlyWarningStats(emp.id);
    const assessment = getEmployeeAssessment(emp);

    if (stats.lateCount >= 2) {
      warnings.push({
        key: 'late',
        label: `本月遲到 ${stats.lateCount} 次`,
        level: 'warning'
      });
    }

    if (stats.majorMistakeCount >= 2) {
      warnings.push({
        key: 'majorMistake',
        label: `本月重大失誤 ${stats.majorMistakeCount} 次`,
        level: 'danger'
      });
    }

    if (stats.totalPenaltyPoints >= 15) {
      warnings.push({
        key: 'penaltyPoints',
        label: `本月累積扣分 ${stats.totalPenaltyPoints}`,
        level: 'danger'
      });
    }

    if (stats.totalPenaltyCount >= 5) {
      warnings.push({
        key: 'penaltyCount',
        label: `本月負向紀錄 ${stats.totalPenaltyCount} 筆`,
        level: 'warning'
      });
    }

    if (assessment.result.status.includes('B')) {
      warnings.push({
        key: 'yearB',
        label: '年度 B 警示',
        level: 'warning'
      });
    }

    if (assessment.result.status.includes('C')) {
      warnings.push({
        key: 'yearC',
        label: '年度 C 重罰',
        level: 'danger'
      });
    }

    if (assessment.result.status.includes('D')) {
      warnings.push({
        key: 'yearD',
        label: '年度 D 淘汰',
        level: 'danger'
      });
    }

    return warnings;
  };

  const getWarningBadgeClass = (level) => {
    if (level === 'danger') {
      return 'bg-red-100 text-red-700 border-red-200';
    }
    return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  };

  const totalEmployees = employees.length;
  const warningCount = employees.filter((emp) => {
    const warnings = getEmployeeWarnings(emp);
    return warnings.length > 0;
  }).length;

  const monthlyWarningCount = employees.filter((emp) => {
    const warnings = getEmployeeWarnings(emp);
    return warnings.some(
      (w) =>
        w.key === 'late' ||
        w.key === 'majorMistake' ||
        w.key === 'penaltyPoints'
    );
  }).length;

  const adminStoreStats = {
    storeA: employees.filter((emp) => emp.storeId === 'storeA').length,
    storeB: employees.filter((emp) => emp.storeId === 'storeB').length
  };

  const adminEmployeeRows = useMemo(() => {
    return sortedEmployees
      .map((emp) => {
        const assessment = getEmployeeAssessment(emp);
        const seniority = calculateSeniority(emp.startDate);
        const warnings = getEmployeeWarnings(emp);
        const monthlyStats = getEmployeeMonthlyWarningStats(emp.id);
        const monthlyPoints = getEmployeeMonthlyPoints(emp.id);
        const finalPay = calculateFinalPay(emp);

        return {
          ...emp,
          assessment,
          seniority,
          warnings,
          monthlyStats,
          monthlyPoints,
          finalPay
        };
      })
      .filter((emp) => {
        const keyword = adminSearch.trim().toLowerCase();
        const matchesSearch =
          !keyword ||
          String(emp.name || '').toLowerCase().includes(keyword) ||
          String(emp.level || '').toLowerCase().includes(keyword) ||
          String(getStoreLabel(emp.storeId) || '').toLowerCase().includes(keyword);

        const matchesStore =
          adminStoreFilter === 'all' || emp.storeId === adminStoreFilter;

        const statusCode = String(emp.assessment?.result?.status || '').charAt(0);
        const matchesStatus =
          adminStatusFilter === 'all' || statusCode === adminStatusFilter;

        return matchesSearch && matchesStore && matchesStatus;
      });
  }, [
    sortedEmployees,
    getEmployeeAssessment,
    calculateFinalPay,
    adminSearch,
    adminStoreFilter,
    adminStatusFilter,
    getStoreLabel
  ]);

  const adminOverview = useMemo(() => {
    const summary = {
      total: employees.length,
      warning: 0,
      lateRisk: 0,
      highRisk: 0,
      statusA: 0,
      statusB: 0,
      statusC: 0,
      statusD: 0
    };

    employees.forEach((emp) => {
      const warnings = getEmployeeWarnings(emp);
      const assessment = getEmployeeAssessment(emp);
      const stats = getEmployeeMonthlyWarningStats(emp.id);
      const status = String(assessment?.result?.status || '');

      if (warnings.length > 0) summary.warning += 1;
      if (stats.lateCount >= 2) summary.lateRisk += 1;
      if (stats.majorMistakeCount >= 2 || status.includes('C') || status.includes('D')) {
        summary.highRisk += 1;
      }
      if (status.includes('A')) summary.statusA += 1;
      if (status.includes('B')) summary.statusB += 1;
      if (status.includes('C')) summary.statusC += 1;
      if (status.includes('D')) summary.statusD += 1;
    });

    return summary;
  }, [employees, getEmployeeAssessment]);


  const formatExcelValue = (value) => {
    if (value === null || value === undefined) return '';
    const raw = String(value);
    if (/^[=+\-@]/.test(raw)) return `'${raw}`;
    return raw.replace(/"/g, '""');
  };

  const exportEmployeesToExcel = () => {
    try {
      const monthKey = getCurrentMonthKey();
      const rows = employees.map((emp) => {
        const assessment = getEmployeeAssessment(emp);
        const seniority = calculateSeniority(emp.startDate);
        const monthlyStats = getEmployeeMonthlyWarningStats(emp.id, monthKey);
        const missedCount = getEmployeeMonthlyMissedClockCount(emp.id, monthKey);
        const monthlyPoints = getEmployeeMonthlyPoints(emp.id, monthKey);
        const warnings = getEmployeeWarnings(emp).map((item) => item.label).join('、');
        const finalPay = calculateFinalPay(emp);

        return {
          分店: getStoreLabel(emp.storeId),
          員工姓名: emp.name || '',
          員工編號: emp.employeeId || '',
          職級: emp.level || '',
          到職日: formatDate(emp.startDate),
          年資: seniority.text,
          初始積分: typeof emp.initialPoints === 'number' ? emp.initialPoints : DEFAULT_INITIAL_POINTS,
          去年分數: assessment.lastYearPoints,
          今年分數: assessment.thisYearPoints,
          年度結果: assessment.result.status,
          年度說明: assessment.result.desc,
          本月遲到次數: monthlyStats.lateCount,
          本月重大失誤次數: monthlyStats.majorMistakeCount,
          本月負向紀錄數: monthlyStats.totalPenaltyCount,
          本月累積扣分: monthlyStats.totalPenaltyPoints,
          當月積分: monthlyPoints,
          本月忘打卡次數: missedCount,
          已過關卡: emp.skillsPassed || 0,
          倍率: emp.multiplier || 1,
          預估加級: finalPay,
          去年是否低分: emp.lastYearLow ? '是' : '否',
          警示摘要: warnings || '無',
          備註: emp.note || ''
        };
      });

      const headers = [
        '分店','員工姓名','員工編號','職級','到職日','年資','初始積分','去年分數','今年分數','年度結果','年度說明',
        '本月遲到次數','本月重大失誤次數','本月負向紀錄數','本月累積扣分','當月積分','本月忘打卡次數',
        '已過關卡','倍率','預估加級','去年是否低分','警示摘要','備註'
      ];

      const csv = [
        headers.join(','),
        ...rows.map((row) => headers.map((header) => `"${formatExcelValue(row[header])}"`).join(','))
      ].join('\n');

      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const today = new Date();
      const fileDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      link.href = url;
      link.setAttribute('download', `員工積分總表_${fileDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      showMessage('員工 Excel 報表已匯出', 'success');
    } catch (error) {
      console.error('匯出員工報表失敗:', error);
      showMessage('匯出員工報表失敗', 'error');
    }
  };

  const savePasswords = async () => {
    try {
      setSavingPassword(true);

      const payload = {
        adminPassword: passwordPanel.adminPassword.trim(),
        managerA: {
          name: passwordPanel.managerAName.trim() || '店長A',
          password: passwordPanel.managerAPassword.trim(),
          storeId: 'storeA'
        },
        managerB: {
          name: passwordPanel.managerBName.trim() || '店長B',
          password: passwordPanel.managerBPassword.trim(),
          storeId: 'storeB'
        }
      };

      if (
        !payload.adminPassword ||
        !payload.managerA.password ||
        !payload.managerB.password
      ) {
        showMessage('密碼不可空白', 'error');
        return;
      }

      await setDoc(doc(db, 'settings', 'auth'), payload);
      setAuthConfig(payload);

      if (currentManager?.key && payload[currentManager.key]) {
        setCurrentManager({
          key: currentManager.key,
          name: payload[currentManager.key].name,
          storeId: payload[currentManager.key].storeId
        });
      }

      showMessage('權限設定已更新', 'success');
    } catch (error) {
      console.error('更新設定失敗:', error);
      showMessage('更新設定失敗', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-[2rem] shadow-xl border border-gray-100 px-8 py-6">
          <p className="font-black text-gray-700">系統載入中...</p>
          <p className="text-xs text-gray-400 font-bold mt-2">正在進行 Firebase 正式版安全登入</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-12">
      {systemMessage && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[1000] px-6 py-3 rounded-full shadow-2xl font-bold flex items-center gap-2 ${
            systemMessage.type === 'error'
              ? 'bg-red-600 text-white'
              : systemMessage.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-gray-800 text-white'
          }`}
        >
          {systemMessage.text}
        </div>
      )}

      {authMode && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
          <form
            onSubmit={handleAuth}
            className="bg-white p-8 rounded-[2rem] shadow-2xl w-full max-w-sm"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black flex items-center gap-2">
                {authMode === 'manager' ? (
                  <Store className="text-orange-600" />
                ) : (
                  <Lock className="text-red-600" />
                )}
                身分驗證
              </h3>
              <button
                type="button"
                onClick={() => {
                  setAuthMode(null);
                  setPasswordInput('');
                }}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-gray-400 font-bold mb-4 uppercase tracking-widest">
              請輸入 {authMode === 'manager' ? '店長' : '最高權限'} 密碼
            </p>

            {authMode === 'manager' && (
              <div className="mb-4">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                  選擇分店店長
                </label>
                <select
                  value={managerLoginKey}
                  onChange={(e) => setManagerLoginKey(e.target.value)}
                  className="w-full mt-1 px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-orange-500 outline-none font-bold"
                >
                  <option value="managerA">
                    {authConfig?.managerA?.name || '店長A'} / {getStoreLabel('storeA')}
                  </option>
                  <option value="managerB">
                    {authConfig?.managerB?.name || '店長B'} / {getStoreLabel('storeB')}
                  </option>
                </select>
              </div>
            )}

            <input
              autoFocus
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="••••"
              className="w-full text-4xl text-center tracking-[1em] py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-orange-500 outline-none transition-all mb-6"
            />

            <button className="w-full py-4 rounded-2xl bg-gray-900 text-white font-black hover:bg-orange-600 transition-colors">
              確認進入
            </button>
          </form>
        </div>
      )}

      {editingEmp && (
        <div className="fixed inset-0 z-[700] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md overflow-y-auto">
          <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl">
            <div className="p-8 border-b flex justify-between items-center bg-gray-50 rounded-t-[2.5rem]">
              <div>
                <h3 className="text-2xl font-black">
                  {isAddingNew ? '註冊新夥伴' : '編輯夥伴資料'}
                </h3>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">
                  Employee Profile Settings
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingEmp(null);
                  setIsAddingNew(false);
                }}
                className="w-12 h-12 flex items-center justify-center bg-white border rounded-full hover:bg-red-50 hover:text-red-500 transition-all shadow-sm"
                type="button"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-8 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                    夥伴姓名
                  </label>
                  <input
                    type="text"
                    value={editingEmp.name}
                    onChange={(e) =>
                      setEditingEmp({ ...editingEmp, name: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold"
                    placeholder="輸入姓名"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                    生日月日（打卡ID）
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={editingEmp.birthdayId || ''}
                    onChange={(e) =>
                      setEditingEmp({
                        ...editingEmp,
                        birthdayId: normalizeBirthdayId(e.target.value)
                      })
                    }
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold"
                    placeholder="例如 0512"
                  />
                  <p className="text-[10px] text-gray-400 font-bold ml-1">
                    只存在員工資料，用來對應打卡系統，不會在列表顯示。
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                    所屬門店
                  </label>
                  <select
                    value={editingEmp.storeId || ''}
                    onChange={(e) =>
                      setEditingEmp({
                        ...editingEmp,
                        storeId: e.target.value,
                        shop: getStoreLabel(e.target.value)
                      })
                    }
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold appearance-none"
                    disabled={activeTab === 'manager'}
                  >
                    {activeTab === 'manager' ? (
                      <option value={currentStoreId || ''}>
                        {getStoreLabel(currentStoreId)}
                      </option>
                    ) : (
                      <>
                        <option value="">選擇店鋪</option>
                        <option value="storeA">西螺文昌店</option>
                        <option value="storeB">斗南站前店</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                  到職日期
                </label>
                <input
                  type="date"
                  value={
                    typeof editingEmp.startDate === 'string'
                      ? editingEmp.startDate
                      : ''
                  }
                  onChange={(e) =>
                    setEditingEmp({ ...editingEmp, startDate: e.target.value })
                  }
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                    職級名稱
                  </label>
                  <select
                    value={editingEmp.level}
                    onChange={(e) =>
                      setEditingEmp({ ...editingEmp, level: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold appearance-none"
                  >
                    <option value="一般夥伴">一般夥伴</option>
                    <option value="熟練夥伴">熟練夥伴</option>
                    <option value="全能夥伴">全能夥伴</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                    已過關卡 (獎金門檻: 2)
                  </label>
                  <input
                    type="number"
                    value={editingEmp.skillsPassed}
                    onChange={(e) =>
                      setEditingEmp({
                        ...editingEmp,
                        skillsPassed: parseInt(e.target.value, 10) || 0
                      })
                    }
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                    考核權重 (Multiplier)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingEmp.multiplier}
                    onChange={(e) =>
                      setEditingEmp({
                        ...editingEmp,
                        multiplier: parseFloat(e.target.value) || 0
                      })
                    }
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                    初始總積分 (預設600)
                  </label>
                  <input
                    type="number"
                    value={editingEmp.initialPoints}
                    onChange={(e) => {
                      const points = parseInt(e.target.value, 10) || 600;
                      setEditingEmp({
                        ...editingEmp,
                        initialPoints: points,
                        currentPoints: isAddingNew
                          ? points
                          : editingEmp.currentPoints ?? points
                      });
                    }}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold"
                  />
                </div>
              </div>

              {!isAddingNew && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                    目前總積分（今年）
                  </label>
                  <input
                    type="number"
                    value={editingEmp.currentPoints}
                    onChange={(e) =>
                      setEditingEmp({
                        ...editingEmp,
                        currentPoints: parseInt(e.target.value, 10) || 0
                      })
                    }
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold"
                  />
                </div>
              )}

              <label className="flex items-center gap-3 p-4 bg-orange-50 rounded-2xl cursor-pointer group hover:bg-orange-100 transition-colors">
                <input
                  type="checkbox"
                  checked={editingEmp.lastYearLow}
                  onChange={(e) =>
                    setEditingEmp({
                      ...editingEmp,
                      lastYearLow: e.target.checked
                    })
                  }
                  className="w-5 h-5 rounded accent-orange-600"
                />
                <div className="flex flex-col">
                  <span className="font-black text-sm text-orange-700">
                    去年評分為低分警示
                  </span>
                  <span className="text-[10px] font-bold text-orange-400 uppercase">
                    若去年紀錄未完整，可用此欄位作為 D 判定輔助
                  </span>
                </div>
              </label>

              <button
                onClick={isAddingNew ? handleAddEmployee : handleSaveEmpEdit}
                className="w-full py-5 bg-gray-900 text-white rounded-2xl font-black text-lg hover:bg-orange-600 transition-all shadow-xl shadow-gray-200 flex items-center justify-center gap-2"
                type="button"
              >
                <Save size={20} />
                {isAddingNew ? '新增夥伴' : '儲存夥伴資料'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdminSettings && activeTab === 'admin' && (
        <div className="fixed inset-0 z-[780] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] w-full max-w-3xl shadow-2xl border border-gray-100">
            <div className="p-6 sm:p-8 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                  <Settings size={22} className="text-orange-600" />
                  管理設定
                </h3>
                <p className="text-xs text-gray-400 font-bold mt-1">
                  密碼與店長名稱統一收在齒輪裡，正式上線更乾淨
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminSettings(false)}
                className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 sm:p-8 space-y-5">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                  管理員密碼
                </label>
                <input
                  type="text"
                  value={passwordPanel.adminPassword}
                  onChange={(e) =>
                    setPasswordPanel((prev) => ({
                      ...prev,
                      adminPassword: e.target.value
                    }))
                  }
                  className="w-full mt-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:border-orange-500 outline-none font-bold"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-[1.5rem] p-5 border border-gray-100">
                  <p className="text-sm font-black text-gray-800 mb-4">
                    店長 A / {getStoreLabel('storeA')}
                  </p>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={passwordPanel.managerAName}
                      onChange={(e) =>
                        setPasswordPanel((prev) => ({
                          ...prev,
                          managerAName: e.target.value
                        }))
                      }
                      placeholder="店長名稱"
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold"
                    />
                    <input
                      type="text"
                      value={passwordPanel.managerAPassword}
                      onChange={(e) =>
                        setPasswordPanel((prev) => ({
                          ...prev,
                          managerAPassword: e.target.value
                        }))
                      }
                      placeholder="店長密碼"
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold"
                    />
                  </div>
                </div>

                <div className="bg-gray-50 rounded-[1.5rem] p-5 border border-gray-100">
                  <p className="text-sm font-black text-gray-800 mb-4">
                    店長 B / {getStoreLabel('storeB')}
                  </p>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={passwordPanel.managerBName}
                      onChange={(e) =>
                        setPasswordPanel((prev) => ({
                          ...prev,
                          managerBName: e.target.value
                        }))
                      }
                      placeholder="店長名稱"
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold"
                    />
                    <input
                      type="text"
                      value={passwordPanel.managerBPassword}
                      onChange={(e) =>
                        setPasswordPanel((prev) => ({
                          ...prev,
                          managerBPassword: e.target.value
                        }))
                      }
                      placeholder="店長密碼"
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:border-orange-500 outline-none font-bold"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={savePasswords}
                disabled={savingPassword}
                className="w-full py-4 rounded-2xl bg-gray-900 text-white font-black hover:bg-orange-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                type="button"
              >
                <Save size={18} />
                {savingPassword ? '儲存中...' : '儲存管理設定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingEmpId && (
        <div className="fixed inset-0 z-[800] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] p-8 w-full max-w-sm shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mb-5">
              <AlertTriangle size={28} />
            </div>

            <h3 className="text-xl font-black text-gray-800 mb-2">確認刪除夥伴？</h3>
            <p className="text-sm text-gray-400 font-bold mb-6">
              此操作無法復原，員工資料將被移除。
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setDeletingEmpId(null)}
                className="py-3 rounded-2xl bg-gray-100 text-gray-600 font-black hover:bg-gray-200 transition-colors"
                type="button"
              >
                取消
              </button>
              <button
                onClick={() => deleteEmployee(deletingEmpId)}
                className="py-3 rounded-2xl bg-red-600 text-white font-black hover:bg-red-700 transition-colors"
                type="button"
              >
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-orange-200">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h1 className="text-lg font-black text-gray-800 leading-tight">
                績效考核系統
              </h1>
              <p className="text-[10px] text-orange-600 font-bold uppercase tracking-widest">
                Performance Insight
              </p>
            </div>
          </div>

          <div className="flex bg-gray-100 p-1 rounded-xl gap-1 border border-gray-200">
            <button
              onClick={() => window.open('https://yuchinyuxian.quickconnect.to/d/s/186Vedg15q40Guighjofsun0kdaXKNrV/VFvQfyzlaq7tHfK_BUVdvlop3-PSq2rC-ALkgpXiWKw0', '_blank', 'noopener,noreferrer')}
              title="前往公司雲端"
              className="px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1 text-gray-400 hover:text-blue-600 hover:bg-white"
              type="button"
            >
              <Cloud size={14} />
              <span className="hidden sm:inline">雲端</span>
            </button>

            <button
              onClick={() => window.location.href = 'https://work-checkin.vercel.app/'}
              title="前往打卡系統"
              className="px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1 text-gray-400 hover:text-orange-600 hover:bg-white"
              type="button"
            >
              <Clock3 size={14} />
              <span className="hidden sm:inline">打卡</span>
            </button>

            <button
              onClick={() => setActiveTab('employee')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1 ${
                activeTab === 'employee'
                  ? 'bg-white shadow-sm text-orange-600'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
              type="button"
            >
              <Search size={14} />
              <span className="hidden sm:inline">查詢</span>
            </button>

            <button
              onClick={() =>
                activeTab === 'manager' ? leaveManagerMode() : setAuthMode('manager')
              }
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1 ${
                activeTab === 'manager'
                  ? 'bg-orange-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
              type="button"
            >
              <Store size={14} />
              <span className="hidden sm:inline">
                {activeTab === 'manager' ? currentManager?.name || '店長' : '店長'}
              </span>
            </button>

            <button
              onClick={() => window.open('https://staff-meal-system.vercel.app/', '_blank', 'noopener,noreferrer')}
              title="前往員工餐系統"
              className="px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1 text-gray-400 hover:text-green-600 hover:bg-white"
              type="button"
            >
              <Utensils size={14} />
              <span className="hidden sm:inline">員工餐</span>
            </button>

            <button
              onClick={() =>
                activeTab === 'admin'
                  ? setActiveTab('employee')
                  : setAuthMode('admin')
              }
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center justify-center ${
                activeTab === 'admin'
                  ? 'bg-red-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-red-600'
              }`}
              type="button"
            >
              <Lock size={14} />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        {activeTab === 'employee' && (
          <div className="space-y-6 animate-in slide-in-from-top-4 duration-300">
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
                <div>
                  <h2 className="text-xl font-black text-gray-800 flex items-center gap-2">
                    <Users size={22} className="text-orange-600" />
                    員工查詢總覽
                  </h2>
                  <p className="text-xs text-gray-400 font-bold mt-1">
                    查詢兩間店所有夥伴的年資、分數、年度結果與警示
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      全部人數
                    </p>
                    <p className="text-3xl font-black text-gray-800 mt-2">
                      {totalEmployees}
                    </p>
                  </div>

                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      全部警示人數
                    </p>
                    <p className="text-3xl font-black text-orange-600 mt-2">
                      {warningCount}
                    </p>
                  </div>

                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      本月警示人數
                    </p>
                    <p className="text-3xl font-black text-red-600 mt-2">
                      {monthlyWarningCount}
                    </p>
                  </div>

                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      年度基準
                    </p>
                    <p className="text-3xl font-black text-gray-800 mt-2">
                      {DEFAULT_INITIAL_POINTS}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {sortedEmployees.map((emp) => {
                  const assessment = getEmployeeAssessment(emp);
                  const warnings = getEmployeeWarnings(emp);

                  return (
                    <div
                      key={emp.id}
                      className={`p-5 rounded-3xl border transition-all ${
                        warnings.some((w) => w.level === 'danger')
                          ? 'border-red-200 bg-red-50/40'
                          : warnings.length > 0
                          ? 'border-yellow-200 bg-yellow-50/40'
                          : 'border-gray-100 bg-gray-50'
                      }`}
                    >
                      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5">
                        <div className="flex-1">
                          <div className="flex items-center flex-wrap gap-2 mb-3">
                            <h3 className="text-xl font-black text-gray-800">
                              {emp.name}
                            </h3>

                            <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-white border border-gray-200 text-gray-400">
                              {emp.shop || '未設定店鋪'}
                            </span>

                            <span
                              className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${assessment.result.bg}`}
                            >
                              {assessment.result.status}
                            </span>

                            {warnings.slice(0, 4).map((warning) => (
                              <span
                                key={warning.key}
                                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${getWarningBadgeClass(
                                  warning.level
                                )}`}
                              >
                                {warning.label}
                              </span>
                            ))}
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            <div className="bg-white rounded-2xl p-4 border border-gray-100">
                              <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">
                                今年分數
                              </p>
                              <p className="text-2xl font-black mt-2 text-gray-800">
                                {assessment.thisYearPoints}
                              </p>
                            </div>

                            <div className="bg-white rounded-2xl p-4 border border-gray-100">
                              <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">
                                年度結果
                              </p>
                              <div className="mt-2">
                                <span
                                  className={`px-3 py-1 rounded-2xl text-xs font-black ${assessment.result.bg}`}
                                >
                                  {assessment.result.status}
                                </span>
                              </div>
                            </div>

                            <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100">
                              <p className="text-[10px] text-blue-500 font-black uppercase tracking-widest">
                                當月積分
                              </p>
                              <p className="text-2xl font-black mt-2 text-blue-700">
                                {getEmployeeMonthlyPoints(emp.id)}
                              </p>
                            </div>

                            <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
                              <p className="text-[10px] text-orange-500 font-black uppercase tracking-widest">
                                本月忘打卡
                              </p>
                              <p className="text-2xl font-black mt-2 text-orange-600">
                                {getEmployeeMonthlyMissedClockCount(emp.id)}
                              </p>
                            </div>

                            <div className="bg-white rounded-2xl p-4 border border-gray-100">
                              <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">
                                目前警示
                              </p>
                              <p className="text-sm font-black mt-2 text-gray-700">
                                {warnings.length > 0 ? `${warnings.length} 項` : '無'}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="xl:w-[140px]">
                          <button
                            onClick={() => {
                              setSelectedEmpId(emp.id);
                              setSelectedMonth(new Date().toISOString().substring(0, 7));
                            }}
                            className="w-full px-4 py-4 rounded-2xl bg-white border border-gray-200 text-gray-700 font-black hover:border-orange-300 hover:text-orange-600 transition-colors"
                            type="button"
                          >
                            {selectedEmpId === emp.id ? '查看中' : '查看詳情'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {sortedEmployees.length === 0 && (
                  <div className="p-8 rounded-3xl border border-dashed border-gray-200 text-center bg-gray-50 text-gray-400 font-bold">
                    目前尚無員工資料
                  </div>
                )}
              </div>
            </section>

            {selectedEmp && (
              <section className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
                <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-8 border-b bg-gray-50">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <p className="text-[10px] text-orange-600 font-black uppercase tracking-widest">
                          Employee Detail
                        </p>
                        <h3 className="text-3xl font-black mt-2 text-gray-800">
                          {selectedEmp.name}
                        </h3>
                        <p className="text-sm text-gray-400 font-bold mt-2">
                          {selectedEmp.shop || '未設定店鋪'} · {selectedEmp.level}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 bg-white border border-gray-200 px-4 py-2.5 rounded-2xl">
                          <Calendar size={16} className="text-gray-400" />
                          <input
                            type="month"
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                            className="bg-transparent text-sm font-black text-gray-700 outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedEmpId(null)}
                          className="px-4 py-2.5 rounded-2xl bg-white border border-gray-200 text-gray-600 font-black hover:border-orange-300 hover:text-orange-600 transition-colors"
                        >
                          收合詳情
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="p-8">
                    <div className="space-y-3">
                      <div className="bg-gray-50 rounded-3xl px-5 py-4 border border-gray-100 flex items-center justify-between gap-4 min-h-[88px]">
                        <div>
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">
                            年資
                          </p>
                          <p className="text-sm text-gray-400 font-bold mt-2">
                            到職後累積年資
                          </p>
                        </div>
                        <p className="text-2xl font-black text-gray-800 text-right leading-tight">
                          {calculateSeniority(selectedEmp.startDate).text}
                        </p>
                      </div>

                      <div className="bg-gray-50 rounded-3xl px-5 py-4 border border-gray-100 flex items-center justify-between gap-4 min-h-[88px]">
                        <div>
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">
                            去年分數
                          </p>
                          <p className="text-sm text-gray-400 font-bold mt-2">
                            去年年度累積結果
                          </p>
                        </div>
                        <p className="text-3xl font-black text-gray-800 text-right leading-none">
                          {getEmployeeAssessment(selectedEmp).lastYearPoints}
                        </p>
                      </div>

                      <div className="bg-gray-50 rounded-3xl px-5 py-4 border border-gray-100 flex items-center justify-between gap-4 min-h-[88px]">
                        <div>
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">
                            年度結果
                          </p>
                          <p className="text-sm text-gray-400 font-bold mt-2">
                            {getEmployeeAssessment(selectedEmp).result.desc}
                          </p>
                        </div>
                        <span
                          className={`px-4 py-2 rounded-2xl text-sm font-black whitespace-nowrap ${getEmployeeAssessment(selectedEmp).result.bg}`}
                        >
                          {getEmployeeAssessment(selectedEmp).result.status}
                        </span>
                      </div>

                      <div className="bg-gray-50 rounded-3xl px-5 py-4 border border-gray-100 flex items-center justify-between gap-4 min-h-[88px]">
                        <div>
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">
                            已過關卡
                          </p>
                          <p className="text-sm text-gray-400 font-bold mt-2">
                            獎金門檻至少 2 關
                          </p>
                        </div>
                        <p className="text-3xl font-black text-gray-800 text-right leading-none">
                          {selectedEmp.skillsPassed || 0}
                        </p>
                      </div>

                      <div className="bg-gray-50 rounded-3xl px-5 py-4 border border-gray-100 flex items-center justify-between gap-4 min-h-[88px]">
                        <div>
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">
                            預估加級
                          </p>
                          <p className="text-sm text-gray-400 font-bold mt-2">
                            依今年結果預估
                          </p>
                        </div>
                        <p className="text-3xl font-black text-orange-600 text-right leading-none">
                          {calculateFinalPay(selectedEmp)}
                        </p>
                      </div>

                      <div className="bg-blue-50 rounded-3xl px-5 py-4 border border-blue-100 flex items-center justify-between gap-4 min-h-[88px]">
                        <div>
                          <p className="text-[10px] text-blue-500 font-black uppercase tracking-widest">
                            當月積分
                          </p>
                          <p className="text-sm text-blue-400 font-bold mt-2">
                            每月基本 {MONTHLY_BASE_POINTS} 分，加扣分後合計
                          </p>
                        </div>
                        <p className="text-3xl font-black text-blue-700 text-right leading-none">
                          {getEmployeeMonthlyPoints(selectedEmp.id, selectedMonth)}
                        </p>
                      </div>

                      <div className="bg-orange-50 rounded-3xl px-5 py-4 border border-orange-100 flex items-center justify-between gap-4 min-h-[88px]">
                        <div>
                          <p className="text-[10px] text-orange-500 font-black uppercase tracking-widest">
                            本月忘打卡次數
                          </p>
                          <p className="text-sm text-orange-400 font-bold mt-2">
                            依目前選擇月份統計
                          </p>
                        </div>
                        <p className="text-3xl font-black text-orange-600 text-right leading-none">
                          {getEmployeeMonthlyMissedClockCount(selectedEmp.id, selectedMonth)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                  <div className="flex flex-col gap-4 mb-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-black text-gray-800 flex items-center gap-2">
                        <History size={18} className="text-gray-400" />
                        當月紀錄
                      </h3>
                      <span className="text-[10px] text-gray-300 font-black uppercase tracking-widest">
                        {selectedMonth}・{filteredPersonalLogs.length}/{monthlyPersonalLogs.length} 筆
                      </span>
                    </div>

                    <div className="grid md:grid-cols-[1fr_auto] gap-3">
                      <div className="relative">
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                        <input
                          type="text"
                          value={personalLogSearch}
                          onChange={(e) => setPersonalLogSearch(e.target.value)}
                          placeholder="搜尋紀錄、備註、日期、操作人"
                          className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold outline-none focus:border-orange-400"
                        />
                      </div>

                      <div className="flex bg-gray-100 p-1 rounded-2xl border border-gray-200 overflow-x-auto">
                        {[
                          { key: 'all', label: '全部' },
                          { key: 'score', label: '加扣分' },
                          { key: 'missedClock', label: '忘打卡' },
                          { key: 'other', label: '其他' }
                        ].map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => setPersonalLogCategory(item.key)}
                            className={`px-3 py-2 rounded-xl text-xs font-black whitespace-nowrap transition ${
                              personalLogCategory === item.key
                                ? 'bg-white text-orange-600 shadow-sm'
                                : 'text-gray-400 hover:text-gray-600'
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {filteredPersonalLogs.length > 0 ? (
                    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2 overscroll-contain">
                      {filteredPersonalLogs.map((log) => (
                        <div
                          key={log.id}
                          className="p-4 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-4">
                            <div
                              className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black ${
                                log.amount >= 0
                                  ? 'bg-green-100 text-green-600'
                                  : 'bg-red-100 text-red-600'
                              }`}
                            >
                              {log.amount > 0 ? '+' : ''}
                              {log.amount}
                            </div>

                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-black text-gray-800">{log.reason}</p>
                                <span
                                  className={`px-2 py-0.5 rounded-full border text-[10px] font-black ${getPersonalLogCategoryClass(
                                    getPersonalLogCategory(log)
                                  )}`}
                                >
                                  {getPersonalLogCategoryLabel(getPersonalLogCategory(log))}
                                </span>
                              </div>
                              <p className="text-xs text-gray-400 mt-1">
                                {formatDate(log.occurrenceDate)}
                                {log.note ? ` · ${log.note}` : ''}
                              </p>
                            </div>
                          </div>

                          <span className="text-[10px] font-black uppercase tracking-widest text-gray-300">
                            {log.operator || '-'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-8 text-center text-gray-400 font-bold">
                      沒有符合條件的紀錄
                    </div>
                  )}
                </div>

                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="font-black text-gray-800 flex items-center gap-2">
                      <Clock3 size={18} className="text-orange-500" />
                      忘打卡申請
                    </h3>
                    <span className="text-[10px] text-gray-300 font-black uppercase tracking-widest">
                      Employee Self Service
                    </span>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4 mb-4">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">忘打卡日期</label>
                      <input
                        type="date"
                        value={missedClockForm.requestDate}
                        onChange={(e) =>
                          setMissedClockForm((prev) => ({ ...prev, requestDate: e.target.value }))
                        }
                        className="w-full bg-gray-50 border-2 border-gray-100 px-4 py-4 rounded-2xl font-black text-gray-700 focus:border-orange-400 outline-none transition-colors"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">忘打卡時間</label>
                      <input
                        type="time"
                        value={missedClockForm.requestTime}
                        onChange={(e) =>
                          setMissedClockForm((prev) => ({ ...prev, requestTime: e.target.value }))
                        }
                        className="w-full bg-gray-50 border-2 border-gray-100 px-4 py-4 rounded-2xl font-black text-gray-700 focus:border-orange-400 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">原因說明</label>
                    <textarea
                      value={missedClockForm.reason}
                      onChange={(e) =>
                        setMissedClockForm((prev) => ({ ...prev, reason: e.target.value }))
                      }
                      rows={3}
                      className="w-full bg-gray-50 border-2 border-gray-100 px-4 py-4 rounded-2xl font-bold text-gray-700 focus:border-orange-400 outline-none transition-colors resize-none"
                      placeholder="例如：早上尖峰太忙忘記補打卡"
                    />
                  </div>

                  <button
                    onClick={handleMissedClockRequest}
                    className="w-full py-4 rounded-2xl bg-orange-600 text-white font-black hover:bg-orange-700 transition-colors flex items-center justify-center gap-2 mb-6"
                    type="button"
                  >
                    <ArrowRight size={18} />
                    送出忘打卡申請
                  </button>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-black text-gray-800">我的申請紀錄</p>
                      <span className="text-[10px] text-gray-300 font-black uppercase tracking-widest">最近 {selectedEmpMissedClockLogs.length} 筆</span>
                    </div>

                    {selectedEmpMissedClockLogs.length > 0 ? (
                      selectedEmpMissedClockLogs.map((log) => (
                        <div
                          key={`missed-clock-${log.id}`}
                          className="p-4 rounded-2xl bg-gray-50 border border-gray-100"
                        >
                          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-black text-gray-800">
                                  {log.requestDate || '-'} {log.requestTime || ''}
                                </p>
                                <span
                                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                    log.requestStatus === 'approved'
                                      ? 'bg-green-100 text-green-700'
                                      : log.requestStatus === 'rejected'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-yellow-100 text-yellow-700'
                                  }`}
                                >
                                  {log.requestStatus === 'approved'
                                    ? '已批准'
                                    : log.requestStatus === 'rejected'
                                    ? '已退回'
                                    : '待審核'}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 font-bold mt-2 leading-6">{log.note || '無原因說明'}</p>
                              <p className="text-xs text-gray-400 font-bold mt-1">申請時間：{formatDateTime(log.timestamp)}</p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-6 text-center text-gray-400 font-bold">
                        目前尚無忘打卡申請紀錄
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === 'manager' && (
          <div className="space-y-6 animate-in slide-in-from-top-4 duration-300">
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
                <div>
                  <h2 className="text-xl font-black flex items-center gap-2 text-gray-800">
                    <Store size={24} className="text-orange-600" />
                    店長評分區
                  </h2>
                  <p className="text-xs text-gray-400 font-bold mt-1">
                    {currentManager
                      ? `${currentManager.name} / ${getStoreLabel(currentStoreId)}`
                      : '選取夥伴並提交當日考核表現'}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEmp({
                        name: '',
                        birthdayId: '',
                        shop: getStoreLabel(currentStoreId),
                        startDate: new Date().toISOString().split('T')[0],
                        currentPoints: DEFAULT_INITIAL_POINTS,
                        initialPoints: DEFAULT_INITIAL_POINTS,
                        lastYearLow: false,
                        level: '一般夥伴',
                        multiplier: 1,
                        skillsPassed: 0,
                        storeId: currentStoreId
                      });
                      setIsAddingNew(true);
                    }}
                    className="px-4 py-3 rounded-2xl bg-gray-900 text-white font-black hover:bg-orange-600 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <PlusCircle size={18} />
                    新增員工
                  </button>

                  <div className="flex items-center gap-2 bg-orange-50 px-4 py-2.5 rounded-2xl border border-orange-100 w-fit">
                    <Calendar size={16} className="text-orange-600" />
                    <input
                      type="date"
                      value={occurrenceDate}
                      onChange={(e) => setOccurrenceDate(e.target.value)}
                      className="bg-transparent text-sm font-black text-orange-700 outline-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
                {sortedVisibleEmployees.map((emp) => {
                  const assessment = getEmployeeAssessment(emp);
                  const seniority = calculateSeniority(emp.startDate);
                  const warnings = getEmployeeWarnings(emp);

                  return (
                    <div
                      key={`manager-overview-${emp.id}`}
                      className={`rounded-[2rem] border p-5 transition-all ${
                        selectedEmpId === emp.id
                          ? 'border-orange-300 bg-orange-50 shadow-lg shadow-orange-100'
                          : 'border-gray-100 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div>
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">
                            {getStoreLabel(emp.storeId)}
                          </p>
                          <h3 className="text-lg font-black text-gray-800 mt-1">{emp.name}</h3>
                          <p className="text-xs text-gray-400 font-bold mt-1">
                            {emp.level || '一般夥伴'}
                          </p>
                        </div>

                        <span
                          className={`px-3 py-1 rounded-full text-xs font-black ${
                            warnings.length > 0
                              ? 'bg-red-100 text-red-700'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {warnings.length > 0 ? '需要注意' : '狀態穩定'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">今年分數</p>
                          <p className="text-xl font-black text-gray-800 mt-2">{assessment.thisYearPoints}</p>
                        </div>
                        <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">年資</p>
                          <p className="text-base font-black text-gray-800 mt-2">{seniority.text}</p>
                        </div>
                      </div>

                      <div className="space-y-2 mb-4">
                        <div className="flex items-center justify-between text-sm font-bold text-gray-600">
                          <span>技能通過</span>
                          <span>{emp.skillsPassed || 0}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm font-bold text-gray-600">
                          <span>本月忘打卡</span>
                          <span className="text-orange-600">{getEmployeeMonthlyMissedClockCount(emp.id)} 次</span>
                        </div>
                        <div className="flex items-center justify-between text-sm font-bold text-gray-600">
                          <span>當月積分</span>
                          <span className="text-blue-600">{getEmployeeMonthlyPoints(emp.id)} 分</span>
                        </div>
                        <div className="flex items-center justify-between text-sm font-bold text-gray-600">
                          <span>年度狀態</span>
                          <span className={`px-2.5 py-1 rounded-full text-xs ${assessment.result.bg}`}>
                            {assessment.result.status}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 mb-4">
                        {warnings.length > 0 ? (
                          warnings.slice(0, 3).map((warning) => (
                            <span
                              key={warning.key}
                              className={`px-2.5 py-1 rounded-full border text-[11px] font-black ${getWarningBadgeClass(warning.level)}`}
                            >
                              {warning.label}
                            </span>
                          ))
                        ) : (
                          <span className="px-2.5 py-1 rounded-full border text-[11px] font-black bg-green-50 text-green-700 border-green-100">
                            本月狀況正常
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedEmpId(emp.id)}
                        className="w-full py-3 rounded-2xl bg-white border border-gray-200 text-gray-700 font-black hover:border-orange-300 hover:text-orange-600 transition-colors"
                      >
                        {selectedEmpId === emp.id ? '目前選取中' : '選取這位夥伴'}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3 mb-10 overflow-x-auto pb-4">
                {sortedVisibleEmployees.map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => setSelectedEmpId(emp.id)}
                    className={`px-5 py-4 rounded-2xl whitespace-nowrap border-2 transition-all min-w-[140px] text-left ${
                      selectedEmpId === emp.id
                        ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-lg shadow-orange-100'
                        : 'border-gray-50 bg-white hover:border-gray-200 text-gray-400'
                    }`}
                    type="button"
                  >
                    <p className="text-[10px] opacity-60 font-black mb-1">
                      {emp.shop}
                    </p>
                    <span className="block font-black text-lg">{emp.name}</span>
                  </button>
                ))}

                {sortedVisibleEmployees.length === 0 && (
                  <div className="px-5 py-4 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400 font-black">
                    此分店目前沒有夥伴
                  </div>
                )}
              </div>

              {selectedEmp ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <div className="md:col-span-2 space-y-2">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">
                        考核項目
                      </label>
                      <select
                        value={selectedItemLabel}
                        onChange={(e) => {
                          const label = e.target.value;
                          setSelectedItemLabel(label);

                          const allItems = [
                            ...PERFORMANCE_ITEMS.penalty,
                            ...PERFORMANCE_ITEMS.bonus
                          ];
                          const item = allItems.find((i) => i.label === label);
                          if (item) setCustomPoints(item.val);
                        }}
                        className="w-full bg-gray-50 border-2 border-gray-100 px-4 py-4 rounded-2xl font-black text-gray-700 focus:border-orange-400 outline-none transition-colors appearance-none"
                      >
                        <option value="">請選擇考核標籤</option>
                        <optgroup label="🔴 扣分項目 (Penalty)">
                          {PERFORMANCE_ITEMS.penalty.map((i) => (
                            <option key={i.label} value={i.label}>
                              {i.label} ({i.val})
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="🟢 獎勵項目 (Bonus)">
                          {PERFORMANCE_ITEMS.bonus.map((i) => (
                            <option key={i.label} value={i.label}>
                              {i.label} (+{i.val})
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">
                        點數
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const raw = String(customPoints || '0');
                            const normalized = raw.startsWith('-') ? raw.slice(1) || '0' : `-${raw || '0'}`;
                            setCustomPoints(normalized);
                          }}
                          className="w-16 shrink-0 bg-orange-50 border-2 border-orange-200 px-4 py-4 rounded-2xl font-black text-orange-600 hover:bg-orange-100 transition-colors"
                        >
                          −
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={customPoints}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (/^-?\d*$/.test(value)) setCustomPoints(value);
                          }}
                          placeholder="例如 -10 或 5"
                          className="w-full bg-gray-50 border-2 border-gray-100 px-4 py-4 rounded-2xl font-black text-gray-700 focus:border-orange-400 outline-none transition-colors"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 mb-6">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">
                      備註
                    </label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      className="w-full bg-gray-50 border-2 border-gray-100 px-4 py-4 rounded-2xl font-bold text-gray-700 focus:border-orange-400 outline-none transition-colors resize-none"
                      placeholder="可選填當次情況說明"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <button
                      onClick={() => {
                        if (!selectedItemLabel) {
                          showMessage('請先選擇考核項目', 'error');
                          return;
                        }
                        const scoreAmount = Number(customPoints);
                        if (customPoints === '' || customPoints === '-' || Number.isNaN(scoreAmount)) {
                          showMessage('請輸入正確點數，例如 -10 或 5', 'error');
                          return;
                        }
                        handlePointChange(
                          selectedEmp.id,
                          scoreAmount,
                          selectedItemLabel
                        );
                      }}
                      className="py-4 rounded-2xl bg-gray-900 text-white font-black hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
                      type="button"
                    >
                      <ArrowRight size={18} />
                      提交評分
                    </button>

                    <button
                      onClick={() => {
                        setEditingEmp({ ...selectedEmp });
                        setIsAddingNew(false);
                      }}
                      className="py-4 rounded-2xl bg-white border border-gray-200 text-gray-700 font-black hover:border-orange-300 hover:text-orange-600 transition-colors flex items-center justify-center gap-2"
                      type="button"
                    >
                      <Edit3 size={18} />
                      編輯夥伴
                    </button>

                    <button
                      onClick={() => setDeletingEmpId(selectedEmp.id)}
                      className="py-4 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-black hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                      type="button"
                    >
                      <Trash2 size={18} />
                      刪除夥伴
                    </button>
                  </div>

                  <div className="bg-gray-50 rounded-[2rem] p-6 border border-gray-100">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="font-black text-gray-800 flex items-center gap-2">
                        <History size={18} className="text-gray-400" />
                        最近評分紀錄
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingEmp({
                            name: '',
                            birthdayId: '',
                            shop: getStoreLabel(currentStoreId),
                            startDate: new Date().toISOString().split('T')[0],
                            currentPoints: DEFAULT_INITIAL_POINTS,
                            initialPoints: DEFAULT_INITIAL_POINTS,
                            lastYearLow: false,
                            level: '一般夥伴',
                            multiplier: 1,
                            skillsPassed: 0,
                            storeId: currentStoreId
                          });
                          setIsAddingNew(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 font-black text-sm hover:border-orange-300 hover:text-orange-600 transition-colors flex items-center gap-2"
                      >
                        <PlusCircle size={16} />
                        新增夥伴
                      </button>
                    </div>

                    {managerViewLogs.length > 0 ? (
                      <div className="space-y-3">
                        {managerViewLogs.map((log) => (
                          <div
                            key={log.id}
                            className="p-4 rounded-2xl bg-white border border-gray-100 flex items-center justify-between gap-4"
                          >
                            <div className="flex items-center gap-4">
                              <div
                                className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black ${
                                  log.amount >= 0
                                    ? 'bg-green-100 text-green-600'
                                    : 'bg-red-100 text-red-600'
                                }`}
                              >
                                {log.amount > 0 ? '+' : ''}
                                {log.amount}
                              </div>

                              <div>
                                <p className="font-black text-gray-800">{log.reason}</p>
                                <p className="text-xs text-gray-400 mt-1">
                                  {formatDate(log.occurrenceDate)}
                                  {log.note ? ` · ${log.note}` : ''}
                                </p>
                              </div>
                            </div>

                            <button
                              onClick={() => {
                                if (log.actionType !== 'score_change') return;
                                handleDeleteScoreLog(log);
                              }}
                              className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${
                                log.actionType === 'score_change'
                                  ? 'bg-gray-50 hover:bg-gray-100 text-gray-500'
                                  : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                              }`}
                              title={log.actionType === 'score_change' ? '刪除這筆加扣分並留下紀錄' : '只有原始加扣分紀錄可刪除'}
                              type="button"
                            >
                              <RotateCcw size={18} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-8 text-center text-gray-400 font-bold">
                        目前沒有紀錄
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="bg-gray-50 border border-dashed border-gray-200 rounded-[2rem] p-10 text-center text-gray-400 font-bold">
                  此分店目前尚無夥伴資料，請先新增夥伴
                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingEmp({
                          name: '',
                          birthdayId: '',
                          shop: getStoreLabel(currentStoreId),
                          startDate: new Date().toISOString().split('T')[0],
                          currentPoints: DEFAULT_INITIAL_POINTS,
                          initialPoints: DEFAULT_INITIAL_POINTS,
                          lastYearLow: false,
                          level: '一般夥伴',
                          multiplier: 1,
                          skillsPassed: 0,
                          storeId: currentStoreId
                        });
                        setIsAddingNew(true);
                      }}
                      className="px-5 py-3 rounded-2xl bg-white border border-gray-200 text-gray-700 font-black hover:border-orange-300 hover:text-orange-600 transition-colors inline-flex items-center gap-2"
                    >
                      <PlusCircle size={16} />
                      新增夥伴
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'admin' && (
          <div className="space-y-6 animate-in slide-in-from-top-4 duration-300">
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl font-black flex items-center gap-2 text-gray-800">
                    <Lock size={22} className="text-red-600" />
                    管理員總控中心
                  </h2>
                  <p className="text-xs text-gray-400 font-bold mt-1">
                    先看整體營運狀態，需要改密碼再點右上齒輪
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowAdminSettings(true)}
                    className="px-4 py-3 rounded-2xl border border-gray-200 bg-white text-gray-700 font-black hover:border-orange-300 hover:text-orange-600 transition-colors inline-flex items-center gap-2"
                  >
                    <Settings size={18} />
                    管理設定
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingEmp({
                        name: '',
                        birthdayId: '',
                        shop: '',
                        startDate: new Date().toISOString().split('T')[0],
                        currentPoints: DEFAULT_INITIAL_POINTS,
                        initialPoints: DEFAULT_INITIAL_POINTS,
                        lastYearLow: false,
                        level: '一般夥伴',
                        multiplier: 1,
                        skillsPassed: 0,
                        storeId: 'storeA'
                      });
                      setIsAddingNew(true);
                    }}
                    className="px-4 py-3 rounded-2xl bg-gray-900 text-white font-black hover:bg-orange-600 transition-colors inline-flex items-center gap-2"
                  >
                    <PlusCircle size={18} />
                    新增員工
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">全部員工</p>
                  <p className="text-2xl font-black mt-2 text-gray-800">{adminOverview.total}</p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">有警示</p>
                  <p className="text-2xl font-black mt-2 text-orange-600">{adminOverview.warning}</p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">遲到風險</p>
                  <p className="text-2xl font-black mt-2 text-yellow-600">{adminOverview.lateRisk}</p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">高風險</p>
                  <p className="text-2xl font-black mt-2 text-red-600">{adminOverview.highRisk}</p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{getStoreLabel('storeA')}</p>
                  <p className="text-2xl font-black mt-2 text-orange-600">{adminStoreStats.storeA}</p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{getStoreLabel('storeB')}</p>
                  <p className="text-2xl font-black mt-2 text-orange-600">{adminStoreStats.storeB}</p>
                </div>
              </div>
            </section>

            <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-lg font-black text-gray-800">員工全覽儀表板</h3>
                  <p className="text-xs text-gray-400 font-bold mt-1">
                    年資、去年分數、今年分數、年度等級、當月風險與年終預估一次看完
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 w-full xl:w-auto">
                  <input
                    type="text"
                    value={adminSearch}
                    onChange={(e) => setAdminSearch(e.target.value)}
                    placeholder="搜尋姓名 / 分店 / 職級"
                    className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-orange-500 font-bold"
                  />

                  <select
                    value={adminStoreFilter}
                    onChange={(e) => setAdminStoreFilter(e.target.value)}
                    className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-orange-500 font-bold"
                  >
                    <option value="all">全部分店</option>
                    <option value="storeA">{getStoreLabel('storeA')}</option>
                    <option value="storeB">{getStoreLabel('storeB')}</option>
                  </select>

                  <select
                    value={adminStatusFilter}
                    onChange={(e) => setAdminStatusFilter(e.target.value)}
                    className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-orange-500 font-bold"
                  >
                    <option value="all">全部年度結果</option>
                    <option value="A">A 合格</option>
                    <option value="B">B 警示</option>
                    <option value="C">C 重罰</option>
                    <option value="D">D 淘汰</option>
                  </select>

                  <button
                    type="button"
                    onClick={exportEmployeesToExcel}
                    className="px-4 py-3 rounded-2xl bg-gray-900 text-white font-black hover:bg-orange-600 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <Save size={16} />
                    快速匯出 Excel
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-4 gap-3 mb-5">
                <div className="bg-green-50 rounded-2xl p-4 border border-green-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-green-600">A 合格</p>
                  <p className="text-2xl font-black mt-2 text-green-700">{adminOverview.statusA}</p>
                </div>
                <div className="bg-yellow-50 rounded-2xl p-4 border border-yellow-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-yellow-600">B 警示</p>
                  <p className="text-2xl font-black mt-2 text-yellow-700">{adminOverview.statusB}</p>
                </div>
                <div className="bg-red-50 rounded-2xl p-4 border border-red-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-red-600">C 重罰</p>
                  <p className="text-2xl font-black mt-2 text-red-700">{adminOverview.statusC}</p>
                </div>
                <div className="bg-gray-100 rounded-2xl p-4 border border-gray-200">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-600">D 淘汰</p>
                  <p className="text-2xl font-black mt-2 text-gray-800">{adminOverview.statusD}</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-widest text-gray-400">
                      <th className="pb-3 pr-4">員工</th>
                      <th className="pb-3 pr-4">分店 / 職級</th>
                      <th className="pb-3 pr-4">年資</th>
                      <th className="pb-3 pr-4">去年</th>
                      <th className="pb-3 pr-4">今年</th>
                      <th className="pb-3 pr-4">年度結果</th>
                      <th className="pb-3 pr-4">本月風險</th>
                      <th className="pb-3 pr-4">年終預估</th>
                      <th className="pb-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminEmployeeRows.length > 0 ? (
                      adminEmployeeRows.map((emp) => (
                        <tr key={emp.id} className="border-t border-gray-100 align-top">
                          <td className="py-4 pr-4">
                            <div className="font-black text-gray-800">{emp.name}</div>
                            <div className="text-xs text-gray-400 font-bold mt-1">
                              已過關卡 {emp.skillsPassed || 0} / 倍率 {emp.multiplier || 1}
                            </div>
                          </td>
                          <td className="py-4 pr-4">
                            <div className="font-black text-gray-700">{getStoreLabel(emp.storeId)}</div>
                            <div className="text-xs text-gray-400 font-bold mt-1">{emp.level || '未設定職級'}</div>
                          </td>
                          <td className="py-4 pr-4 font-black text-gray-700">{emp.seniority.text}</td>
                          <td className="py-4 pr-4 font-black text-gray-700">{emp.assessment.lastYearPoints}</td>
                          <td className="py-4 pr-4 font-black text-gray-800">{emp.assessment.thisYearPoints}</td>
                          <td className="py-4 pr-4">
                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-black ${emp.assessment.result.bg}`}>
                              {emp.assessment.result.status}
                            </span>
                            <div className="text-xs text-gray-400 font-bold mt-2">{emp.assessment.result.desc}</div>
                          </td>
                          <td className="py-4 pr-4">
                            <div className="flex flex-wrap gap-2">
                              {emp.warnings.length > 0 ? (
                                emp.warnings.slice(0, 3).map((warning) => (
                                  <span
                                    key={warning.key}
                                    className={`px-2.5 py-1 rounded-full border text-[11px] font-black ${getWarningBadgeClass(warning.level)}`}
                                  >
                                    {warning.label}
                                  </span>
                                ))
                              ) : (
                                <span className="px-2.5 py-1 rounded-full border text-[11px] font-black bg-green-50 text-green-700 border-green-100">
                                  狀態穩定
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 font-bold mt-2">
                              遲到 {emp.monthlyStats.lateCount} / 重大失誤 {emp.monthlyStats.majorMistakeCount} / 負向 {emp.monthlyStats.totalPenaltyCount}
                            </div>
                          </td>
                          <td className="py-4 pr-4 font-black text-gray-800">
                            {emp.finalPay > 0 ? `${emp.finalPay} 元` : '0 元'}
                          </td>
                          <td className="py-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingEmp({
                                    ...emp,
                                    currentPoints: emp.assessment.thisYearPoints
                                  })
                                }
                                className="px-3 h-10 rounded-2xl bg-gray-50 hover:bg-gray-100 inline-flex items-center justify-center gap-2 text-gray-700 font-black transition-colors"
                              >
                                <Edit3 size={16} />
                                編輯
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingEmpId(emp.id)}
                                className="w-10 h-10 rounded-2xl bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-600 transition-colors"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9} className="py-10 text-center text-gray-400 font-bold">
                          目前沒有符合條件的員工資料
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-5">
                <div>
                  <h3 className="font-black text-gray-800 flex items-center gap-2">
                    <Clock3 size={18} className="text-orange-500" />
                    忘打卡申請審核
                  </h3>
                  <p className="text-xs text-gray-400 font-bold mt-1">
                    管理員可查看員工忘打卡日期時間、原因，並直接批准、退回或刪除申請
                  </p>
                </div>
                <span className="text-[10px] text-gray-300 font-black uppercase tracking-widest">
                  待審核 {pendingMissedClockRequests.length} 筆
                </span>
              </div>

              {pendingMissedClockRequests.length > 0 ? (
                <div className="space-y-3 mb-6">
                  {pendingMissedClockRequests.map((log) => (
                    <div
                      key={`pending-${log.id}`}
                      className="p-4 rounded-2xl bg-orange-50 border border-orange-100 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-gray-800">{log.name || '未指定員工'}</p>
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-white border border-orange-200 text-orange-600">
                            {getStoreLabel(log.storeId)}
                          </span>
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-yellow-100 text-yellow-700">
                            待審核
                          </span>
                        </div>
                        <p className="text-sm font-black text-gray-700 mt-2">
                          忘打卡時間：{log.requestDate || log.occurrenceDate || '-'} {log.requestTime || ''}
                        </p>
                        <p className="text-sm text-gray-600 font-bold mt-2 leading-6">原因：{log.note || '未填寫'}</p>
                        <p className="text-xs text-gray-400 font-bold mt-2">申請時間：{formatDateTime(log.timestamp)}</p>
                      </div>

                      <div className="grid grid-cols-3 gap-3 xl:w-[390px]">
                        <button
                          type="button"
                          onClick={() => handleMissedClockReview(log, 'approved')}
                          className="py-3 rounded-2xl bg-green-600 text-white font-black hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                        >
                          <CheckCircle2 size={18} />
                          批准
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMissedClockReview(log, 'rejected')}
                          className="py-3 rounded-2xl bg-red-600 text-white font-black hover:bg-red-700 transition-colors"
                        >
                          退回
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMissedClockRequest(log)}
                          className="py-3 rounded-2xl bg-gray-900 text-white font-black hover:bg-black transition-colors flex items-center justify-center gap-2"
                        >
                          <Trash2 size={16} />
                          刪除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-8 text-center text-gray-400 font-bold mb-6">
                  目前沒有待審核的忘打卡申請
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h4 className="font-black text-gray-800">最近已審核申請</h4>
                  <span className="text-[10px] text-gray-300 font-black uppercase tracking-widest">最新 {reviewedMissedClockRequests.length} 筆</span>
                </div>

                {reviewedMissedClockRequests.length > 0 ? (
                  <div className="space-y-3">
                    {reviewedMissedClockRequests.map((log) => (
                      <div
                        key={`reviewed-${log.id}`}
                        className="p-4 rounded-2xl bg-gray-50 border border-gray-100"
                      >
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-black text-gray-800">{log.name || '未指定員工'}</p>
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-white border border-gray-200 text-gray-500">
                                {getStoreLabel(log.storeId)}
                              </span>
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                log.requestStatus === 'approved'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                              }`}>
                                {log.requestStatus === 'approved' ? '已批准' : '已退回'}
                              </span>
                            </div>
                            <p className="text-sm font-black text-gray-700 mt-2">
                              忘打卡時間：{log.requestDate || log.occurrenceDate || '-'} {log.requestTime || ''}
                            </p>
                            <p className="text-sm text-gray-600 font-bold mt-2 leading-6">原因：{log.note || '未填寫'}</p>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-xs text-gray-400 font-bold leading-6 text-right">
                              <div>申請：{formatDateTime(log.timestamp)}</div>
                              <div>審核：{formatDateTime(log.reviewedAt)}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteMissedClockRequest(log)}
                              className="px-4 py-3 rounded-2xl bg-gray-900 text-white font-black hover:bg-black transition-colors flex items-center justify-center gap-2"
                            >
                              <Trash2 size={16} />
                              刪除
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-6 text-center text-gray-400 font-bold">
                    目前尚無已審核申請
                  </div>
                )}
              </div>
            </section>

            <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between gap-3 mb-5">
                <div>
                  <h3 className="font-black text-gray-800 flex items-center gap-2">
                    <History size={18} className="text-red-500" />
                    兩位店長操作歷程
                  </h3>
                  <p className="text-xs text-gray-400 font-bold mt-1">
                    管理員可直接查看兩間店店長的所有加扣分操作紀錄
                  </p>
                </div>
                <span className="text-[10px] text-gray-300 font-black uppercase tracking-widest">
                  最新 {adminManagerLogs.length} 筆
                </span>
              </div>

              {adminManagerLogs.length > 0 ? (
                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                  {adminManagerLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-4 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
                    >
                      <div className="flex items-start gap-4">
                        <div
                          className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black shrink-0 ${
                            Number(log.amount) >= 0
                              ? 'bg-green-100 text-green-600'
                              : 'bg-red-100 text-red-600'
                          }`}
                        >
                          {Number(log.amount) > 0 ? '+' : ''}
                          {Number(log.amount) || 0}
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-black text-gray-800">
                              {log.operator || '店長'} → {log.name || '未指定員工'}
                            </p>
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-white border border-gray-200 text-gray-500">
                              {log.operatorStoreLabel || getStoreLabel(log.operatorStoreId || log.storeId)}
                            </span>
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-white border border-gray-200 text-gray-500">
                              {getStoreLabel(log.storeId)}
                            </span>
                          </div>

                          <p className="text-sm font-black text-gray-700 mt-2">
                            {log.reason || '未填寫原因'}
                          </p>

                          <p className="text-xs text-gray-400 font-bold mt-1 leading-6">
                            發生日：{formatDate(log.occurrenceDate)}　
                            建立時間：{formatDate(log.timestamp)}　
                            {log.note ? `備註：${log.note}` : '無備註'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-8 text-center text-gray-400 font-bold">
                  目前尚無店長操作歷程
                </div>
              )}
            </section>

            <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h3 className="font-black text-gray-800 mb-4">正式上線前檢查重點</h3>
              <div className="grid md:grid-cols-2 gap-4 text-sm font-bold text-gray-600">
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 leading-7">
                  <div>1. firebase.js 要使用你正式專案的設定值。</div>
                  <div>2. Firestore 規則要允許登入後讀寫 stores 與 settings。</div>
                  <div>3. GitHub Pages 若空白，多半是環境變數、路由或 base path 問題。</div>
                </div>
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 leading-7">
                  <div>4. 這版已把新增 / 編輯 / 刪除 / 加扣分都補上錯誤提示。</div>
                  <div>5. 管理設定已收進齒輪，不會擠在主畫面。</div>
                  <div>6. 管理員首頁直接看全員狀態，也能追蹤兩位店長操作歷程。</div>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
