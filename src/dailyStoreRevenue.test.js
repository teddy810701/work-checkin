import { buildDailyRevenueUpdate, combineMonthlyRevenue, dailyRevenuePath, hasRevenueManagerPermission, isCheckoutRevenueEligible, readDailyRevenueLedger, validateDailyRevenueAmount } from "./dailyStoreRevenue";
const at = (time) => Date.parse(`2026-10-12T${time}+08:00`);
const checkout = { empId: "A0315", name: "示範員工", dateKey: "2026-10-12", checkoutAt: at("13:30:00"), revenueStore: "斗南站前店", isAuthorizedDevice: true };
const permission = { allowed: true, empId: "A0315", storeId: "storeB", managerTitle: "店長" };
const context = { ...checkout, permission, storeId: "storeB", month: "2026-10", deviceStore: checkout.revenueStore, mode: "employee", actor: { uid: "device-a", name: "示範員工" }, now: at("13:31:00"), operationId: "daily-operation-00001" };
const goal = { storeId: "storeB", month: "2026-10", target: 500000, total: 0, updatedAt: at("05:00:00") };
test("revenue permission requires an allowed canonical employee profile and the same store", () => {
  expect(hasRevenueManagerPermission(permission, checkout)).toBe(true);
  expect(hasRevenueManagerPermission({ ...permission, managerTitle: "代理店長" }, checkout)).toBe(true);
  expect(hasRevenueManagerPermission({ ...permission, managerTitle: "" }, checkout)).toBe(true);
  [null, { ...permission, allowed: false }, { ...permission, storeId: "storeA" }, { ...permission, empId: "OTHER" }].forEach((value) => {
    expect(hasRevenueManagerPermission(value, checkout)).toBe(false);
    expect(() => buildDailyRevenueUpdate(null, { amount: "1" }, { ...context, permission: value })).toThrow("權限");
  });
});
test("only a successful bound-store checkout at or after 13:30 Taipei is eligible", () => {
  expect(isCheckoutRevenueEligible(checkout)).toBe(true);
  expect(isCheckoutRevenueEligible({ ...checkout, checkoutAt: at("13:29:59") })).toBe(false);
  expect(isCheckoutRevenueEligible({ ...checkout, checkoutAt: at("23:59:59") })).toBe(true);
  expect(isCheckoutRevenueEligible({ ...checkout, checkoutAt: Date.parse("2026-10-12T05:30:00Z") })).toBe(true);
  expect(isCheckoutRevenueEligible({ ...checkout, checkoutAt: Date.parse("2026-10-12T16:00:00Z") })).toBe(false);
  expect(isCheckoutRevenueEligible({ ...checkout, isAuthorizedDevice: false })).toBe(false);
  expect(isCheckoutRevenueEligible({ ...checkout, revenueStore: "老闆電腦" })).toBe(false);
  expect(isCheckoutRevenueEligible({ ...checkout, empId: "" })).toBe(false);
});
test("zero is a recorded amount; blank, decimal, negative and excessive amounts are invalid", () => {
  expect(validateDailyRevenueAmount("0")).toBe(0);
  ["", "-1", "1.5", "1e3", "1000000000", "NaN"].forEach((amount) => expect(() => validateDailyRevenueAmount(amount)).toThrow());
});
test("narrow paths and corrupt or cross-store records cannot be accepted", () => {
  expect(dailyRevenuePath("斗南站前店", "2026-10")).toBe("daily_store_revenue/storeB/2026-10");
  expect(() => dailyRevenuePath("全部", "2026-10")).toThrow();
  expect(() => dailyRevenuePath("storeA", "2026-13")).toThrow();
  const raw = buildDailyRevenueUpdate(null, { amount: "12500" }, context);
  expect(() => readDailyRevenueLedger(raw, "storeA", "2026-10")).toThrow();
  expect(() => readDailyRevenueLedger({ ...raw, days: { "2026-10-32": { ...raw.days[checkout.dateKey], dateKey: "2026-10-32" } } }, "storeB", "2026-10")).toThrow();
});
test("first employee entry wins; same-day retries or other employees never add or overwrite it", () => {
  const first = buildDailyRevenueUpdate(null, { amount: "12500" }, context);
  expect(buildDailyRevenueUpdate(first, { amount: "12500" }, context)).toBe(first);
  const other = { ...context, actor: { uid: "device-b", name: "其他員工" }, operationId: "daily-operation-00002" };
  expect(buildDailyRevenueUpdate(first, { amount: "99999" }, other)).toBe(first);
  expect(Object.keys(first.days)).toEqual([checkout.dateKey]);
  expect(combineMonthlyRevenue(goal, readDailyRevenueLedger(first, "storeB", "2026-10")).goal.total).toBe(12500);
});
test("employee cannot change scope or submit before cutoff; administrators need edit context", () => {
  expect(() => buildDailyRevenueUpdate(null, { amount: "1" }, { ...context, storeId: "storeA" })).toThrow();
  expect(() => buildDailyRevenueUpdate(null, { amount: "1" }, { ...context, checkoutAt: at("13:29:00") })).toThrow();
  expect(() => buildDailyRevenueUpdate(null, { amount: "1" }, { ...context, mode: "admin", canEdit: false })).toThrow();
});
test("administrator corrections replace one day's value and preserve version history and other dates", () => {
  const first = buildDailyRevenueUpdate(null, { amount: "12500" }, context);
  const tomorrow = buildDailyRevenueUpdate(first, { amount: "10000" }, { ...context, dateKey: "2026-10-13", checkoutAt: Date.parse("2026-10-13T14:00:00+08:00"), operationId: "daily-operation-00003" });
  const corrected = buildDailyRevenueUpdate(tomorrow, { amount: "13000" }, { ...context, mode: "admin", canEdit: true, expectedRevision: 1, operationId: "admin-operation-00001" });
  expect(corrected.days["2026-10-13"]).toEqual(tomorrow.days["2026-10-13"]);
  expect(corrected.days[checkout.dateKey].history[1].amount).toBe(12500);
  expect(corrected.days[checkout.dateKey].history[2].amount).toBe(13000);
  expect(combineMonthlyRevenue(goal, corrected).goal.total).toBe(23000);
  expect(() => buildDailyRevenueUpdate(corrected, { amount: "1" }, { ...context, mode: "admin", canEdit: true, expectedRevision: 1, operationId: "admin-operation-00002" })).toThrow("已被更新");
});
test("legacy cumulative amount is preserved until start date is confirmed, preventing double counting", () => {
  const ledger = buildDailyRevenueUpdate(null, { amount: "12500" }, context);
  const legacy = { ...goal, total: 320000 };
  expect(combineMonthlyRevenue(legacy, ledger)).toMatchObject({ goal: { total: 320000 }, needsOpeningDate: true });
  expect(combineMonthlyRevenue({ ...legacy, revenueStartDate: "2026-10-12" }, ledger).goal.total).toBe(332500);
  expect(combineMonthlyRevenue({ ...legacy, revenueStartDate: "2026-10-13" }, ledger).goal.total).toBe(320000);
  expect(() => combineMonthlyRevenue({ ...goal, storeId: "storeA" }, ledger)).toThrow();
});
test("two different dates count once each; next month never reuses the previous month", () => {
  const first = buildDailyRevenueUpdate(null, { amount: "0" }, context);
  const second = buildDailyRevenueUpdate(first, { amount: "10000" }, { ...context, dateKey: "2026-10-13", checkoutAt: Date.parse("2026-10-13T14:00:00+08:00"), operationId: "daily-operation-00004" });
  expect(combineMonthlyRevenue(goal, second).dailyTotal).toBe(10000);
  expect(() => readDailyRevenueLedger(second, "storeB", "2026-11")).toThrow();
});
