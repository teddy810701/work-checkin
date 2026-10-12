export const MISSED_PUNCH_TYPES = ["上班", "休息開始", "休息結束", "下班"];
const typeKeys = ["work_in", "break_start", "break_end", "work_out"];
const normalizeId = (value) => String(value || "").trim().toUpperCase();

export function findMissedPunchEmployee(employees, empId) {
  const id = normalizeId(empId);
  return id ? employees.find((employee) => !employee.archived
    && [employee.empId, employee.id].some((value) => normalizeId(value) === id)) : undefined;
}

export function formatMissedPunchDateTime(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function validateDirectMissedPunch(input, employees, now = Date.now()) {
  if (!normalizeId(input.empId)) throw new Error("請先輸入工號。");
  const employee = findMissedPunchEmployee(employees, input.empId);
  if (!employee) throw new Error("找不到這個工號，請確認工號或請管理員協助。");
  if (!MISSED_PUNCH_TYPES.includes(input.missingType)) throw new Error("請選擇忘打卡類型。");
  const dateTime = String(input.dateTime || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTime)) throw new Error("請填寫實際忘打卡的日期與時間。");
  // The form always represents Taiwan time, even when the browser uses another timezone.
  const requestedAt = Date.parse(`${dateTime}:00+08:00`);
  if (!Number.isFinite(requestedAt) || formatMissedPunchDateTime(requestedAt) !== dateTime) {
    throw new Error("日期或時間不正確，請重新選擇。");
  }
  if (requestedAt > now) throw new Error("還沒到這個時間，不能申請未來的打卡紀錄。");
  const note = String(input.reason || "").trim();
  if (!note) throw new Error("請填寫忘打卡原因。");
  if (note.length > 300) throw new Error("原因請控制在 300 字以內。");
  return { employee, dateTime, requestedAt, note, missingType: input.missingType };
}

export function buildDirectMissedPunchRequest(input, employees, { now = Date.now(), device = "", deviceLabel = "" } = {}) {
  const { employee, dateTime, requestedAt, note, missingType } = validateDirectMissedPunch(input, employees, now);
  const empId = employee.empId || employee.id;
  // A stable occurrence key makes a double-tap or retry harmless without touching attendance records.
  const encodedId = Array.from(String(empId)).map((char) => char.codePointAt(0).toString(16)).join("-");
  const id = `direct_${encodedId}_${typeKeys[MISSED_PUNCH_TYPES.indexOf(missingType)]}_${requestedAt}`;
  return {
    id, actionType: "missed_clock_request", empId, employeeKey: employee.id,
    name: employee.name || "", store: employee.store || "", role: employee.role || "",
    reason: "忘打卡申請", note: `${missingType}忘打卡：${note}`,
    occurrenceDate: dateTime.slice(0, 10), requestDate: dateTime.slice(0, 10),
    requestDateTime: dateTime, requestedAt, requestTime: dateTime.slice(11, 16),
    requestStatus: "pending", operator: employee.name || "", operatorKey: "employee_request",
    operatorStoreLabel: employee.store || "", source: "work_checkin", entryPoint: "sidebar",
    missingType, targetType: "", targetPunchCompleted: false, requestOnly: true,
    device, deviceLabel, createdAt: now, updatedAt: now,
  };
}

export async function sendDirectMissedPunchRequest(input, employees, adapter, context) {
  const request = buildDirectMissedPunchRequest(input, employees, context);
  const outcome = await adapter.createIfAbsent(request);
  const stored = outcome?.request;
  if (!stored || stored.id !== request.id) throw new Error("申請未確認成功，請稍後再試。");
  if (stored.requestStatus === "rejected") throw new Error("這筆申請已被駁回，請先聯絡管理員確認，不會覆蓋原本的審核紀錄。");
  if (!["pending", "approved"].includes(stored.requestStatus)) throw new Error("申請狀態不正確，請聯絡管理員。");
  return { request: stored, alreadySent: !outcome.created, status: stored.requestStatus };
}
