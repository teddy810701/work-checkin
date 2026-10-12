import { DEVICE_BIND_OPTIONS, getManagementGoalDevice, prepareDeviceBinding, readManagementGoalStore, rememberManagementGoalStore } from "./managementGoalDevice";

const devices = { "西螺文昌店": { id: "tablet-A" }, "斗南站前店": { id: "tablet-B" }, "老闆手機": { id: "owner-phone" }, "老闆電腦": { id: "owner-pc" } };
test("existing owner bindings permit the viewer; store tablets and unknown devices do not", () => {
  expect(getManagementGoalDevice(devices, "owner-phone")).toBe("老闆手機");
  expect(getManagementGoalDevice(devices, "owner-pc")).toBe("老闆電腦");
  expect(getManagementGoalDevice({ "老闆娘手機": { id: "wife" } }, "wife")).toBe("老闆娘手機");
  for (const id of ["tablet-A", "tablet-B", "guest", ""]) expect(getManagementGoalDevice(devices, id)).toBe("");
  expect(getManagementGoalDevice({ "unknown": { id: "guest", store: "老闆手機" } }, "guest")).toBe("");
});
test("revoking binding revokes viewer; a store binding takes precedence over an owner slot", () => {
  expect(getManagementGoalDevice({ ...devices, "老闆手機": null }, "owner-phone")).toBe("");
  expect(getManagementGoalDevice({ ...devices, "老闆電腦": { id: "tablet-A" } }, "tablet-A")).toBe("");
});
test("saved selection is validated and never grants a device binding", () => {
  const storage = { getItem: jest.fn(() => "storeB"), setItem: jest.fn() };
  expect(readManagementGoalStore(storage)).toBe("storeB");
  expect(rememberManagementGoalStore(storage, "storeA")).toBe(true);
  expect(storage.setItem).toHaveBeenCalledWith("management_goal_view_store", "storeA");
  expect(rememberManagementGoalStore(storage, "全部")).toBe(false);
  storage.getItem.mockReturnValue("other"); expect(readManagementGoalStore(storage)).toBe("storeA");
  expect(getManagementGoalDevice({}, "owner-pc")).toBe("");
});
test("unavailable browser storage does not break the viewer", () => {
  const storage = { getItem() { throw new Error("private mode"); }, setItem() { throw new Error("full"); } };
  expect(readManagementGoalStore(storage)).toBe("storeA");
  expect(rememberManagementGoalStore(storage, "storeB")).toBe(false);
});
const binding = (extra = {}) => prepareDeviceBinding({ isAdmin: true, authReady: true, deviceId: "new-pc", label: "老闆電腦", devices, now: 1791806400000, ...extra });
test("binding personal computer writes only its own slot and requires confirmation when replacing", () => {
  const plan = binding();
  expect(plan.replacing).toBe(true);
  expect(Object.keys(plan.updates)).toEqual(["devices/老闆電腦", "updatedAt"]);
  expect(plan.updates["devices/老闆電腦"]).toEqual({ id: "new-pc", store: "老闆電腦", boundAt: 1791806400000 });
  expect(devices["西螺文昌店"].id).toBe("tablet-A"); expect(devices["斗南站前店"].id).toBe("tablet-B");
  expect(binding({ deviceId: "owner-pc" }).replacing).toBe(false);
});
test("ordinary and offline users cannot bind; a shop tablet cannot become a cross-store device", () => {
  expect(() => binding({ isAdmin: false })).toThrow("登入管理員");
  expect(() => binding({ authReady: false })).toThrow("登入管理員");
  expect(() => binding({ label: "全部" })).toThrow("不正確");
  expect(() => binding({ deviceId: "tablet-A" })).toThrow("門市平板");
  expect(() => binding({ deviceId: "tablet-B", label: "老闆手機" })).toThrow("門市平板");
  expect(DEVICE_BIND_OPTIONS).toHaveLength(5);
});
