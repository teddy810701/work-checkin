import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MonthlyStoreGoalBoard, MonthlyStoreGoalEditor, ToastGoalProgress } from "./MonthlyGoalPanels";
import useMonthlyStoreGoals from "./useMonthlyStoreGoals";
import { buildMonthlyGoalUpdate, readMonthlyGoalRecord } from "./monthlyStoreGoals";
const raw = (storeId = "storeA", total = "320000", month = "2026-10") => buildMonthlyGoalUpdate(null, { target: "500000", total, notesText: "！事項一\n事項二\n事項三\n事項四" }, { storeId, month, expectedRevision: 0, operationId: "test-operation-00001", actor: { uid: "test-admin" }, now: 1791806400000 });
let host, root;
const originalCrypto = globalThis.crypto;
beforeEach(() => { Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => "12345678-1234-4234-8234-123456789abc" } }); global.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto }); global.IS_REACT_ACT_ENVIRONMENT = false; });
const click = (node) => act(() => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const fill = (selector, value) => act(() => { const node = host.querySelector(selector); const prototype = node.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
function fixtureAdapter() {
  const subscriptions = [];
  const adapter = { subscribe: jest.fn((store, month, success, failure) => { const subscription = { store, month, success, failure, close: jest.fn() }; subscriptions.push(subscription); return subscription.close; }), save: jest.fn() };
  return { adapter, subscriptions };
}
function Reader({ adapter, store = "西螺文昌店", month = "2026-10", enabled = true }) {
  const state = useMonthlyStoreGoals({ adapter, storeValue: store, month, enabled });
  return <MonthlyStoreGoalBoard storeValue={store} month={month} state={state} />;
}
test("reads only its bound store; switching scope immediately removes previous sales and ignores late responses", () => {
  const f = fixtureAdapter(); act(() => root.render(<Reader adapter={f.adapter} />));
  expect(f.subscriptions[0].store).toBe("storeA"); act(() => f.subscriptions[0].success(raw())); expect(host.textContent).toContain("320,000");
  act(() => root.render(<Reader adapter={f.adapter} store="斗南站前店" />));
  expect(host.textContent).not.toContain("320,000"); expect(f.subscriptions[0].close).toHaveBeenCalled();
  act(() => f.subscriptions[0].success(raw())); expect(host.textContent).not.toContain("320,000");
  act(() => f.subscriptions[1].success(raw("storeB", "246000"))); expect(host.textContent).toContain("246,000");
});
test("unbound or unauthorized devices do not read either store", () => {
  const f = fixtureAdapter(); act(() => root.render(<Reader adapter={f.adapter} store="老闆電腦" />)); expect(f.adapter.subscribe).not.toHaveBeenCalled();
  act(() => root.render(<Reader adapter={f.adapter} enabled={false} />)); expect(f.adapter.subscribe).not.toHaveBeenCalled();
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
});
test("month rollover clears old values; missing and failed data never display false zeros", () => {
  const f = fixtureAdapter(); act(() => root.render(<Reader adapter={f.adapter} />)); act(() => f.subscriptions[0].success(raw()));
  act(() => root.render(<Reader adapter={f.adapter} month="2026-11" />)); expect(host.textContent).not.toContain("320,000");
  act(() => f.subscriptions[1].failure(new Error("offline"))); expect(host.textContent).toContain("重新讀取"); expect(host.querySelector('[role="progressbar"]')).toBeNull();
  click(host.querySelector(".monthly-goal-error button")); act(() => f.subscriptions[2].success(null)); expect(host.textContent).toContain("本月尚未設定");
});
test("long notes expand and collapse while progress shows the true value", () => {
  const state = { status: "ready", data: readMonthlyGoalRecord(raw("storeA", "560000"), "storeA", "2026-10") };
  act(() => root.render(<MonthlyStoreGoalBoard storeValue="storeA" month="2026-10" state={state} />));
  expect(host.textContent).toContain("112%"); expect(host.querySelector('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("100");
  expect(host.textContent).not.toContain("事項四"); click(host.querySelector(".monthly-goal-expand")); expect(host.textContent).toContain("事項四");
});
test("editor is admin-only, collapsed by default, and reads nothing until opened", () => {
  const f = fixtureAdapter(); act(() => root.render(<MonthlyStoreGoalEditor canEdit={false} adapter={f.adapter} />)); expect(host.textContent).toBe("");
  act(() => root.render(<MonthlyStoreGoalEditor canEdit adapter={f.adapter} />)); expect(host.querySelector("details").open).toBe(false); expect(f.adapter.subscribe).not.toHaveBeenCalled();
});
function openEditor(f) {
  act(() => root.render(<MonthlyStoreGoalEditor canEdit adapter={f.adapter} initialMonth="2026-10" />));
  act(() => { const details = host.querySelector("details"); details.open = true; details.dispatchEvent(new Event("toggle")); });
  act(() => f.subscriptions[0].success(null));
}
test("invalid amounts never save and rapid double tap has one operation", async () => {
  const f = fixtureAdapter(); openEditor(f);
  const send = () => host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  act(send); expect(host.textContent).toContain("營業額目標請填寫"); expect(f.adapter.save).not.toHaveBeenCalled();
  fill('[aria-label="營業額目標"]', "500000"); fill('[aria-label="目前累計營業額"]', "320000");
  let resolve; f.adapter.save.mockImplementation(() => new Promise((done) => { resolve = done; }));
  act(() => { send(); send(); }); expect(f.adapter.save).toHaveBeenCalledTimes(1);
  expect(f.adapter.save.mock.calls[0][1]).toMatchObject({ storeId: "storeA", month: "2026-10", expectedRevision: 0, canEdit: true });
  await act(async () => resolve(readMonthlyGoalRecord(raw(), "storeA", "2026-10"))); expect(host.textContent).toContain("已儲存");
});
test("unknown save outcome retains data, blocks replay and requires read-only confirmation", async () => {
  const f = fixtureAdapter(); openEditor(f); fill('[aria-label="營業額目標"]', "500000"); f.adapter.save.mockRejectedValue(new Error("lost response"));
  await act(async () => host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain("儲存尚未確認"); expect(host.querySelector('[aria-label="營業額目標"]').value).toBe("500000");
  expect(host.querySelector(".monthly-goal-form-fields").disabled).toBe(true); expect(f.adapter.save).toHaveBeenCalledTimes(1);
});
test("new snapshot cannot silently overwrite an administrator's dirty form", () => {
  const f = fixtureAdapter(); openEditor(f); fill('[aria-label="營業額目標"]', "600000"); act(() => f.subscriptions[0].success(raw()));
  expect(host.querySelector('[aria-label="營業額目標"]').value).toBe("600000"); expect(host.textContent).toContain("內容有新的更新");
});
test("choosing another month clears the editor and reads only the chosen month", () => {
  const f = fixtureAdapter(); openEditor(f); act(() => f.subscriptions[0].success(raw()));
  fill('[aria-label="目標月份"]', "2026-11");
  expect(f.subscriptions[1].month).toBe("2026-11"); expect(host.querySelector('[aria-label="營業額目標"]').value).toBe("");
  act(() => f.subscriptions[1].success(null)); expect(host.querySelector('[aria-label="營業額目標"]').value).toBe(""); expect(host.querySelector('[aria-label="目前累計營業額"]').value).toBe("0");
});
test("animation is finite, keeps exact final rate and cancels on scope changes", async () => {
  const saved = HTMLElement.prototype.animate;
  let finish; const cancel = jest.fn(); const animate = jest.fn(() => ({ finished: new Promise((resolve) => { finish = resolve; }), cancel }));
  HTMLElement.prototype.animate = animate;
  try {
    act(() => root.render(<ToastGoalProgress progress={{ position: 64, percent: 64, achieved: false }} scope="storeA/2026-10" />));
    expect(animate.mock.calls[0][0]).toEqual([{ left: "0%" }, { left: "64%" }]); expect(animate.mock.calls[0][1].duration).toBe(1920);
    await act(async () => finish()); expect(host.querySelector(".monthly-goal-traveler").dataset.walking).toBe("false");
    act(() => root.render(<ToastGoalProgress progress={{ position: 80, percent: 80, achieved: false }} scope="storeA/2026-10" />));
    expect(animate.mock.calls[1][0][0].left).toBe("64%");
    act(() => root.render(<ToastGoalProgress progress={{ position: 61.5, percent: 61.5, achieved: false }} scope="storeB/2026-10" />));
    expect(cancel).toHaveBeenCalled(); expect(animate.mock.calls[2][0][0].left).toBe("0%");
  } finally { HTMLElement.prototype.animate = saved; }
});
test("reduced-motion preference keeps the toast still at the exact rate", () => {
  const savedMedia = window.matchMedia, savedAnimate = HTMLElement.prototype.animate;
  const animate = jest.fn(); HTMLElement.prototype.animate = animate;
  window.matchMedia = () => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() });
  try {
    act(() => root.render(<ToastGoalProgress progress={{ position: 64, percent: 64, achieved: false }} scope="storeA/2026-10" />));
    expect(animate).not.toHaveBeenCalled(); expect(host.querySelector(".monthly-goal-traveler").style.left).toBe("64%");
  } finally { window.matchMedia = savedMedia; HTMLElement.prototype.animate = savedAnimate; }
});
