import React, { useCallback, useState } from "react";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import "./StoreReportsEntry.css";

const APP_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAfBj728Hs928rZByNebgCkcJoU_MNxFIs",
  authDomain: "my-warm-day-pro.firebaseapp.com",
  projectId: "my-warm-day-pro",
  storageBucket: "my-warm-day-pro.appspot.com",
  messagingSenderId: "409964225413",
  appId: "1:409964225413:web:82fad775514edb08735aec",
};
const REPORTS_APP_NAME = "workCheckinStoreReports";
const reportsApp = getApps().some((app) => app.name === REPORTS_APP_NAME)
  ? getApp(REPORTS_APP_NAME)
  : initializeApp(APP_FIREBASE_CONFIG, REPORTS_APP_NAME);
const reportsFunctions = getFunctions(reportsApp, "asia-east1");
const call = (name, options) => httpsCallable(reportsFunctions, name)(options);

const taipeiToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const operationId = () => typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID().replaceAll("-", "")
  : `${Date.now()}${Math.random().toString(36).slice(2)}`;
const storeName = (storeId) => storeId === "storeA" ? "西螺文昌店" : storeId === "storeB" ? "斗南站前店" : storeId;
const statusName = (status) => ({
  pending_manager: "待審核", approved_admin: "已核准", returned: "退回補充",
  rejected: "直接退回", settled: "已月結", paid: "已結清", deleted: "已刪除",
}[status] || "處理中");
const blankDraft = () => ({
  kind: "scrap", occurredDate: taipeiToday(), item: "", quantity: "1", unit: "個",
  reason: "", location: "", detail: "", impact: "",
});

export default function StoreReportsEntry({ initialEmpId = "", onClose }) {
  const [employeeId, setEmployeeId] = useState(String(initialEmpId || "").trim().toUpperCase());
  const [employee, setEmployee] = useState(null);
  const [storeId, setStoreId] = useState("");
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState(blankDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadMine = useCallback(async (id) => {
    const response = await call("getStoreReportsByEmployeeId", { employeeId: id });
    const data = response.data || {};
    if (!data.employee?.storeId) throw new Error("工號未對應到有效的門市員工，請確認後再試。");
    setEmployee(data.employee);
    setStoreId(data.employee.storeId);
    setRows(Array.isArray(data.items) ? data.items : []);
    return data.employee;
  }, []);

  const setField = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(""); setMessage("");
  };

  const verifyEmployee = async (event) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const normalizedId = employeeId.trim().toUpperCase();
      if (!normalizedId) throw new Error("請輸入員工工號。");
      await loadMine(normalizedId);
      setMessage("工號已確認；回報會記錄在此員工名下。");
    } catch (reason) {
      const code = String(reason?.code || "");
      setError(code.includes("permission-denied")
        ? "工號錯誤、帳號未啟用或無法唯一對應，請聯絡管理員。"
        : reason?.message || "工號確認失敗，請檢查網路後再試。");
    } finally { setBusy(false); }
  };

  const submit = async (event) => {
    event.preventDefault(); setError(""); setMessage("");
    const invalid = !draft.occurredDate || !draft.item.trim()
      || (draft.kind === "scrap" && (!(Number(draft.quantity) > 0) || !draft.reason))
      || (draft.kind === "damage" && (!draft.location.trim() || !draft.detail.trim() || !draft.impact));
    if (invalid) {
      setError(draft.kind === "scrap" ? "請填寫日期、品項、有效數量及報廢原因。" : "請填寫日期、物品、位置、損壞情況及營運影響。");
      return;
    }
    if (!employee?.empId || !storeId) { setError("請先輸入有效員工工號。"); return; }
    setBusy(true);
    try {
      await call("createStoreReportByEmployeeId", {
        employeeId: employee.empId,
        operationId: operationId(), storeId, kind: draft.kind, occurredDate: draft.occurredDate,
        item: draft.item.trim(), detail: draft.detail.trim(),
        ...(draft.kind === "scrap"
          ? { quantity: Number(draft.quantity), unit: draft.unit, reason: draft.reason }
          : { location: draft.location.trim(), impact: draft.impact }),
      });
      setMessage("已送出；這筆資料會同步出現在員工 App，店長與管理員都可查看。");
      setDraft(blankDraft());
      await loadMine(employee.empId);
    } catch (reason) {
      setError(reason?.message || "送出失敗；請重試，系統會避免同一筆重複新增。");
    } finally { setBusy(false); }
  };

  const resetEmployee = () => {
    setEmployee(null); setStoreId(""); setRows([]); setMessage(""); setError("");
    setEmployeeId(String(initialEmpId || "").trim().toUpperCase());
  };

  return <div className="sre-backdrop" role="presentation">
    <section className="sre-dialog" role="dialog" aria-modal="true" aria-labelledby="sre-title">
      <header className="sre-header">
        <div><small>STORE REPORTS</small><h2 id="sre-title">報廢品／物品損壞登記</h2><p>打卡系統內直接登記，案件與員工 App 共用同步。</p></div>
        <button type="button" className="sre-close" onClick={onClose} aria-label="關閉回報登記">×</button>
      </header>
      {error && <div className="sre-alert" role="alert">{error}</div>}
      {message && <div className="sre-success" role="status">{message}</div>}
      {!employee ? <form className="sre-login" onSubmit={verifyEmployee}>
        <h3>輸入員工工號</h3>
        <p>不需要 App 密碼。請確認工號正確；共用平板上輸入的工號會作為回報者。</p>
        <label>員工工號<input autoComplete="off" value={employeeId} onChange={(event) => setEmployeeId(event.target.value.toUpperCase())} /></label>
        <button className="sre-primary" disabled={busy}>{busy ? "確認中…" : "確認工號並開啟登記"}</button>
      </form> : <>
        <div className="sre-account"><span>回報者 <b>{employee.name}（{employee.empId}）</b>{storeId && <>・{storeName(storeId)}</>}</span><button type="button" onClick={resetEmployee}>更換工號</button></div>
        <>
          <div className="sre-kind-switch" role="group" aria-label="回報類型">
            <button type="button" aria-pressed={draft.kind === "scrap"} onClick={() => setField("kind", "scrap")}>報廢品申請</button>
            <button type="button" aria-pressed={draft.kind === "damage"} onClick={() => setField("kind", "damage")}>物品損壞回報</button>
          </div>
          <form className="sre-form" onSubmit={submit}>
            <label>發生日期<input type="date" max={taipeiToday()} value={draft.occurredDate} onChange={(event) => setField("occurredDate", event.target.value)} required /></label>
            <label>{draft.kind === "scrap" ? "報廢品項" : "損壞物品"}<input maxLength={80} value={draft.item} onChange={(event) => setField("item", event.target.value)} placeholder={draft.kind === "scrap" ? "例如：鮮奶、吐司" : "例如：封口機、冷藏櫃"} required /></label>
            {draft.kind === "scrap" ? <>
              <div className="sre-row"><label>數量<input type="number" min="0.01" max="100000" step="0.01" value={draft.quantity} onChange={(event) => setField("quantity", event.target.value)} required /></label><label>單位<select value={draft.unit} onChange={(event) => setField("unit", event.target.value)}>{["個", "份", "包", "瓶", "盒", "公斤", "公克"].map((unit) => <option key={unit}>{unit}</option>)}</select></label></div>
              <label>報廢原因<select value={draft.reason} onChange={(event) => setField("reason", event.target.value)} required><option value="">請選擇原因</option>{["過期", "製作失敗", "品質異常", "掉落／污染", "其他"].map((reason) => <option key={reason}>{reason}</option>)}</select></label>
              <label>補充說明（選填）<textarea rows={3} maxLength={300} value={draft.detail} onChange={(event) => setField("detail", event.target.value)} /></label>
            </> : <>
              <label>損壞位置<input maxLength={80} value={draft.location} onChange={(event) => setField("location", event.target.value)} placeholder="例如：備餐區" required /></label>
              <label>損壞情況<textarea rows={3} maxLength={500} value={draft.detail} onChange={(event) => setField("detail", event.target.value)} required /></label>
              <label>營運影響<select value={draft.impact} onChange={(event) => setField("impact", event.target.value)} required><option value="">請選擇影響程度</option>{["不影響營運", "需要安排檢修", "影響營運，請盡快處理"].map((impact) => <option key={impact}>{impact}</option>)}</select></label>
            </>}
            <p className="sre-hint">送出後資料會同步至員工 App；店長或管理員任一人審核即可。損壞款核准後追蹤結清，報廢品可月結。</p>
            <button className="sre-primary" disabled={busy}>{busy ? "送出中…" : "送出回報 →"}</button>
          </form>
          <section className="sre-history"><div className="sre-history-title"><h3>我的回報紀錄</h3><button type="button" onClick={() => { setBusy(true); setError(""); loadMine(employee.empId).catch((reason) => setError(reason?.message || "更新失敗")).finally(() => setBusy(false)); }} disabled={busy}>{busy ? "更新中…" : "重新整理"}</button></div>
            {rows.length ? rows.slice(0, 12).map((row) => <article key={row.id}><span>{row.kind === "scrap" ? "報廢品" : "物品損壞"}・{row.occurredDate?.replaceAll("-", "/")}</span><strong>{row.item}</strong><small>{statusName(row.status)}</small></article>) : <p>尚無回報紀錄</p>}
          </section>
        </>
      </>}
    </section>
  </div>;
}
