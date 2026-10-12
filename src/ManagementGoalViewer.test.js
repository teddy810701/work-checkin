import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import ManagementGoalViewer from "./ManagementGoalViewer";
import { buildMonthlyGoalUpdate } from "./monthlyStoreGoals";
import { getManagementGoalDevice, readManagementGoalStore, rememberManagementGoalStore } from "./managementGoalDevice";

let host, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); global.IS_REACT_ACT_ENVIRONMENT = false; });
const record = (storeId, total) => buildMonthlyGoalUpdate(null, { target: "500000", total, revenueStartDate: "2026-10-01", notesText: storeId === "storeA" ? "文昌限定事項" : "斗南限定事項" }, { storeId, month: "2026-10", expectedRevision: 0, operationId: "owner-view-fixture-01", actor: { uid: "test-only" }, now: 1791806400000 });
function fixture() {
  const subscriptions = [];
  return { subscriptions, subscribe: jest.fn((store, month, success, failure) => {
    const sub = { store, month, success, failure, close: jest.fn() }; subscriptions.push(sub); return sub.close;
  }), save: jest.fn() };
}
function Harness({ adapter, revenueAdapter, deviceId = "owner", devices = { "老闆電腦": { id: "owner" } }, isAdmin = false }) {
  const [storeId, setStoreId] = useState(() => readManagementGoalStore(localStorage));
  const label = getManagementGoalDevice(devices, deviceId);
  return <ManagementGoalViewer canView={Boolean(label) || isAdmin} storeId={storeId} deviceLabel={label || "管理員"} month="2026-10"
    adapter={adapter} revenueAdapter={revenueAdapter} onStoreChange={(id) => { setStoreId(id); rememberManagementGoalStore(localStorage, id); }} />;
}
const render = (goal, revenue, props = {}) => act(() => root.render(<Harness adapter={goal} revenueAdapter={revenue} {...props} />));
const clickStore = (label) => act(() => [...host.querySelectorAll('button')].find((button) => button.textContent === label).dispatchEvent(new MouseEvent("click", { bubbles: true })));
test("owner switches two read-only month scopes, clearing stale store data before new responses", () => {
  const g = fixture(), r = fixture(); render(g, r);
  expect(g.subscriptions[0].store).toBe("storeA"); expect(r.subscriptions[0].store).toBe("storeA");
  act(() => { g.subscriptions[0].success(record("storeA", "320000")); r.subscriptions[0].success(null); });
  expect(host.textContent).toContain("320,000"); expect(host.textContent).toContain("文昌限定事項");
  clickStore("斗南站前店");
  expect(host.textContent).not.toContain("320,000"); expect(host.textContent).not.toContain("文昌限定事項");
  expect(g.subscriptions[0].close).toHaveBeenCalled(); expect(r.subscriptions[0].close).toHaveBeenCalled();
  act(() => { g.subscriptions[0].success(record("storeA", "999000")); r.subscriptions[0].success(null); });
  expect(host.textContent).not.toContain("999,000");
  act(() => { g.subscriptions[1].success(record("storeB", "246000")); r.subscriptions[1].success(null); });
  expect(host.textContent).toContain("246,000"); expect(host.textContent).toContain("斗南限定事項");
  expect(host.querySelector('[aria-pressed="true"]').textContent).toBe("斗南站前店");
  expect(g.save).not.toHaveBeenCalled(); expect(r.save).not.toHaveBeenCalled();
});
test("saved store is retained after reopening but cannot grant unbound or store-tablet access", () => {
  localStorage.setItem("management_goal_view_store", "storeB");
  const g = fixture(), r = fixture();
  render(g, r, { devices: {} }); expect(g.subscribe).not.toHaveBeenCalled(); expect(host.textContent).toBe("");
  render(g, r, { devices: { "西螺文昌店": { id: "owner" } } }); expect(g.subscribe).not.toHaveBeenCalled();
  render(g, r); expect(g.subscriptions[0].store).toBe("storeB");
});
test("unbinding immediately hides both shops and stops both subscriptions, including late callbacks", () => {
  const g = fixture(), r = fixture(); render(g, r);
  act(() => { g.subscriptions[0].success(record("storeA", "320000")); r.subscriptions[0].success(null); });
  render(g, r, { devices: {} }); expect(host.textContent).toBe("");
  expect(g.subscriptions[0].close).toHaveBeenCalled(); expect(r.subscriptions[0].close).toHaveBeenCalled();
  act(() => g.subscriptions[0].success(record("storeA", "320000"))); expect(host.textContent).toBe("");
});
test("logged-in admin can view without device binding, logging out loses that access", () => {
  const g = fixture(), r = fixture(); render(g, r, { devices: {}, isAdmin: true });
  expect(host.textContent).toContain("管理員"); expect(g.subscriptions[0].store).toBe("storeA");
  render(g, r, { devices: {}, isAdmin: false }); expect(host.textContent).toBe(""); expect(g.subscriptions[0].close).toHaveBeenCalled();
});
test("failed revenue does not pretend zero and retry stays in the selected store", () => {
  const g = fixture(), r = fixture(); render(g, r); clickStore("斗南站前店");
  act(() => { g.subscriptions[1].success(record("storeB", "246000")); r.subscriptions[1].failure(new Error("offline")); });
  expect(host.textContent).toContain("每日營收"); expect(host.textContent).not.toContain("246,000");
  act(() => host.querySelector(".monthly-goal-error button").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(r.subscriptions[2].store).toBe("storeB");
  act(() => r.subscriptions[2].success(null)); expect(host.textContent).toContain("246,000");
});
