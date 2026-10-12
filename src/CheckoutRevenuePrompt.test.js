import React, { act } from "react";
import { createRoot } from "react-dom/client";
import CheckoutRevenuePrompt, { CheckoutRevenueStage } from "./CheckoutRevenuePrompt";
import { buildDailyRevenueUpdate } from "./dailyStoreRevenue";
const checkout = { empId: "A0315", name: "支援員工", dateKey: "2026-10-12", checkoutAt: Date.parse("2026-10-12T13:30:00+08:00"), revenueStore: "斗南站前店", store: "西螺文昌店", deviceId: "demo", isAuthorizedDevice: true };
const permission = { allowed: true, empId: "A0315", storeId: "storeB", managerTitle: "店長" };
let host, root, originalCrypto;
beforeEach(() => { originalCrypto = window.crypto; Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => "12345678-1234-4234-8234-123456789abc" } }); global.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); Object.defineProperty(window, "crypto", { configurable: true, value: originalCrypto }); global.IS_REACT_ACT_ENVIRONMENT = false; });
function fixture() {
  const subscriptions = [];
  const adapter = { checkPermission: jest.fn().mockResolvedValue(permission), subscribe: jest.fn((store, month, success, failure) => { const sub = { store, month, success, failure, close: jest.fn() }; subscriptions.push(sub); return sub.close; }), save: jest.fn() };
  return { adapter, subscriptions, done: jest.fn() };
}
const render = (f, item = checkout) => act(() => root.render(<CheckoutRevenuePrompt checkout={item} permission={permission} adapter={f.adapter} onDone={f.done} />));
const fill = (value) => act(() => { const node = host.querySelector("input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
const submit = async () => act(async () => host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const recorded = (amount = "12500") => buildDailyRevenueUpdate(null, { amount }, { ...checkout, permission, storeId: "storeB", month: "2026-10", deviceStore: checkout.revenueStore, mode: "employee", actor: { uid: "one", name: "員工" }, now: checkout.checkoutAt, operationId: "fixture-operation-0001" });
test("13:29 checkout and unbound devices never open or read daily revenue", () => {
  const f = fixture(); render(f, { ...checkout, checkoutAt: Date.parse("2026-10-12T13:29:59+08:00") }); expect(f.adapter.subscribe).not.toHaveBeenCalled(); expect(host.textContent).toBe(""); expect(f.done).toHaveBeenCalledTimes(1);
});
test("13:30 checkout reads the physical tablet store, not employee home store, and focuses the amount", () => {
  const f = fixture(); render(f); expect(f.subscriptions[0]).toMatchObject({ store: "storeB", month: "2026-10" });
  expect(host.querySelector('[role="dialog"]').getAttribute("aria-modal")).toBe("true");
  act(() => f.subscriptions[0].success(null)); expect(document.activeElement.getAttribute("aria-label")).toBe("今日營收"); expect(host.textContent).toContain("下班打卡已成功");
});
test("same-day entries including zero skip the dialog", () => {
  const f = fixture(); render(f); act(() => f.subscriptions[0].success(recorded("0"))); expect(f.done).toHaveBeenCalledWith("already-recorded"); expect(f.adapter.save).not.toHaveBeenCalled();
});
test("a verified current-store entry skips immediately without even flashing a loading dialog", () => {
  const f = fixture(); const state = { status: "ready", data: recorded("0") };
  act(() => root.render(<CheckoutRevenueStage checkout={checkout} adapter={f.adapter} revenueState={state}><p>下班員工餐登記</p></CheckoutRevenueStage>));
  expect(host.textContent).toBe("下班員工餐登記"); expect(f.adapter.subscribe).not.toHaveBeenCalled();
});
test("read failure stays explicit and allows proceeding to meal registration without writing revenue", () => {
  const f = fixture(); render(f); act(() => f.subscriptions[0].failure(new Error("denied")));
  expect(host.textContent).toContain("不會當成尚未填寫"); expect(host.querySelector('fieldset').disabled).toBe(true);
  act(() => Array.from(host.querySelectorAll("button")).find((button) => button.textContent.includes("稍後再填，")).click()); expect(f.done).toHaveBeenCalledWith("later"); expect(f.adapter.save).not.toHaveBeenCalled();
});
test("blank never saves, first verified save completes once and retains checkout date and store", async () => {
  const f = fixture(); render(f); act(() => f.subscriptions[0].success(null)); await submit(); expect(f.adapter.save).not.toHaveBeenCalled(); expect(host.textContent).toContain("請填寫");
  fill("12500"); f.adapter.save.mockResolvedValue({ record: { dateKey: checkout.dateKey, amount: 12500 } }); await submit();
  expect(f.adapter.save.mock.calls[0][1]).toMatchObject({ storeId: "storeB", dateKey: checkout.dateKey, mode: "employee", checkoutAt: checkout.checkoutAt, empId: "A0315" }); expect(f.done).toHaveBeenCalledTimes(1);
});
test("rapid double submit and a concurrent entry never overwrite or increment another employee's revenue", async () => {
  const f = fixture(); render(f); act(() => f.subscriptions[0].success(null)); fill("99999");
  let resolve; f.adapter.save.mockImplementation(() => new Promise((done) => { resolve = done; }));
  act(() => { host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); expect(f.adapter.save).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ record: { dateKey: checkout.dateKey, amount: 12500 }, alreadyRecorded: true })); expect(f.done).toHaveBeenCalledWith("already-recorded");
});
test("uncertain failure keeps input, blocks replay, and rereads before proceeding", async () => {
  const f = fixture(); render(f); act(() => f.subscriptions[0].success(null)); fill("12500"); f.adapter.save.mockRejectedValue(new Error("lost response")); await submit();
  expect(host.querySelector("input").value).toBe("12500"); expect(host.querySelector('fieldset').disabled).toBe(true); expect(f.done).not.toHaveBeenCalled();
  act(() => Array.from(host.querySelectorAll("button")).find((button) => button.textContent.includes("重新讀取確認")).click());
  act(() => f.subscriptions[1].success(recorded())); expect(f.done).toHaveBeenCalledWith("already-recorded"); expect(f.adapter.save).toHaveBeenCalledTimes(1);
});
test("shared checkout stage shows meal immediately before cutoff and after saved revenue without rerunning checkout", async () => {
  const f = fixture();
  act(() => root.render(<CheckoutRevenueStage key="early" checkout={{ ...checkout, checkoutAt: Date.parse("2026-10-12T13:29:00+08:00") }} adapter={f.adapter}><p>下班員工餐登記</p></CheckoutRevenueStage>));
  expect(host.textContent).toBe("下班員工餐登記"); expect(f.adapter.subscribe).not.toHaveBeenCalled();
  await act(async () => root.render(<CheckoutRevenueStage key="late" checkout={checkout} adapter={f.adapter}><p>下班員工餐登記</p></CheckoutRevenueStage>));
  expect(host.textContent).not.toContain("下班員工餐登記"); act(() => f.subscriptions[0].success(null)); fill("12500");
  f.adapter.save.mockResolvedValue({ record: { dateKey: checkout.dateKey, amount: 12500 } }); await submit(); expect(host.textContent).toBe("下班員工餐登記");
});
test("ordinary staff and cross-store managers go straight to meals without a revenue input or subscription", async () => {
  for (const result of [{ allowed: false }, { ...permission, storeId: "storeA" }]) {
    const f = fixture(); f.adapter.checkPermission.mockResolvedValue(result);
    await act(async () => root.render(<CheckoutRevenueStage key={JSON.stringify(result)} checkout={checkout} adapter={f.adapter}><p>下班員工餐登記</p></CheckoutRevenueStage>));
    expect(host.textContent).toBe("下班員工餐登記"); expect(host.querySelector('input')).toBeNull(); expect(f.adapter.subscribe).not.toHaveBeenCalled();
  }
});
test("acting managers can enter; a missing or failed permission cannot open the input and can continue meals", async () => {
  const f = fixture(); f.adapter.checkPermission.mockResolvedValue({ ...permission, managerTitle: "代理店長" });
  await act(async () => root.render(<CheckoutRevenueStage key="acting" checkout={checkout} adapter={f.adapter}><p>下班員工餐登記</p></CheckoutRevenueStage>));
  expect(host.textContent).toContain("代理店長"); expect(host.querySelector('input')).not.toBeNull();
  const failing = fixture(); failing.adapter.checkPermission.mockRejectedValue(new Error("offline"));
  await act(async () => root.render(<CheckoutRevenueStage key="offline" checkout={checkout} adapter={failing.adapter}><p>下班員工餐登記</p></CheckoutRevenueStage>));
  expect(host.textContent).toContain("無法確認"); expect(host.querySelector('input')).toBeNull();
  act(() => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === "繼續登記員工餐").click());
  expect(host.textContent).toBe("下班員工餐登記"); expect(failing.adapter.save).not.toHaveBeenCalled();
});
test("revoked permission while the dialog is open blocks saving but preserves the completed checkout and meal continuation", async () => {
  const f = fixture(); render(f); act(() => f.subscriptions[0].success(null)); fill("12000");
  f.adapter.save.mockRejectedValue(Object.assign(new Error("revoked"), { code: "revenue-permission-denied" })); await submit();
  expect(host.textContent).toContain("權限已變更"); expect(host.querySelector('fieldset').disabled).toBe(true);
  await submit(); expect(f.adapter.save).toHaveBeenCalledTimes(1);
  act(() => Array.from(host.querySelectorAll('button')).find((button) => button.textContent.includes("稍後再填，")).click()); expect(f.done).toHaveBeenCalledWith("later");
});
test("slow permission response cannot reopen a revenue dialog after choosing to continue meals", async () => {
  const f = fixture(); let resolve; f.adapter.checkPermission.mockImplementation(() => new Promise((done) => { resolve = done; }));
  await act(async () => root.render(<CheckoutRevenueStage checkout={checkout} adapter={f.adapter}><p>下班員工餐登記</p></CheckoutRevenueStage>));
  act(() => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === "繼續登記員工餐").click());
  await act(async () => resolve(permission)); expect(host.textContent).toBe("下班員工餐登記"); expect(f.adapter.subscribe).not.toHaveBeenCalled();
});
