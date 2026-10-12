import { onValue, ref, runTransaction, serverTimestamp } from "firebase/database";
import { auth, db } from "./firebase";
import { buildMonthlyGoalUpdate, monthlyGoalPath, readMonthlyGoalRecord } from "./monthlyStoreGoals";

export const monthlyGoalAdapter = {
  subscribe(storeId, month, onData, onError) {
    return onValue(ref(db, monthlyGoalPath(storeId, month)), (snapshot) => onData(snapshot.val()), onError);
  },
  async save(input, context) {
    if (!context.canEdit || !auth.currentUser) throw new Error("請先登入管理後台再修改每月目標。");
    const actor = { uid: auth.currentUser.uid, device: String(context.deviceId || "").slice(0, 100) };
    let failure;
    const result = await runTransaction(ref(db, monthlyGoalPath(context.storeId, context.month)), (current) => {
      try {
        failure = null;
        const next = buildMonthlyGoalUpdate(current, input, { ...context, actor, now: Date.now() });
        if (next === current) return current;
        return { ...next, updatedAt: serverTimestamp(), history: { ...next.history,
          [next.revision]: { ...next.history[next.revision], updatedAt: serverTimestamp() } } };
      } catch (error) { failure = error; return undefined; }
    }, { applyLocally: false });
    if (!result.committed) throw failure || new Error("儲存尚未確認，請重新讀取確認內容。");
    return readMonthlyGoalRecord(result.snapshot.val(), context.storeId, context.month);
  },
};
