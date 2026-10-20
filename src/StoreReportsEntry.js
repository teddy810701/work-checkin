import React, { useMemo, useState } from "react";
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
const employeeStoreId = (employee) => {
  const value = String(employee?.storeId || employee?.store || "");
  if (value === "storeA" || value.includes("西螺") || value.includes("文昌")) return "storeA";
  if (value === "storeB" || value.includes("斗南")) return "storeB";
  return "";
};
const blankDraft = () => ({
  kind: "scrap", occurredDate: taipeiToday(), item: "", quantity: "1", unit: "個",
  reason: "", location: "", detail: "", impact: "",
});

export default function StoreReportsEntry({ employees = [], onClose }) {
  const [employee, setEmployee] = useState(null);
  const [storeId, setStoreId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [draft, setDraft] = useState(blankDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const employeeOptions = useMemo(() => employees
    .filter((item) => !item?.archived && (item?.name || "").trim())
    .map((item) => ({
      empId: String(item.empId || item.id || "").trim().toUpperCase(),
      name: String(item.name || "").trim(),
      storeId: employeeStoreId(item),
    }))
    .filter((item) => item.empId && item.storeId)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")), [employees]);

  const selectEmployee = (id) => {
    setEmployeeId(id);
    setEmployee(employeeOptions.find((item) => item.empId === id) || null);
    setError(""); setMessage("");
  };

  const selectStore = (id) => {
    setStoreId(id);
    setEmployeeId(""); setEmployee(null);
    setError(""); setMessage("");
  };

  const setField = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(""); setMessage("");
  };

  const submit = async (event) => {
    event.preventDefault(); setError(""); setMessage("");
    if (!employee?.empId || !storeId || employee.storeId !== storeId) { setError("請先選擇正確門市與回報對象。"); return; }
    const invalid = !draft.occurredDate || !draft.item.trim()
      || (draft.kind === "scrap" && (!(Number(draft.quantity) > 0) || !draft.reason))
      || (draft.kind === "damage" && (!draft.location.trim() || !draft.detail.trim() || !draft.impact));
    if (invalid) {
      setError(draft.kind === "scrap" ? "請填寫日期、品項、有效數量及報廢原因。" : "請填寫日期、物品、位置、損壞情況及營運影響。");
      return;
    }
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
      setMessage(`已送出「${employee.name}」的回報；資料會同步至員工 App，並由店長或管理員審核。`);
      setDraft(blankDraft());
    } catch (reason) {
      const code = String(reason?.code || "");
      setError(code.includes("permission-denied")
        ? "此員工尚未同步至 App 員工名冊或帳號已停用，請管理員確認。"
        : reason?.message || "送出失敗；請重試，系統會避免同一筆重複新增。");
    } finally { setBusy(false); }
  };

  return <div className="sre-backdrop" role="presentation">
    <section className="sre-dialog" role="dialog" aria-modal="true" aria-labelledby="sre-title">
      <header className="sre-header">
        <div><small>STORE REPORTS</small><h2 id="sre-title">報廢品／物品損壞登記</h2><p>打卡系統內直接登記，案件與員工 App 共用同步。</p></div>
        <button type="button" className="sre-close" onClick={onClose} aria-label="關閉回報登記">×</button>
      </header>
      {error && <div className="sre-alert" role="alert">{error}</div>}
      {message && <div className="sre-success" role="status">{message}</div>}
        <div className="sre-account"><span>無需登入；回報歸屬員工由登打者選擇，系統不驗證實際操作人。</span></div>
        <div className="sre-selector-row">
          <label>回報門市<select value={storeId} onChange={(event) => selectStore(event.target.value)}>
            <option value="">請選擇門市</option><option value="storeA">西螺文昌店</option><option value="storeB">斗南站前店</option>
          </select></label>
          <label>回報對象<select value={employeeId} onChange={(event) => selectEmployee(event.target.value)} disabled={!storeId}>
            <option value="">{storeId ? "請選擇員工" : "請先選擇門市"}</option>
            {employeeOptions.filter((item) => item.storeId === storeId).length === 0 && storeId && <option disabled value="">此門市目前沒有可選員工</option>}
            {employeeOptions.filter((item) => item.storeId === storeId).map((item) => <option key={item.empId} value={item.empId}>{item.name}（{item.empId}）</option>)}
          </select></label>
        </div>
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
            <p className="sre-hint">登記姓名是回報所屬員工，不代表已驗證本人。請核對門市與姓名；送出後資料同步至員工 App，由店長或管理員任一人審核。損壞款核准後追蹤結清，報廢品可月結。</p>
        <button className="sre-primary" disabled={busy || !employee?.empId || !storeId}>{busy ? "送出中…" : "送出回報 →"}</button>
          </form>
    </section>
  </div>;
}
