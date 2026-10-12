export const MONTHLY_GOAL_STORES = Object.freeze([
  { id: "storeA", name: "西螺文昌店" },
  { id: "storeB", name: "斗南站前店" },
]);
const MAX_AMOUNT = 999999999;
function validRevenueStartDate(value, month) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 7) !== month) return false;
  const [year, m, day] = value.split("-").map(Number), date = new Date(Date.UTC(year, m - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === m - 1 && date.getUTCDate() === day;
}
export function resolveMonthlyGoalStore(value) {
  return MONTHLY_GOAL_STORES.find((store) => store.id === value || store.name === value) || null;
}
export function monthlyGoalMonth(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(new Date(now));
  return `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}`;
}
export function monthlyGoalPath(storeValue, month) {
  const store = resolveMonthlyGoalStore(storeValue);
  if (!store || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ""))) throw new Error("請選擇正確的門市與月份。");
  return `monthly_store_goals/${store.id}/${month}`;
}
export function validateMonthlyGoalInput(input) {
  const targetText = String(input?.target ?? "").trim(), totalText = String(input?.total ?? "").trim();
  const target = Number(targetText), total = Number(totalText);
  if (!/^\d+$/.test(targetText) || !Number.isSafeInteger(target) || target <= 0 || target > MAX_AMOUNT) throw new Error("營業額目標請填寫 1 至 999,999,999 元的整數。");
  if (!/^\d+$/.test(totalText) || !Number.isSafeInteger(total) || total < 0 || total > MAX_AMOUNT) throw new Error("累計營業額請填寫 0 至 999,999,999 元的整數。");
  const text = String(input?.notesText ?? "");
  const notes = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ important: /^[!！]/.test(line), text: line.replace(/^[!！]\s*/, "") }));
  if (text.length > 800 || notes.length > 8 || notes.some((note) => !note.text || note.text.length > 300)) throw new Error("注意事項最多 8 項，每項 300 字以內、合計 800 字以內。");
  const revenueStartDate = String(input?.revenueStartDate || "");
  return { target, total, notes, ...(revenueStartDate ? { revenueStartDate } : {}) };
}
export function readMonthlyGoalRecord(raw, storeValue, month) {
  monthlyGoalPath(storeValue, month);
  if (raw === null || raw === undefined) return null;
  const store = resolveMonthlyGoalStore(storeValue);
  const notes = raw.notes ?? [];
  if (raw.schemaVersion !== 1 || raw.storeId !== store.id || raw.month !== month
    || !Number.isSafeInteger(raw.target) || raw.target <= 0 || raw.target > MAX_AMOUNT
    || !Number.isSafeInteger(raw.total) || raw.total < 0 || raw.total > MAX_AMOUNT
    || !Number.isSafeInteger(raw.revision) || raw.revision < 1
    || !Number.isFinite(raw.updatedAt) || raw.updatedAt <= 0
    || !validRevenueStartDate(raw.revenueStartDate, month)
    || !Array.isArray(notes) || notes.length > 8
    || notes.some((note) => !note || typeof note.important !== "boolean" || typeof note.text !== "string" || !note.text.trim() || note.text.length > 300)
    || notes.map((note) => `${note.important ? "！" : ""}${note.text}`).join("\n").length > 800) throw new Error("本月目標資料不完整，請重新讀取或請管理員確認。");
  return { storeId: store.id, month, target: raw.target, total: raw.total, notes, revision: raw.revision, updatedAt: raw.updatedAt,
    ...(raw.revenueStartDate ? { revenueStartDate: raw.revenueStartDate } : {}) };
}
export function monthlyGoalProgress(record) {
  if (!record) return null;
  const percent = Math.round(record.total / record.target * 1000) / 10;
  return { percent, position: Math.min(100, Math.max(0, percent)), remaining: Math.max(0, record.target - record.total), achieved: record.total >= record.target };
}
// Transaction boundary excludes all attendance, employee, meal and points data.
export function buildMonthlyGoalUpdate(current, input, context) {
  const { storeId, month, expectedRevision, operationId, actor, now } = context;
  monthlyGoalPath(storeId, month);
  const values = validateMonthlyGoalInput(input);
  if (!validRevenueStartDate(values.revenueStartDate, month)) throw new Error("每日營收起算日期必須是所選月份的有效日期。");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !/^[a-zA-Z0-9_-]{16,80}$/.test(operationId || "")
    || !actor?.uid || !Number.isFinite(now) || now <= 0) throw new Error("儲存資訊不完整，請重新讀取後再試。");
  const existing = readMonthlyGoalRecord(current, storeId, month);
  if (current?.lastOperationId === operationId) {
    if (current.updatedBy?.uid !== actor.uid || current.target !== values.target || current.total !== values.total
      || JSON.stringify(current.notes || []) !== JSON.stringify(values.notes)
      || (current.revenueStartDate || "") !== (values.revenueStartDate || "")) throw new Error("這次儲存內容已改變，請重新讀取確認。");
    return current;
  }
  if ((existing?.revision || 0) !== expectedRevision) throw new Error("另一位管理員已更新內容，請重新讀取後再修改，不會覆蓋他的資料。");
  const revision = expectedRevision + 1;
  return { schemaVersion: 1, storeId, month, ...values, revision, updatedAt: now,
    updatedBy: actor, lastOperationId: operationId,
    history: { ...(current?.history || {}), [revision]: { ...values, updatedAt: now, updatedBy: actor, operationId } },
  };
}
