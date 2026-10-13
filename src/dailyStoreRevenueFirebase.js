import { onValue, ref, runTransaction, serverTimestamp } from "firebase/database";
import { auth, db } from "./firebase";
import { buildDailyRevenueUpdate, dailyRevenuePath, hasRevenueManagerPermission, isCheckoutRevenueEligible, readDailyRevenueLedger } from "./dailyStoreRevenue";
import { resolveMonthlyGoalStore } from "./monthlyStoreGoals";

export function createDailyRevenueAdapter({ getPointsToken } = {}) { return {
  async checkPermission(checkout) {
    if (!isCheckoutRevenueEligible(checkout)) return { allowed: false };
    if (!auth.currentUser || !getPointsToken) throw new Error("無法確認營收填寫權限。");
    const controller = new AbortController();
    let timeout;
    const deadline = new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error("權限確認逾時。")); }, 8000); });
    try {
      return await Promise.race([deadline, (async () => {
        const [checkinToken, pointsToken] = await Promise.all([auth.currentUser.getIdToken(), getPointsToken()]);
        const response = await fetch("/api/revenue-permission", { method: "POST", signal: controller.signal,
          headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({
            checkinToken, pointsToken, checkoutRecordId: checkout.checkoutRecordId,
            deviceId: checkout.deviceId, storeId: resolveMonthlyGoalStore(checkout.revenueStore).id, dateKey: checkout.dateKey,
          }) });
        const permission = await response.json();
        if (!response.ok || typeof permission.allowed !== "boolean") throw new Error("無法確認營收填寫權限。");
        return hasRevenueManagerPermission(permission, checkout) ? permission : { allowed: false };
      })()]);
    } finally { clearTimeout(timeout); }
  },
  subscribe(storeId, month, onData, onError) {
    return onValue(ref(db, dailyRevenuePath(storeId, month)), (snapshot) => onData(snapshot.val()), onError);
  },
  async save(input, context) {
    if (!auth.currentUser) throw new Error("系統尚未連線，請重新讀取。");
    // Re-read the canonical App permission on every save, not a cached UI role.
    const permission = context.mode === "employee" ? await this.checkPermission({ ...context, revenueStore: context.deviceStore }) : null;
    if (context.mode === "employee" && !permission?.allowed) throw Object.assign(new Error("權限已變更，只有已開放營收輸入權限的本店人員可以登記營收。"), { code: "revenue-permission-denied" });
    const actor = { uid: auth.currentUser.uid, device: String(context.deviceId || "").slice(0, 100),
      empId: String(context.empId || "").slice(0, 40), name: String(context.name || "管理員").slice(0, 80), source: context.mode,
      ...(permission ? { managerTitle: permission.managerTitle } : {}) };
    let failure;
    const result = await runTransaction(ref(db, dailyRevenuePath(context.storeId, context.month)), (current) => {
      try {
        failure = null;
        const next = buildDailyRevenueUpdate(current, input, { ...context, permission, actor, now: Date.now() });
        if (next === current) return current;
        const day = next.days[context.dateKey];
        return { ...next, days: { ...next.days, [context.dateKey]: { ...day, updatedAt: serverTimestamp(),
          history: { ...day.history, [day.revision]: { ...day.history[day.revision], updatedAt: serverTimestamp() } } } } };
      } catch (error) { failure = error; return undefined; }
    }, { applyLocally: false });
    if (!result.committed) throw failure || new Error("儲存尚未確認，請重新讀取。");
    const ledger = readDailyRevenueLedger(result.snapshot.val(), context.storeId, context.month);
    const record = ledger.days[context.dateKey];
    if (!record) throw new Error("儲存結果未確認。");
    return { record, alreadyRecorded: record.lastOperationId !== context.operationId };
  },
}; }
export const dailyRevenueAdapter = createDailyRevenueAdapter();
