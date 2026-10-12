import { createDailyRevenueAdapter } from "./dailyStoreRevenueFirebase";
import { auth } from "./firebase";
import { onValue, ref, runTransaction } from "firebase/database";
jest.mock("./firebase", () => ({ db: {}, auth: { currentUser: { uid: "test-device" } } }));
jest.mock("firebase/database", () => ({ ref: jest.fn(), onValue: jest.fn(), runTransaction: jest.fn(), serverTimestamp: () => ({ ".sv": "timestamp" }) }));
const context = { storeId: "storeA", month: "2026-10", dateKey: "2026-10-12", mode: "employee", operationId: "firebase-operation-00001", deviceStore: "西螺文昌店", isAuthorizedDevice: true, checkoutAt: Date.parse("2026-10-12T14:00:00+08:00"), empId: "TEST", name: "示範員工", checkoutRecordId: "1791784800000", deviceId: "DEV-TEST" };
const permission = { allowed: true, empId: "TEST", storeId: "storeA", managerTitle: "店長" };
const dailyRevenueAdapter = createDailyRevenueAdapter({ getPointsToken: async () => "points-session" });
const originalFetch = global.fetch;
const resolveTimestamps = (value) => value && typeof value === "object" ? value[".sv"] === "timestamp" ? context.checkoutAt : Array.isArray(value) ? value.map(resolveTimestamps) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveTimestamps(child)])) : value;
beforeEach(() => { ref.mockImplementation((_db, path) => path); auth.currentUser = { uid: "test-device", getIdToken: async () => "checkin-session" }; global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => permission }); });
afterAll(() => { global.fetch = originalFetch; });
test("only the requested store-month is subscribed", () => {
  const data = jest.fn(); dailyRevenueAdapter.subscribe("storeB", "2026-10", data, jest.fn()); expect(onValue.mock.calls[0][0]).toBe("daily_store_revenue/storeB/2026-10");
});
test("revenue transaction is independent of attendance and meal data, resolves timestamps and returns a verified receipt", async () => {
  const database = { employees: { keep: true }, records: { keep: true }, meal_records: { keep: true }, monthly_store_goals: { keep: true } }, before = JSON.stringify(database);
  runTransaction.mockImplementation(async (path, callback, options) => { expect(options).toEqual({ applyLocally: false }); database[path] = resolveTimestamps(callback(database[path] || null)); return { committed: true, snapshot: { val: () => database[path] } }; });
  const result = await dailyRevenueAdapter.save({ amount: "12500" }, context); expect(result).toMatchObject({ record: { amount: 12500, updatedAt: context.checkoutAt }, alreadyRecorded: false });
  const second = await dailyRevenueAdapter.save({ amount: "20000" }, { ...context, operationId: "firebase-operation-00002" }); expect(second).toMatchObject({ record: { amount: 12500 }, alreadyRecorded: true });
  const { ["daily_store_revenue/storeA/2026-10"]: created, ...other } = database; expect(JSON.stringify(other)).toBe(before); expect(created.days[context.dateKey].revision).toBe(1);
});
test("unauthenticated or denied writes do not report success", async () => {
  auth.currentUser = null; await expect(dailyRevenueAdapter.save({ amount: "1" }, context)).rejects.toThrow("尚未連線"); expect(runTransaction).not.toHaveBeenCalled();
  auth.currentUser = { uid: "test", getIdToken: async () => "checkin-session" }; runTransaction.mockRejectedValue(new Error("permission denied")); await expect(dailyRevenueAdapter.save({ amount: "1" }, context)).rejects.toThrow("permission denied");
});
test("before-cutoff requests abort before creating any daily record", async () => {
  await expect(dailyRevenueAdapter.save({ amount: "1" }, { ...context, checkoutAt: Date.parse("2026-10-12T13:29:59+08:00") })).rejects.toThrow("店長"); expect(runTransaction).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
test("every employee save refreshes the App permission; a revoked or cross-store permission never starts a transaction", async () => {
  for (const result of [{ allowed: false }, { ...permission, storeId: "storeB" }, { ...permission, empId: "OTHER" }]) {
    global.fetch.mockResolvedValue({ ok: true, json: async () => result });
    await expect(dailyRevenueAdapter.save({ amount: "1" }, { ...context, permission })).rejects.toMatchObject({ code: "revenue-permission-denied" });
  }
  expect(runTransaction).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ checkoutRecordId: context.checkoutRecordId, storeId: "storeA", deviceId: context.deviceId });
});
test("failed permission lookup fails closed without touching business records", async () => {
  global.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: "offline" }) });
  await expect(dailyRevenueAdapter.save({ amount: "1" }, context)).rejects.toThrow("無法確認"); expect(runTransaction).not.toHaveBeenCalled();
});
test("even a stuck authentication refresh times out without starting a revenue transaction", async () => {
  jest.useFakeTimers();
  try {
    const slow = createDailyRevenueAdapter({ getPointsToken: () => new Promise(() => {}) });
    const saving = slow.save({ amount: "1" }, context);
    const expected = expect(saving).rejects.toThrow("逾時");
    jest.advanceTimersByTime(8000); await expected;
    expect(runTransaction).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
