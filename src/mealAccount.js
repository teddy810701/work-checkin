import { calculateArchivedWorkDay, getMealSubsidyFromHours } from "./monthlyArchive.js";

const normalizeEmpId = (value) => String(value || "").trim().toUpperCase();
const FIRST_SETTLEMENT_MONTH = "2026-06";

const recordDateKey = (record) => {
  if (record?.dateKey) return String(record.dateKey).slice(0, 10);
  if (!record?.createdAt) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(record.createdAt));
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value || "").join("-");
};

export const normalizeSubsidyMultiplier = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, Math.round(parsed * 1000) / 1000));
};

export const applySubsidyMultiplier = (amount, multiplier) => (
  Math.round(Math.max(0, Number(amount) || 0) * normalizeSubsidyMultiplier(multiplier))
);

const isSettlementDate = (dateKey, monthKey) => {
  const itemMonth = String(dateKey || "").slice(0, 7);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
    && itemMonth >= FIRST_SETTLEMENT_MONTH && itemMonth <= monthKey;
};

export const getMealAccountMonths = ({ empId, monthKey, mealRecords = {}, records = [] }) => {
  const empKey = normalizeEmpId(empId);
  const months = new Set([monthKey]);
  [...Object.values(mealRecords), ...records].forEach((item) => {
    if (!item || normalizeEmpId(item.empId) !== empKey) return;
    const dateKey = recordDateKey(item);
    if (isSettlementDate(dateKey, monthKey)) months.add(dateKey.slice(0, 7));
  });
  return [...months].sort();
};

const resolveBaseSubsidy = (work, snapshot, meal) => {
  // Keep the same precedence as the staff-meal system: punches, month snapshot, saved meal.
  if (work.canCalculate) return work.subsidyAmount;
  if (snapshot && Number(snapshot.recordCount || 0) > 0) {
    return snapshot.canCalculate ? Math.max(0, Number(snapshot.subsidyAmount) || 0) : 0;
  }
  if (!meal) return 0;
  if (meal.baseSubsidyAmount !== undefined && meal.baseSubsidyAmount !== null) {
    return Math.max(0, Number(meal.baseSubsidyAmount) || 0);
  }
  if (meal.calculatedSubsidyAmount !== undefined && meal.calculatedSubsidyAmount !== null) {
    return Math.max(0, Number(meal.calculatedSubsidyAmount) || 0);
  }
  if (meal.workHours !== undefined && meal.workHours !== null && meal.workHours !== "") {
    return getMealSubsidyFromHours(meal.workHours);
  }
  return Math.max(0, Number(meal.subsidyAmount) || 0);
};

export const calculateMealAccount = ({
  empId, monthKey, mealRecords = {}, records = [], attendanceSnapshots = {}, adjustments = {},
}) => {
  const empKey = normalizeEmpId(empId);
  const days = new Map();
  const getDay = (item) => {
    if (!item || normalizeEmpId(item.empId) !== empKey) return null;
    const dateKey = recordDateKey(item);
    if (!isSettlementDate(dateKey, monthKey)) return null;
    if (!days.has(dateKey)) days.set(dateKey, { records: [], meal: null, snapshot: null });
    return days.get(dateKey);
  };
  records.forEach((item) => {
    const day = getDay(item);
    if (day) day.records.push(item);
  });
  Object.entries(mealRecords).forEach(([key, item]) => {
    if (key === "payments") return;
    const day = getDay(item);
    if (day) day.meal = item;
  });
  Object.values(attendanceSnapshots).forEach((month) => {
    Object.values(month?.days || {}).forEach((item) => {
      const day = getDay(item);
      if (day) day.snapshot = item;
    });
  });

  const monthlyTotals = {};
  days.forEach((day, dateKey) => {
    const itemMonth = dateKey.slice(0, 7);
    const totals = monthlyTotals[itemMonth] ||= { totalMeal: 0, totalSubsidy: 0 };
    const meal = day.meal;
    totals.totalMeal += Math.max(0, Number(meal?.mealAmount) || 0);
    const approvalStatus = meal?.approvalStatus || (meal?.approvalRequired ? "pending" : "approved");
    if (meal?.approvalRequired && approvalStatus !== "approved") return;
    const work = calculateArchivedWorkDay(day.records);
    const baseSubsidy = resolveBaseSubsidy(work, day.snapshot, meal);
    const multiplier = adjustments?.[itemMonth]?.[empKey]?.multiplier;
    totals.totalSubsidy += applySubsidyMultiplier(baseSubsidy, multiplier);
  });

  const getMonthDebt = (targetMonth) => {
    const totals = monthlyTotals[targetMonth] || { totalMeal: 0, totalSubsidy: 0 };
    const payment = mealRecords.payments?.[`${targetMonth}_${empId}`]
      || mealRecords.payments?.[`${targetMonth}_${empKey}`];
    return payment?.paid ? 0 : Math.round(Math.max(0, totals.totalMeal - totals.totalSubsidy) * 0.9);
  };
  return {
    multiplier: normalizeSubsidyMultiplier(adjustments?.[monthKey]?.[empKey]?.multiplier),
    outstanding: getMonthDebt(monthKey),
    previousDebts: Object.keys(monthlyTotals).filter((itemMonth) => itemMonth < monthKey).sort()
      .map((itemMonth) => ({ monthKey: itemMonth, amount: getMonthDebt(itemMonth) }))
      .filter((item) => item.amount > 0),
    monthlyTotals,
  };
};
