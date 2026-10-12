import { monthlyGoalPath, resolveMonthlyGoalStore } from "./monthlyStoreGoals";

const MAX_AMOUNT = 999999999;
export function taipeiRevenueTime(timestamp) {
  if (!Number.isFinite(timestamp)) throw new Error("打卡時間不完整。");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp));
  const value = (type) => parts.find((part) => part.type === type).value;
  return { date: `${value("year")}-${value("month")}-${value("day")}`, minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}
export function isRevenueDate(date, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date || "") || date.slice(0, 7) !== month) return false;
  const [year, m, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, m - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === m - 1 && value.getUTCDate() === day;
}
export function dailyRevenuePath(storeValue, month) {
  monthlyGoalPath(storeValue, month);
  return `daily_store_revenue/${resolveMonthlyGoalStore(storeValue).id}/${month}`;
}
export function isCheckoutRevenueEligible(checkout) {
  if (!checkout?.isAuthorizedDevice || !resolveMonthlyGoalStore(checkout?.revenueStore) || !checkout?.empId) return false;
  try {
    const time = taipeiRevenueTime(checkout.checkoutAt);
    return time.date === checkout.dateKey && time.minutes >= 13 * 60 + 30;
  } catch (_) { return false; }
}
export function hasRevenueManagerPermission(permission, checkout) {
  return permission?.allowed === true
    && permission.empId === String(checkout?.empId || "").trim().toUpperCase()
    && permission.storeId === resolveMonthlyGoalStore(checkout?.revenueStore)?.id
    && ["店長", "代理店長"].includes(permission.managerTitle);
}
export function validateDailyRevenueAmount(value) {
  const text = String(value ?? "").trim(), amount = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(amount) || amount < 0 || amount > MAX_AMOUNT) throw new Error("請填寫 0 至 999,999,999 元的整數；尚未結帳請選稍後再填。");
  return amount;
}
export function revenueOperationId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) throw new Error("瀏覽器無法準備安全的儲存識別。");
  return Array.from(window.crypto.getRandomValues(new Uint8Array(16))).map((value) => value.toString(16).padStart(2, "0")).join("");
}
export function readDailyRevenueLedger(raw, storeValue, month) {
  dailyRevenuePath(storeValue, month);
  if (raw === null || raw === undefined) return { storeId: resolveMonthlyGoalStore(storeValue).id, month, days: {} };
  const days = raw.days || {};
  if (raw.schemaVersion !== 1 || raw.storeId !== resolveMonthlyGoalStore(storeValue).id || raw.month !== month || typeof days !== "object" || Array.isArray(days)) throw new Error("每日營收資料不完整，請重新讀取。");
  for (const [date, record] of Object.entries(days)) {
    if (!isRevenueDate(date, month) || record?.dateKey !== date || !Number.isSafeInteger(record.amount) || record.amount < 0 || record.amount > MAX_AMOUNT
      || !Number.isSafeInteger(record.revision) || record.revision < 1 || !Number.isFinite(record.updatedAt) || record.updatedAt <= 0
      || typeof record.updatedBy?.uid !== "string" || !record.updatedBy.uid) throw new Error("每日營收資料不完整，請重新讀取。");
  }
  return { storeId: raw.storeId, month, days };
}
// One store-month transaction contains only daily revenue. Attendance and meal writes never join it.
export function buildDailyRevenueUpdate(current, input, context) {
  const { storeId, month, dateKey, mode, actor, now, operationId, expectedRevision = 0 } = context;
  const ledger = readDailyRevenueLedger(current, storeId, month);
  const amount = validateDailyRevenueAmount(input.amount);
  if (!isRevenueDate(dateKey, month) || !actor?.uid || !Number.isFinite(now) || now <= 0 || !/^[a-zA-Z0-9_-]{16,80}$/.test(operationId || "")) throw new Error("營收儲存資訊不完整。");
  if (mode === "employee") {
    if (!isCheckoutRevenueEligible({ ...context, revenueStore: context.deviceStore }) || resolveMonthlyGoalStore(context.deviceStore)?.id !== storeId) throw new Error("只有已授權門市下午 1:30 後的下班打卡可以登記營收。");
    if (!hasRevenueManagerPermission(context.permission, { ...context, revenueStore: context.deviceStore })) throw new Error("只有本店店長或代理店長可以登記營收。");
  } else if (mode !== "admin" || !context.canEdit) throw new Error("請由管理員修正已登記的營收。");
  const existing = ledger.days[dateKey];
  if (existing?.lastOperationId === operationId) {
    if (existing.updatedBy.uid !== actor.uid || existing.amount !== amount) throw new Error("這次儲存內容已改變，請重新讀取。");
    return current;
  }
  // Another employee may have filled it while this dialog was open. Never overwrite their entry.
  if (mode === "employee" && existing) return current;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || (existing?.revision || 0) !== expectedRevision) throw new Error("這天營收已被更新，請重新讀取後再修改。");
  const revision = expectedRevision + 1;
  const details = { amount, dateKey, revision, updatedAt: now, updatedBy: actor, lastOperationId: operationId };
  const record = { ...details, history: { ...(existing?.history || {}), [revision]: { ...details } } };
  return { ...(current || {}), schemaVersion: 1, storeId, month, days: { ...ledger.days, [dateKey]: record } };
}
export function combineMonthlyRevenue(goal, ledger) {
  if (!goal) return { goal: null, needsOpeningDate: false, dailyTotal: 0 };
  if (ledger && (ledger.storeId !== goal.storeId || ledger.month !== goal.month)) throw new Error("門市或月份不符。");
  const entries = Object.values(ledger?.days || {});
  const start = goal.revenueStartDate || (goal.total === 0 ? `${goal.month}-01` : "");
  // Preserve a legacy manual total until its coverage date is explicitly confirmed.
  if (!start && entries.length) return { goal, needsOpeningDate: true, dailyTotal: 0 };
  const dailyTotal = entries.filter((entry) => !start || entry.dateKey >= start).reduce((sum, entry) => sum + entry.amount, 0);
  const total = goal.total + dailyTotal;
  if (!Number.isSafeInteger(total) || total > MAX_AMOUNT) throw new Error("本月累計超過可支援金額，請管理員確認。");
  return { goal: { ...goal, total, updatedAt: Math.max(goal.updatedAt, ...entries.map((entry) => entry.updatedAt)) }, dailyTotal, needsOpeningDate: false };
}
