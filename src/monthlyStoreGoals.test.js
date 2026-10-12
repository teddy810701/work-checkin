import { buildMonthlyGoalUpdate, monthlyGoalMonth, monthlyGoalPath, monthlyGoalProgress, readMonthlyGoalRecord, resolveMonthlyGoalStore, validateMonthlyGoalInput } from "./monthlyStoreGoals";
const context = { storeId: "storeA", month: "2026-10", expectedRevision: 0, operationId: "operation-0000000001", actor: { uid: "admin-a", device: "device-a" }, now: 1791806400000 };
const input = { target: "500000", total: "320000", notesText: "！出餐前確認\n減少報廢" };
const create = () => buildMonthlyGoalUpdate(null, input, context);
test("Taipei month switches at Taiwan midnight, not browser timezone", () => {
  expect(monthlyGoalMonth(Date.parse("2026-09-30T15:59:59Z"))).toBe("2026-09");
  expect(monthlyGoalMonth(Date.parse("2026-09-30T16:00:00Z"))).toBe("2026-10");
});
test("only recognized bound stores and valid months can form a narrow path", () => {
  expect(monthlyGoalPath("西螺文昌店", "2026-10")).toBe("monthly_store_goals/storeA/2026-10");
  expect(monthlyGoalPath("斗南站前店", "2026-10")).toBe("monthly_store_goals/storeB/2026-10");
  ["", "老闆電腦", "storeA/../storeB", "全部"].forEach((store) => expect(resolveMonthlyGoalStore(store)).toBeNull());
  ["2026-00", "2026-13", "2026-10/../09", ""].forEach((month) => expect(() => monthlyGoalPath("storeA", month)).toThrow());
});
test("valid target and zero sales retain notes and importance", () => {
  expect(validateMonthlyGoalInput({ ...input, total: "0" })).toEqual({ target: 500000, total: 0, notes: [{ text: "出餐前確認", important: true }, { text: "減少報廢", important: false }] });
});
test("invalid, negative, decimal, blank and excessive amounts never save", () => {
  ["0", "-1", "1.5", "", "NaN", "1e6", "1000000000"].forEach((target) => expect(() => validateMonthlyGoalInput({ ...input, target })).toThrow());
  ["-1", "1.5", "", "NaN"].forEach((total) => expect(() => validateMonthlyGoalInput({ ...input, total })).toThrow());
  expect(() => validateMonthlyGoalInput({ ...input, notesText: Array(9).fill("事項").join("\n") })).toThrow();
  expect(() => validateMonthlyGoalInput({ ...input, notesText: "！" })).toThrow();
});
test("missing data stays absent; corrupt and cross-scope data never becomes a false zero", () => {
  expect(readMonthlyGoalRecord(null, "storeA", "2026-10")).toBeNull();
  const raw = create();
  expect(() => readMonthlyGoalRecord(raw, "storeB", "2026-10")).toThrow();
  expect(() => readMonthlyGoalRecord(raw, "storeA", "2026-11")).toThrow();
  expect(() => readMonthlyGoalRecord({ ...raw, total: undefined }, "storeA", "2026-10")).toThrow();
  const empty = buildMonthlyGoalUpdate(null, { ...input, notesText: "" }, context);
  delete empty.notes; expect(readMonthlyGoalRecord(empty, "storeA", "2026-10").notes).toEqual([]);
});
test("zero, actual rate and over-goal positions are bounded with actual numbers", () => {
  expect(monthlyGoalProgress({ target: 500000, total: 0 })).toEqual({ percent: 0, position: 0, remaining: 500000, achieved: false });
  expect(monthlyGoalProgress(create()).percent).toBe(64);
  expect(monthlyGoalProgress({ target: 500000, total: 560000 })).toEqual({ percent: 112, position: 100, remaining: 0, achieved: true });
});
test("updates keep revision history and refuse a stale administrator", () => {
  const first = create();
  const second = buildMonthlyGoalUpdate(first, { ...input, total: "400000" }, { ...context, expectedRevision: 1, operationId: "operation-0000000002" });
  expect(second.revision).toBe(2); expect(second.history[1]).toEqual(first.history[1]); expect(first.total).toBe(320000);
  expect(() => buildMonthlyGoalUpdate(second, input, { ...context, expectedRevision: 1, operationId: "operation-0000000003" })).toThrow("另一位管理員");
});
test("same operation recovers its original receipt but never accepts changed input", () => {
  const first = create(); expect(buildMonthlyGoalUpdate(first, input, context)).toBe(first);
  expect(() => buildMonthlyGoalUpdate(first, { ...input, total: "1" }, context)).toThrow();
  expect(() => buildMonthlyGoalUpdate(first, input, { ...context, actor: { uid: "another" } })).toThrow();
});
