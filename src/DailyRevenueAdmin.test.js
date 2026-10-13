import React, { act } from "react";
import { createRoot } from "react-dom/client";
import DailyRevenueAdmin from "./DailyRevenueAdmin";
import { buildDailyRevenueUpdate, combineMonthlyRevenue } from "./dailyStoreRevenue";

const today = "2026-10-13", now = Date.parse(`${today}T15:00:00+08:00`);
const savedRecord = (amount = "12500", storeId = "storeA", dateKey = today) => buildDailyRevenueUpdate(null, { amount }, { storeId, month: dateKey.slice(0, 7), dateKey, mode: "admin", canEdit: true, expectedRevision: 0, actor: { uid: "other-admin", name: "另一位管理員" }, now, operationId: "existing-revenue-00001" });
let host, root, originalCrypto;
beforeEach(() => {
  originalCrypto = window.crypto;
  Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => "12345678-1234-4234-8234-123456789abc" } });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); Object.defineProperty(window, "crypto", { configurable: true, value: originalCrypto }); global.IS_REACT_ACT_ENVIRONMENT = false; });
function fixture() {
  const subscriptions = [];
  let ledger = null;
  const adapter = {
    subscribe: jest.fn((store, month, success, failure) => { const subscription = { store, month, success, failure, close: jest.fn() }; subscriptions.push(subscription); return subscription.close; }),
    save: jest.fn(async (input, context) => {
      ledger = buildDailyRevenueUpdate(ledger, input, { ...context, actor: { uid: "admin-one", name: "管理員", source: "admin" }, now });
      return { record: ledger.days[context.dateKey], alreadyRecorded: false };
    }),
  };
  return { adapter, subscriptions, setLedger: (value) => { ledger = value; }, getLedger: () => ledger };
}
const render = (f, props = {}) => act(() => root.render(<DailyRevenueAdmin canEdit enabled storeId="storeA" month="2026-10" deviceId="admin-device" adapter={f.adapter} today={today} {...props} />));
const ready = (f, ledger = null) => { f.setLedger(ledger); act(() => f.subscriptions.at(-1).success(ledger)); };
const fill = (label, value) => act(() => { const node = host.querySelector(`[aria-label="${label}"]`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
const send = () => host.querySelector('[aria-label="補登每日營收"]').dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const submit = () => act(async () => send());
const button = (text) => Array.from(host.querySelectorAll("button")).find((node) => node.textContent === text);

test("only an administrator can read or add; loading and failed reads never allow a write", async () => {
  const f = fixture(); render(f, { canEdit: false }); expect(host.textContent).toBe(""); expect(f.adapter.subscribe).not.toHaveBeenCalled();
  render(f); expect(host.querySelector(".daily-revenue-add fieldset").disabled).toBe(true); await submit(); expect(f.adapter.save).not.toHaveBeenCalled();
  act(() => f.subscriptions[0].failure(new Error("offline"))); expect(host.textContent).toContain("不會當成尚未填寫"); await submit(); expect(f.adapter.save).not.toHaveBeenCalled();
});
test("defaults to today's Taipei date and creates the store's missing revenue without a checkout", async () => {
  const f = fixture(); render(f); ready(f); expect(host.querySelector('[aria-label="補登營收日期"]').value).toBe(today);
  fill("補登營收金額", "12500"); await submit();
  expect(f.adapter.save.mock.calls[0][1]).toMatchObject({ storeId: "storeA", month: "2026-10", dateKey: today, expectedRevision: 0, mode: "admin", canEdit: true });
  expect(f.adapter.save.mock.calls[0][1].checkoutAt).toBeUndefined();
  expect(host.textContent).toContain("已補登 2026-10-13 營收 12,500 元");
  const ledger = f.getLedger(); expect(ledger.days[today].updatedBy).toMatchObject({ name: "管理員", source: "admin" }); expect(ledger.days[today].history[1].amount).toBe(12500);
  expect(combineMonthlyRevenue({ storeId: "storeA", month: "2026-10", target: 500000, total: 0, updatedAt: now }, ledger).goal.total).toBe(12500);
  ready(f, ledger); expect(button("已登記").disabled).toBe(true);
});
test("existing dates including zero cannot be added again; corrections preserve the old amount", async () => {
  const f = fixture(); render(f); ready(f, savedRecord("0")); expect(host.textContent).toContain("這天已登記 0 元"); expect(button("已登記").disabled).toBe(true);
  await submit(); expect(f.adapter.save).not.toHaveBeenCalled();
  act(() => button("修改").click()); fill(`${today} 修正營收`, "13000");
  await act(async () => host.querySelector(".daily-revenue-row form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(f.getLedger().days[today].history[1].amount).toBe(0); expect(f.getLedger().days[today].history[2].amount).toBe(13000); expect(host.textContent).toContain("已修正");
});
test("invalid amounts, future dates and a date from another month never save", async () => {
  const f = fixture(); render(f); ready(f); await submit(); expect(f.adapter.save).not.toHaveBeenCalled();
  fill("補登營收金額", "10000"); fill("補登營收日期", "2026-10-14"); await submit();
  fill("補登營收日期", "2026-09-30"); await submit(); expect(f.adapter.save).not.toHaveBeenCalled();
  expect(host.textContent).toContain("只能補登今天或之前");
});
test("rapid duplicate submission sends one operation; a concurrent first entry cannot be overwritten", async () => {
  const f = fixture(); render(f); ready(f); fill("補登營收金額", "99999");
  f.setLedger(savedRecord("12000")); let reject; f.adapter.save.mockImplementation(() => new Promise((_resolve, failure) => { reject = failure; }));
  act(() => { send(); send(); }); expect(f.adapter.save).toHaveBeenCalledTimes(1);
  const [input, context] = f.adapter.save.mock.calls[0];
  let conflict; try { buildDailyRevenueUpdate(f.getLedger(), input, { ...context, actor: { uid: "admin-one" }, now }); } catch (error) { conflict = error; }
  await act(async () => reject(conflict)); expect(f.getLedger().days[today].amount).toBe(12000); expect(host.querySelector(".daily-revenue-add fieldset").disabled).toBe(true);
  expect(host.querySelector('[aria-label="補登營收金額"]').value).toBe("99999");
  await submit(); expect(f.adapter.save).toHaveBeenCalledTimes(1);
  act(() => button("重新讀取每日營收").click()); ready(f, f.getLedger()); expect(button("已登記").disabled).toBe(true);
});
test("a lost response after commit requires a fresh read; it cannot create a second revenue entry", async () => {
  const f = fixture(); render(f); ready(f); fill("補登營收金額", "12500");
  const commit = f.adapter.save.getMockImplementation(); f.adapter.save.mockImplementation(async (...args) => { await commit(...args); throw new Error("lost response"); });
  await submit(); await submit(); expect(f.adapter.save).toHaveBeenCalledTimes(1); expect(Object.keys(f.getLedger().days)).toEqual([today]);
  act(() => button("重新讀取每日營收").click()); ready(f, f.getLedger()); expect(host.textContent).toContain("這天已登記 12,500 元"); expect(button("已登記").disabled).toBe(true);
});
test("switching stores or months clears the draft; an old save result cannot affect the new store", async () => {
  const f = fixture(); render(f); ready(f); fill("補登營收金額", "12500"); let resolve;
  f.adapter.save.mockImplementation(() => new Promise((success) => { resolve = success; })); act(send);
  render(f, { storeId: "storeB" }); expect(host.querySelector('[aria-label="補登營收金額"]').value).toBe("");
  await act(async () => resolve({ record: { dateKey: today, amount: 12500, revision: 1 } })); expect(host.textContent).not.toContain("已補登");
  expect(f.subscriptions.at(-1)).toMatchObject({ store: "storeB", month: "2026-10" });
  render(f, { storeId: "storeB", month: "2026-09" }); expect(host.querySelector('[aria-label="補登營收日期"]').value).toBe("2026-09-30"); expect(f.subscriptions.at(-1)).toMatchObject({ store: "storeB", month: "2026-09" });
});
