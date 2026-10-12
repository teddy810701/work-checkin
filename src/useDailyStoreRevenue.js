import { useCallback, useEffect, useState } from "react";
import { resolveMonthlyGoalStore } from "./monthlyStoreGoals";
import { dailyRevenuePath, readDailyRevenueLedger } from "./dailyStoreRevenue";

export default function useDailyStoreRevenue({ enabled, storeValue, month, adapter }) {
  const store = resolveMonthlyGoalStore(storeValue);
  let key = "";
  try { if (store) key = dailyRevenuePath(store.id, month); } catch (_) { /* Invalid scope never issues a read. */ }
  const [snapshot, setSnapshot] = useState({ key: "", status: "loading", data: null, error: "" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!enabled || !key || !adapter) return undefined;
    let active = true;
    setSnapshot({ key, status: "loading", data: null, error: "" });
    const fail = () => { if (active) setSnapshot({ key, status: "error", data: null, error: "暫時讀取不到每日營收；不會當成尚未填寫。" }); };
    let unsubscribe;
    try { unsubscribe = adapter.subscribe(store.id, month, (raw) => {
      if (!active) return;
      try { setSnapshot({ key, status: "ready", data: readDailyRevenueLedger(raw, store.id, month), error: "" }); } catch (_) { fail(); }
    }, fail); } catch (_) { fail(); }
    return () => { active = false; if (typeof unsubscribe === "function") unsubscribe(); };
  }, [adapter, enabled, key, store?.id, month, attempt]);
  if (!enabled || !key || !adapter) return { status: "unbound", data: null, error: "", retry };
  if (snapshot.key !== key) return { status: "loading", data: null, error: "", retry };
  return { ...snapshot, retry };
}
