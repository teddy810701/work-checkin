import React, { useEffect, useRef, useState } from "react";
import useDailyStoreRevenue from "./useDailyStoreRevenue";
import { isRevenueDate, revenueOperationId, taipeiRevenueTime, validateDailyRevenueAmount } from "./dailyStoreRevenue";
import "./DailyStoreRevenue.css";

function entryDateForMonth(month, today) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "") || month > today.slice(0, 7)) return "";
  if (month === today.slice(0, 7)) return today;
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

export default function DailyRevenueAdmin({ canEdit, enabled, storeId, month, deviceId, adapter, today = taipeiRevenueTime(Date.now()).date }) {
  const state = useDailyStoreRevenue({ enabled: canEdit && enabled, storeValue: storeId, month, adapter });
  const scope = `${storeId}/${month}`;
  const [entry, setEntry] = useState(() => ({ scope, dateKey: entryDateForMonth(month, today), amount: "" }));
  const [edit, setEdit] = useState(null), [error, setError] = useState(""), [message, setMessage] = useState(""), [saving, setSaving] = useState(false), [unknown, setUnknown] = useState(false);
  const lock = useRef(false), active = useRef(true), currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { setEntry({ scope, dateKey: entryDateForMonth(month, today), amount: "" }); setEdit(null); setError(""); setMessage(""); setUnknown(false); }, [scope, month, today]);
  if (!canEdit) return null;
  const draft = entry.scope === scope ? entry : { scope, dateKey: "", amount: "" };
  const existing = state.status === "ready" ? state.data.days[draft.dateKey] : null;
  const lastDate = entryDateForMonth(month, today);
  const save = async (event, input, create = false) => {
    event.preventDefault();
    if (lock.current || unknown || !input || state.status !== "ready") return;
    let operationId, amount;
    try {
      if (!isRevenueDate(input.dateKey, month) || (create && input.dateKey > today)) throw new Error("請選擇目前月份的日期；只能補登今天或之前的營收。");
      if (create && state.data.days[input.dateKey]) throw new Error("這天已登記營收，請使用下方紀錄的「修改」。");
      amount = validateDailyRevenueAmount(input.amount); operationId = revenueOperationId();
    } catch (failure) { setError(failure.message); return; }
    const savedScope = scope;
    lock.current = true; setSaving(true); setError(""); setMessage("");
    try {
      const revision = create ? 0 : input.revision;
      const result = await adapter.save({ amount: input.amount }, { storeId, month, dateKey: input.dateKey, expectedRevision: revision, mode: "admin", canEdit, deviceId, operationId });
      if (result?.record?.dateKey !== input.dateKey || result.record.amount !== amount || result.record.revision !== revision + 1) throw new Error("儲存尚未確認。");
      if (active.current && currentScope.current === savedScope) {
        setEdit(null); if (create) setEntry((current) => ({ ...current, amount: "" }));
        setMessage(`已${create ? "補登" : "修正"} ${input.dateKey} 營收 ${amount.toLocaleString("zh-TW")} 元，門市營收資料已同步更新。`);
        state.retry();
      }
    } catch (_) { if (active.current && currentScope.current === savedScope) { setUnknown(true); setError("儲存尚未確認或資料已更新，請重新讀取後確認結果；不會直接覆蓋其他人的紀錄。"); } }
    finally { lock.current = false; if (active.current) setSaving(false); }
  };
  return <section className="daily-revenue-editor" aria-label="每日營收紀錄"><h3>每日營收紀錄</h3><p className="daily-revenue-info">沒有人填寫時，管理員可直接補登。每店每天一筆，新增與修改都會保留登記人及紀錄。</p>
    <form className="daily-revenue-add" aria-label="補登每日營收" onSubmit={(event) => save(event, draft, true)} noValidate>
      <strong>補登每日營收</strong>
      <fieldset disabled={state.status !== "ready" || saving || unknown}>
        <div className="daily-revenue-add-fields"><label>營收日期<input aria-label="補登營收日期" type="date" min={`${month}-01`} max={lastDate || today} value={draft.dateKey} onChange={(event) => { setEntry({ ...draft, dateKey: event.target.value }); setError(""); setMessage(""); }} /></label><label>當日營收（元）<input aria-label="補登營收金額" type="number" inputMode="numeric" min="0" max="999999999" step="1" placeholder="例如 12500" value={draft.amount} disabled={!!existing} onChange={(event) => { setEntry({ ...draft, amount: event.target.value }); setError(""); setMessage(""); }} /></label></div>
        {existing && <p className="daily-revenue-info" role="status">這天已登記 {existing.amount.toLocaleString("zh-TW")} 元；需要調整請使用下方紀錄的「修改」。</p>}
        <button type="submit" disabled={!!existing}>{saving ? "儲存中…" : existing ? "已登記" : "確認補登營收"}</button>
      </fieldset>
      <small>請填結帳後的實際金額；尚未結帳請稍後再登記。</small>
    </form>
    {state.status === "loading" && <p role="status">讀取每日營收…</p>}
    {(state.status === "error" || error) && <p role="alert" className="daily-revenue-error">{error || state.error}</p>}
    {message && <p role="status" className="daily-revenue-success">{message}</p>}
    {(state.status === "error" || unknown) && <button type="button" disabled={saving} onClick={() => { setEdit(null); setError(""); setUnknown(false); state.retry(); }}>重新讀取每日營收</button>}
    {state.status === "ready" && <div className="daily-revenue-list">{Object.values(state.data.days).sort((a, b) => b.dateKey.localeCompare(a.dateKey)).map((record) => <div key={record.dateKey} className="daily-revenue-row"><div>{record.dateKey}<small>{record.updatedBy.name || record.updatedBy.empId || "管理員"} · 版本 {record.revision}</small></div><strong>{record.amount.toLocaleString("zh-TW")} 元</strong><button type="button" disabled={saving || unknown} onClick={() => { setEdit({ dateKey: record.dateKey, amount: String(record.amount), revision: record.revision }); setError(""); setMessage(""); }}>修改</button>
      {edit?.dateKey === record.dateKey && <form onSubmit={(event) => save(event, edit)} noValidate><fieldset disabled={saving || unknown}><input aria-label={`${record.dateKey} 修正營收`} type="number" inputMode="numeric" min="0" max="999999999" step="1" value={edit.amount} onChange={(event) => setEdit({ ...edit, amount: event.target.value })} /><button type="submit">{saving ? "儲存中…" : "確認修正"}</button><button type="button" onClick={() => setEdit(null)}>取消</button></fieldset></form>}
    </div>)}{!Object.keys(state.data.days).length && <p className="daily-revenue-info">這個月尚無每日營收紀錄。</p>}</div>}
  </section>;
}
