import { monthlyGoalAdapter } from "./monthlyStoreGoalsFirebase";
import { auth } from "./firebase";
import { onValue, ref, runTransaction } from "firebase/database";
import { buildMonthlyGoalUpdate } from "./monthlyStoreGoals";
jest.mock("./firebase", () => ({ db: {}, auth: { currentUser: { uid: "test-admin" } } }));
jest.mock("firebase/database", () => ({ ref: jest.fn((_db, path) => path), onValue: jest.fn(), runTransaction: jest.fn(), serverTimestamp: () => ({ ".sv": "timestamp" }) }));
const context = { canEdit: true, storeId: "storeA", month: "2026-10", expectedRevision: 0, operationId: "test-operation-00001", deviceId: "test-device" };
const input = { target: "500000", total: "320000", notesText: "事項" };
const resolveTimestamps = (value) => value && typeof value === "object" ? value[".sv"] === "timestamp" ? 1791806400000 : Array.isArray(value) ? value.map(resolveTimestamps) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveTimestamps(child)])) : value;
beforeEach(() => { jest.clearAllMocks(); ref.mockImplementation((_db, path) => path); auth.currentUser = { uid: "test-admin" }; });
test("reads one store-month path and unsubscribes without root or other-store access", () => {
  const close = jest.fn(); onValue.mockReturnValue(close); const data = jest.fn(), fail = jest.fn();
  expect(monthlyGoalAdapter.subscribe("storeB", "2026-10", data, fail)).toBe(close);
  expect(onValue.mock.calls[0][0]).toBe("monthly_store_goals/storeB/2026-10"); onValue.mock.calls[0][1]({ val: () => null }); expect(data).toHaveBeenCalledWith(null);
});
test("transaction updates just its node, preserves all other ledgers and resolves timestamp", async () => {
  const database = { employees: { keep: true }, records: { keep: true }, meals: { keep: true }, "monthly_store_goals/storeB/2026-10": { keep: true } };
  const before = JSON.stringify(database);
  runTransaction.mockImplementation(async (path, callback, options) => {
    expect(options).toEqual({ applyLocally: false });
    database[path] = resolveTimestamps(callback(database[path] || null));
    return { committed: true, snapshot: { val: () => database[path] } };
  });
  const receipt = await monthlyGoalAdapter.save(input, context);
  expect(receipt.total).toBe(320000); expect(receipt.revision).toBe(1); expect(receipt.updatedAt).toBe(1791806400000);
  const { ["monthly_store_goals/storeA/2026-10"]: created, ...other } = database;
  expect(JSON.stringify(other)).toBe(before); expect(created.history[1].updatedBy.uid).toBe("test-admin");
  await monthlyGoalAdapter.save(input, context); expect(Object.keys(database["monthly_store_goals/storeA/2026-10"].history)).toHaveLength(1);
});
test("stale version aborts instead of overwriting a concurrent edit", async () => {
  const current = buildMonthlyGoalUpdate(null, input, { ...context, actor: { uid: "another" }, now: 1791806400000 });
  runTransaction.mockImplementation(async (_path, callback) => { expect(callback(current)).toBeUndefined(); return { committed: false }; });
  await expect(monthlyGoalAdapter.save(input, { ...context, operationId: "different-operation-00001" })).rejects.toThrow("另一位管理員");
});
test("no current authentication or admin context blocks saving before any transaction", async () => {
  await expect(monthlyGoalAdapter.save(input, { ...context, canEdit: false })).rejects.toThrow("管理後台");
  auth.currentUser = null; await expect(monthlyGoalAdapter.save(input, context)).rejects.toThrow(); expect(runTransaction).not.toHaveBeenCalled();
});
test("a denied write never becomes a false success", async () => {
  runTransaction.mockRejectedValue(new Error("permission denied")); await expect(monthlyGoalAdapter.save(input, context)).rejects.toThrow("permission denied");
});
