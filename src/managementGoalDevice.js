import { MONTHLY_GOAL_STORES } from "./monthlyStoreGoals";

export const MANAGEMENT_DEVICE_LABELS = Object.freeze(["老闆手機", "老闆娘手機", "老闆電腦"]);
export const DEVICE_BIND_OPTIONS = Object.freeze([...MONTHLY_GOAL_STORES.map((store) => store.name), ...MANAGEMENT_DEVICE_LABELS]);
const VIEW_STORE_KEY = "management_goal_view_store";

// Only an existing remote device binding grants the cross-store viewer.
// A remembered selection is a preference, never a permission or a punch store.
export function getManagementGoalDevice(devices, deviceId) {
  if (!deviceId) return "";
  const matches = Object.entries(devices || {}).filter(([, device]) => device?.id === deviceId);
  if (matches.some(([label]) => MONTHLY_GOAL_STORES.some((store) => store.name === label))) return "";
  return matches.find(([label]) => MANAGEMENT_DEVICE_LABELS.includes(label))?.[0] || "";
}

export function readManagementGoalStore(storage) {
  try {
    const stored = storage?.getItem(VIEW_STORE_KEY);
    return MONTHLY_GOAL_STORES.some((store) => store.id === stored) ? stored : "storeA";
  } catch (_) { return "storeA"; }
}

export function rememberManagementGoalStore(storage, storeId) {
  if (!MONTHLY_GOAL_STORES.some((store) => store.id === storeId)) return false;
  try { storage?.setItem(VIEW_STORE_KEY, storeId); return true; } catch (_) { return false; }
}

export function prepareDeviceBinding({ isAdmin, authReady, deviceId, label, devices, now }) {
  if (!isAdmin || !authReady) throw new Error("請先登入管理員並等待系統連線。");
  if (!deviceId || !DEVICE_BIND_OPTIONS.includes(label) || !Number.isFinite(now) || now <= 0) throw new Error("設備或綁定類型不正確，請重新讀取。");
  if (MANAGEMENT_DEVICE_LABELS.includes(label) && MONTHLY_GOAL_STORES.some((store) => devices?.[store.name]?.id === deviceId)) {
    throw new Error("這台設備是門市平板，請保留原門市綁定，改用你的個人手機或電腦綁定管理設備。");
  }
  return {
    replacing: Boolean(devices?.[label]?.id && devices[label].id !== deviceId),
    updates: { [`devices/${label}`]: { id: deviceId, store: label, boundAt: now }, updatedAt: now },
  };
}
