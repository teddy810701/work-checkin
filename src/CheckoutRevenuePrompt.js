import React, { useEffect, useRef, useState } from "react";
import { resolveMonthlyGoalStore } from "./monthlyStoreGoals";
import { hasRevenueManagerPermission, isCheckoutRevenueEligible, revenueOperationId, validateDailyRevenueAmount } from "./dailyStoreRevenue";
import useDailyStoreRevenue from "./useDailyStoreRevenue";
import "./DailyStoreRevenue.css";

export function CheckoutRevenueStage({ checkout, adapter, children, revenueState }) {
  const [pending, setPending] = useState(() => {
    if (!isCheckoutRevenueEligible(checkout)) return false;
    const data = revenueState?.status === "ready" ? revenueState.data : null;
    const sameScope = data?.storeId === resolveMonthlyGoalStore(checkout.revenueStore)?.id && data?.month === checkout.dateKey.slice(0, 7);
    return !(sameScope && data.days[checkout.dateKey]);
  });
  const [permission, setPermission] = useState(null), [permissionError, setPermissionError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timeout = setTimeout(() => { if (active) { active = false; setPermissionError("權限確認逾時，打卡已成功。請繼續登記員工餐，營收稍後再處理。"); } }, 8500);
    Promise.resolve().then(() => adapter.checkPermission(checkout)).then((result) => {
      if (!active) return;
      if (hasRevenueManagerPermission(result, checkout)) setPermission(result);
      else setPending(false);
    }).catch(() => { if (active) setPermissionError("目前無法確認營收填寫權限，打卡已成功。可以繼續登記員工餐。"); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); };
  }, [pending, adapter, checkout, attempt]);
  if (!pending) return children;
  if (permission) return <CheckoutRevenuePrompt checkout={checkout} permission={permission} adapter={adapter} onDone={() => setPending(false)} />;
  return <div className="checkout-revenue-overlay"><section className="checkout-revenue-dialog">
    <span className="checkout-revenue-eyebrow">下班打卡已成功</span>
    <p role={permissionError ? "alert" : "status"}>{permissionError || "確認本店人員營收輸入權限…"}</p>
    {permissionError && <button type="button" onClick={() => { setPermissionError(""); setAttempt((value) => value + 1); }}>重試權限確認</button>}
    <button className="daily-revenue-secondary" type="button" onClick={() => setPending(false)}>繼續登記員工餐</button>
  </section></div>;
}

export default function CheckoutRevenuePrompt({ checkout, permission, adapter, onDone }) {
  const eligible = isCheckoutRevenueEligible(checkout) && hasRevenueManagerPermission(permission, checkout);
  const store = resolveMonthlyGoalStore(checkout.revenueStore), month = checkout.dateKey?.slice(0, 7);
  const state = useDailyStoreRevenue({ enabled: eligible, storeValue: store?.id, month, adapter });
  const [amount, setAmount] = useState(""), [saving, setSaving] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState(""), [revoked, setRevoked] = useState(false);
  const lock = useRef(false), finished = useRef(false), input = useRef(null), active = useRef(true);
  const done = (reason) => { if (!finished.current) { finished.current = true; onDone(reason); } };
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!eligible || (state.status === "ready" && state.data.days[checkout.dateKey] && !saving)) done("already-recorded");
    // Completion is tied to this checkout, not to an unstable parent callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, state.status, state.data, checkout.dateKey, saving]);
  useEffect(() => { if (eligible && state.status === "ready") input.current?.focus(); }, [eligible, state.status]);
  const save = async (event) => {
    event.preventDefault();
    if (lock.current || state.status !== "ready" || unknown || revoked) return;
    let operationId;
    try { validateDailyRevenueAmount(amount); operationId = revenueOperationId(); } catch (failure) { setError(failure.message); return; }
    lock.current = true; setSaving(true); setError("");
    try {
      const result = await adapter.save({ amount }, { storeId: store.id, month, dateKey: checkout.dateKey, mode: "employee", operationId,
        deviceStore: checkout.revenueStore, isAuthorizedDevice: checkout.isAuthorizedDevice, checkoutAt: checkout.checkoutAt,
        deviceId: checkout.deviceId, checkoutRecordId: checkout.checkoutRecordId, empId: checkout.empId, name: checkout.name });
      if (result?.record?.dateKey !== checkout.dateKey) throw new Error("營收儲存結果未確認。");
      if (active.current) done(result.alreadyRecorded ? "already-recorded" : "saved");
    } catch (failure) {
      if (active.current) {
        if (failure.code === "revenue-permission-denied") { setRevoked(true); setError("權限已變更，無法登記營收；下班打卡已成功，請繼續登記員工餐。"); }
        else { setUnknown(true); setError("營收儲存尚未確認。下班打卡已成功；請重新讀取確認，或選稍後再填。"); }
      }
    } finally { lock.current = false; if (active.current) setSaving(false); }
  };
  if (!eligible || finished.current) return null;
  const ready = state.status === "ready" && !state.data.days[checkout.dateKey];
  return <div className="checkout-revenue-overlay"><section role="dialog" aria-modal="true" aria-labelledby="checkout-revenue-title" className="checkout-revenue-dialog" onKeyDown={(event) => { if (event.key === "Escape" && !saving) done("later"); }}>
    <span className="checkout-revenue-eyebrow">下班打卡已成功</span><h2 id="checkout-revenue-title">登記今日營收</h2>
    <p>{store.name} · {checkout.dateKey}<br />{checkout.name}（{permission.managerTitle || "營收輸入授權人員"}），結帳後再填；已授權的人員中只需一人登記。</p>
    {state.status === "loading" && <p role="status">確認今天是否已登記…</p>}
    {state.status === "error" && <p role="alert" className="daily-revenue-error">{state.error}</p>}
    <form onSubmit={save} noValidate><fieldset disabled={!ready || saving || unknown || revoked}><label>今日營收（元）<input ref={input} aria-label="今日營收" type="number" inputMode="numeric" min="0" max="999999999" step="1" placeholder="例如 12500" value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} /></label><button type="submit">{saving ? "儲存中…" : "確認營收，繼續登記員工餐"}</button></fieldset></form>
    {error && <p role="alert" className="daily-revenue-error">{error}</p>}
    {(state.status === "error" || unknown) && <button className="daily-revenue-secondary" type="button" disabled={saving} onClick={() => { setUnknown(false); setError(""); state.retry(); }}>重新讀取確認</button>}
    <button type="button" className="daily-revenue-secondary" disabled={saving} onClick={() => done("later")}>稍後再填，繼續登記員工餐</button>
    <small>尚未結帳請勿填預估金額。未填寫不影響打卡；填錯請管理員修正。</small>
  </section></div>;
}
