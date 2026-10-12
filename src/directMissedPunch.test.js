import { buildDirectMissedPunchRequest, findMissedPunchEmployee, formatMissedPunchDateTime, sendDirectMissedPunchRequest, validateDirectMissedPunch } from "./directMissedPunch";
import { readFileSync } from "fs";

const now = Date.parse("2026-10-12T09:00:00+08:00");
const employees = [{ id: "employee-1", empId: "A0001", name: "示範員工", store: "西螺文昌店", role: "正職" }];
const input = { empId: "a0001", missingType: "上班", dateTime: "2026-10-12T05:30", reason: " 忙著備料忘記打卡 " };

test("employee identity resolves only active checkin employees", () => {
  expect(findMissedPunchEmployee(employees, " a0001 ").name).toBe("示範員工");
  expect(findMissedPunchEmployee([{ ...employees[0], archived: true }], "A0001")).toBeUndefined();
  expect(() => validateDirectMissedPunch({ ...input, empId: "missing" }, employees, now)).toThrow("找不到");
});

test.each(["上班", "休息開始", "休息結束", "下班"])("%s produces a request only and preserves the existing review schema", (missingType) => {
  const request = buildDirectMissedPunchRequest({ ...input, missingType }, employees, { now, device: "demo" });
  expect(request).toMatchObject({ actionType: "missed_clock_request", empId: "A0001", employeeKey: "employee-1",
    missingType, requestStatus: "pending", source: "work_checkin", entryPoint: "sidebar", targetType: "",
    targetPunchCompleted: false, requestOnly: true, requestDateTime: input.dateTime, requestDate: "2026-10-12", requestTime: "05:30" });
  expect(request.requestedAt).toBe(Date.parse("2026-10-12T05:30:00+08:00"));
  expect(request.note).toBe(`${missingType}忘打卡：忙著備料忘記打卡`);
});

test.each([
  [{ empId: "" }, "請先輸入"], [{ missingType: "加班" }, "類型"], [{ dateTime: "" }, "日期與時間"],
  [{ dateTime: "2026-02-31T05:30" }, "不正確"], [{ dateTime: "2026-10-12T09:01" }, "未來"],
  [{ dateTime: "2026-10-13T05:30" }, "未來"], [{ reason: "   " }, "原因"],
])("invalid request %j is rejected before any adapter write", (change, message) => {
  expect(() => validateDirectMissedPunch({ ...input, ...change }, employees, now)).toThrow(message);
});

test("Taipei date conversion handles midnight explicitly", () => {
  expect(formatMissedPunchDateTime(Date.parse("2026-10-11T16:00:00Z"))).toBe("2026-10-12T00:00");
});

test("retry, even within the same millisecond, keeps only one pending request", async () => {
  const stored = new Map();
  const adapter = { createIfAbsent: jest.fn(async (request) => {
    const created = !stored.has(request.id);
    if (created) stored.set(request.id, request);
    return { created, request: stored.get(request.id) };
  }) };
  const first = await sendDirectMissedPunchRequest(input, employees, adapter, { now });
  const retry = await sendDirectMissedPunchRequest(input, employees, adapter, { now });
  expect(first.alreadySent).toBe(false);
  expect(retry.alreadySent).toBe(true);
  expect(stored.size).toBe(1);
});

test("never overwrites an approved or rejected review", async () => {
  const request = buildDirectMissedPunchRequest(input, employees, { now });
  const approved = { ...request, requestStatus: "approved", reviewedAt: now + 1 };
  const result = await sendDirectMissedPunchRequest(input, employees, { createIfAbsent: async () => ({ created: false, request: approved }) }, { now });
  expect(result.status).toBe("approved"); expect(result.alreadySent).toBe(true);
  await expect(sendDirectMissedPunchRequest(input, employees, { createIfAbsent: async () => ({ created: false, request: { ...request, requestStatus: "rejected" } }) }, { now })).rejects.toThrow("駁回");
});

test("write failures are not reported as success", async () => {
  await expect(sendDirectMissedPunchRequest(input, employees, { createIfAbsent: async () => { throw new Error("offline"); } }, { now })).rejects.toThrow("offline");
});

test("real sidebar places the entry between leave and meals; submit only writes requests", () => {
  const source = readFileSync(`${__dirname}/App.js`, "utf8");
  const entry = source.indexOf("<DirectMissedPunchEntry");
  expect(entry).toBeGreaterThan(source.indexOf("📝 請假／調假"));
  expect(entry).toBeLessThan(source.indexOf("🍱 員工餐"));
  const submit = source.slice(source.indexOf("const submitDirectMissedPunch ="), source.indexOf("const getEmployeeTodayLateMinutes ="));
  expect(submit).toContain("missed_punch_requests/${request.id}");
  expect(submit).toContain("isAuthorizedDevice");
  expect(submit).not.toMatch(/checkIn\(|records\/|\/status|fsSetDoc\(/);
});
