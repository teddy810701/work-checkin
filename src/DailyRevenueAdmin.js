import React, { useEffect, useRef, useState } from "react";
import useDailyStoreRevenue from "./useDailyStoreRevenue";
import { revenueOperationId, validateDailyRevenueAmount } from "./dailyStoreRevenue";
import "./DailyStoreRevenue.css";

export default function DailyRevenueAdmin({ canEdit, enabled, storeId, month, deviceId, adapter }) {
  const state = useDailyStoreRevenue({ enabled: canEdit && enabled, storeValue: storeId, month, adapter });
  const [edit, setEdit] = useState(null), [error, setError] = useState(""), [saving, setSaving] = useState(false), [unknown, setUnknown] = useState(false);
  const lock = useRef(false);
  useEffect(() => { setEdit(null); setError(""); setUnknown(false); }, [storeId, month]);
  if (!canEdit) return null;
  const save = async (event) => {
    event.preventDefault();
    if (lock.current || unknown || !edit || state.status !== "ready") return;
    let operationId;
    try { validateDailyRevenueAmount(edit.amount); operationId = revenueOperationId(); } catch (failure) { setError(failure.message); return; }
    lock.current = true; setSaving(true); setError("");
    try {
      const result = await adapter.save({ amount: edit.amount }, { storeId, month, dateKey: edit.dateKey, expectedRevision: edit.revision, mode: "admin", canEdit, deviceId, operationId });
      if (result?.record?.dateKey !== edit.dateKey) throw new Error("儲存尚未確認。");
      setEdit(null); state.retry();
    } catch (_) { setUnknown(true); setError("修改尚未確認或資料已更新，請重新讀取後確認；不會直接覆蓋其他人的修改。"); }
    finally { lock.current = false; setSaving(false); }
  };
  return <section className="daily-revenue-editor" aria-label="每日營收紀錄"><h3>每日營收紀錄</h3><p className="daily-revenue-info">同店同日一筆。員工填錯時可在這裡修正，原值與修改人仍保留紀錄。</p>
    {state.status === "loading" && <p role="status">讀取每日營收…</p>}
    {(state.status === "error" || error) && <p role="alert" className="daily-revenue-error">{error || state.error}</p>}
    {(state.status === "error" || unknown) && <button type="button" disabled={saving} onClick={() => { setEdit(null); setError(""); setUnknown(false); state.retry(); }}>重新讀取每日營收</button>}
    {state.status === "ready" && <div className="daily-revenue-list">{Object.values(state.data.days).sort((a, b) => b.dateKey.localeCompare(a.dateKey)).map((record) => <div key={record.dateKey} className="daily-revenue-row"><div>{record.dateKey}<small>{record.updatedBy.name || record.updatedBy.empId || "管理員"} · 版本 {record.revision}</small></div><strong>{record.amount.toLocaleString("zh-TW")} 元</strong><button type="button" disabled={saving} onClick={() => { setEdit({ dateKey: record.dateKey, amount: String(record.amount), revision: record.revision }); setError(""); setUnknown(false); }}>修改</button>
      {edit?.dateKey === record.dateKey && <form onSubmit={save} noValidate><fieldset disabled={saving || unknown}><input aria-label={`${record.dateKey} 修正營收`} type="number" inputMode="numeric" min="0" max="999999999" step="1" value={edit.amount} onChange={(event) => setEdit({ ...edit, amount: event.target.value })} /><button type="submit">{saving ? "儲存中…" : "確認修正"}</button><button type="button" onClick={() => setEdit(null)}>取消</button></fieldset></form>}
    </div>)}{!Object.keys(state.data.days).length && <p className="daily-revenue-info">這個月尚無每日營收紀錄。</p>}</div>}
  </section>;
}
