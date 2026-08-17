const normalizeEmpId = (value) => String(value || "").trim().toUpperCase();

const roundHours = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const getMealSubsidyFromHours = (workHours) => {
  const hours = Number(workHours) || 0;
  if (hours < 4) return 0;
  if (hours < 6) return 60;
  return 100;
};

export const calculateArchivedWorkDay = (records = []) => {
  const sorted = [...records].sort((a, b) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0));
  const firstIn = sorted.find((record) => record?.type === "上班") || null;
  const lastOut = [...sorted].reverse().find((record) => record?.type === "下班") || null;
  let breakStart = null;
  let breakMs = 0;

  sorted.forEach((record) => {
    if (record?.type === "休息開始") breakStart = Number(record.createdAt || 0);
    if (record?.type === "休息結束" && breakStart) {
      const end = Number(record.createdAt || 0);
      if (end > breakStart) breakMs += end - breakStart;
      breakStart = null;
    }
  });

  const workInAt = Number(firstIn?.createdAt || 0);
  const workOutAt = Number(lastOut?.createdAt || 0);
  const canCalculate = Boolean(workInAt && workOutAt && workOutAt > workInAt);
  const workHours = canCalculate ? Math.max(0, workOutAt - workInAt - breakMs) / 3_600_000 : 0;

  return {
    canCalculate,
    workInAt,
    workOutAt,
    breakHours: roundHours(breakMs / 3_600_000),
    workHours: roundHours(workHours),
    subsidyAmount: canCalculate ? getMealSubsidyFromHours(workHours) : 0,
    recordCount: sorted.length,
    status: canCalculate ? "complete" : "incomplete",
  };
};

export const buildMonthlyArchive = ({ monthKey, recordsById, schedules = {}, archivedAt }) => {
  const rawRecords = {};
  const grouped = {};

  Object.entries(recordsById || {}).forEach(([recordId, record]) => {
    if (!record || typeof record !== "object") return;
    const dateKey = record.dateKey || "";
    const empKey = normalizeEmpId(record.empId);
    if (!dateKey.startsWith(monthKey) || !empKey) return;
    rawRecords[recordId] = record;
    const groupKey = `${dateKey}_${empKey}`;
    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push(record);
  });

  const days = {};
  Object.entries(grouped).forEach(([groupKey, dayRecords]) => {
    const first = dayRecords[0] || {};
    const dateKey = first.dateKey || groupKey.slice(0, 10);
    const empId = first.empId || groupKey.slice(11);
    const schedule = schedules?.[dateKey]?.[empId] || schedules?.[dateKey]?.[normalizeEmpId(empId)] || null;
    days[groupKey] = {
      monthKey,
      dateKey,
      empId,
      name: first.name || empId,
      store: first.store || schedule?.store || "",
      role: first.role || "",
      scheduleStartTime: schedule?.startTime || "",
      scheduleEndTime: schedule?.endTime || "",
      isSupport: Boolean(schedule?.isSupport),
      supportStore: schedule?.supportStore || "",
      ...calculateArchivedWorkDay(dayRecords),
      archivedAt,
      source: "monthly-close",
    };
  });

  const dayList = Object.values(days);
  const employeeCount = new Set(dayList.map((item) => normalizeEmpId(item.empId))).size;
  const incompleteDayCount = dayList.filter((item) => !item.canCalculate).length;
  const scheduleArchive = Object.fromEntries(
    Object.entries(schedules || {}).filter(([dateKey]) => String(dateKey).startsWith(monthKey))
  );

  return {
    rawRecords,
    schedules: scheduleArchive,
    days,
    manifest: {
      monthKey,
      status: "archived",
      archivedAt,
      sourceRecordCount: Object.keys(rawRecords).length,
      snapshotDayCount: dayList.length,
      employeeCount,
      completeDayCount: dayList.length - incompleteDayCount,
      incompleteDayCount,
      subsidyTotal: dayList.reduce((sum, item) => sum + Number(item.subsidyAmount || 0), 0),
      scheduleDayCount: Object.keys(scheduleArchive).length,
    },
  };
};
