import { useCallback, useEffect, useState } from "react";
import { monthlyGoalPath, readMonthlyGoalRecord, resolveMonthlyGoalStore } from "./monthlyStoreGoals";

export default function useMonthlyStoreGoals({ enabled, storeValue, month, adapter }) {
  const store = resolveMonthlyGoalStore(storeValue);
  let key = "";
  try { if (store) key = monthlyGoalPath(store.id, month); } catch (_) { /* No unsafe path is ever read. */ }
  const [snapshot, setSnapshot] = useState({ key: "", status: "loading", data: null, error: "" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!enabled || !key) return undefined;
    let active = true;
    setSnapshot({ key, status: "loading", data: null, error: "" });
    const fail = () => { if (active) setSnapshot({ key, status: "error", data: null, error: "暫時讀取不到本月目標，請重新讀取。" }); };
    let unsubscribe;
    try {
      unsubscribe = adapter.subscribe(store.id, month, (raw) => {
        if (!active) return;
        try { setSnapshot({ key, status: "ready", data: readMonthlyGoalRecord(raw, store.id, month), error: "" }); }
        catch (_) { fail(); }
      }, fail);
    } catch (_) { fail(); }
    return () => { active = false; if (typeof unsubscribe === "function") unsubscribe(); };
  }, [adapter, enabled, key, store?.id, month, attempt]);
  if (!enabled || !key) return { status: "unbound", data: null, error: "", retry };
  // Scope changes blank the old store synchronously, before the new effect runs.
  if (snapshot.key !== key) return { status: "loading", data: null, error: "", retry };
  return { ...snapshot, retry };
}
