import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
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
const reportsAuth = getAuth(reportsApp);
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
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(reportsAuth.currentUser);
  const [storeId, setStoreId] = useState("");
  const [stores, setStores] = useState([]);
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState(blankDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadMine = useCallback(async () => {
    const response = await call("getStoreReports", { view: "mine" });
    const allowedStores = Array.isArray(response.data?.stores) ? response.data.stores : [];
    setStores(allowedStores);
    setStoreId(allowedStores.length === 1 ? allowedStores[0] : "");
    setRows(Array.isArray(response.data?.items) ? response.data.items : []);
  }, []);

  useEffect(() => {
    return onAuthStateChanged(reportsAuth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setStores([]); setStoreId(""); setRows([]);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setBusy(true); setError("");
    call("getStoreReports", { view: "mine" })
      .then((response) => {
        if (!active) return;
        const allowedStores = Array.isArray(response.data?.stores) ? response.data.stores : [];
        setStores(allowedStores);
        setStoreId(allowedStores.length === 1 ? allowedStores[0] : "");
        setRows(Array.isArray(response.data?.items) ? response.data.items : []);
      })
      .catch((reason) => { if (active) setError(reason?.message || "無法讀取回報資料，請確認 App 帳號權限。 "); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [user]);

  const isAdminProfile = stores.length > 1;
  const ownLabel = useMemo(() => user?.email?.split("@")[0] || "", [user]);
  const setField = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(""); setMessage("");
  };

  const login = async (event) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const normalizedId = employeeId.trim().toLowerCase();
      if (!normalizedId || !password) throw new Error("請輸入員工編號與 App 密碼。");
      // This is a shared tablet. Keep this secondary App session in memory only;
      // closing the page or signing out will not leave an employee logged in.
      await setPersistence(reportsAuth, inMemoryPersistence);
      await signInWithEmailAndPassword(reportsAuth, `${normalizedId}@employee.mywarmday.app`, password);
      setPassword("");
      await loadMine();
    } catch (reason) {
      const code = String(reason?.code || "");
      setError(code.startsWith("auth/")
        ? "員工編號或 App 密碼錯誤。"
        : code.includes("permission-denied")
        ? "這個 App 帳號尚未開通回報功能，請聯絡管理員。"
        : reason?.message?.includes("請輸入員工編號")
          ? reason.message
          : reason?.message || "登入或資料確認失敗，請檢查網路後再試。");
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
    if (!storeId) { setError("此頁供員工登記使用；請用所屬門市的員工 App 帳號登入。"); return; }
    setBusy(true);
    try {
      await call("createStoreReport", {
        operationId: operationId(), storeId, kind: draft.kind, occurredDate: draft.occurredDate,
        item: draft.item.trim(), detail: draft.detail.trim(),
        ...(draft.kind === "scrap"
          ? { quantity: Number(draft.quantity), unit: draft.unit, reason: draft.reason }
          : { location: draft.location.trim(), impact: draft.impact }),
      });
      setMessage("已送出；這筆資料會同步出現在員工 App，店長與管理員都可查看。");
      setDraft(blankDraft());
      await loadMine();
    } catch (reason) {
      setError(reason?.message || "送出失敗；請重試，系統會避免同一筆重複新增。");
    } finally { setBusy(false); }
  };

  const close = async () => {
    if (reportsAuth.currentUser) await signOut(reportsAuth).catch(() => {});
    onClose?.();
  };

  return <div className="sre-backdrop" role="presentation">
    <section className="sre-dialog" role="dialog" aria-modal="true" aria-labelledby="sre-title">
      <header className="sre-header">
        <div><small>STORE REPORTS</small><h2 id="sre-title">報廢品／物品損壞登記</h2><p>打卡系統內直接登記，案件與員工 App 共用同步。</p></div>
        <button type="button" className="sre-close" onClick={() => void close()} aria-label="關閉回報登記">×</button>
      </header>
      {error && <div className="sre-alert" role="alert">{error}</div>}
      {message && <div className="sre-success" role="status">{message}</div>}
      {!user ? <form className="sre-login" onSubmit={login}>
        <h3>請用員工 App 帳號確認身分</h3>
        <p>打卡平板不會使用匿名身份代填員工資料；登入後才可將回報記到本人名下。</p>
        <label>員工編號<input autoComplete="username" value={employeeId} onChange={(event) => setEmployeeId(event.target.value.toUpperCase())} /></label>
        <label>App 密碼<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="sre-primary" disabled={busy}>{busy ? "確認中…" : "登入並開啟登記"}</button>
      </form> : <>
        <div className="sre-account"><span>已驗證員工帳號 <b>{ownLabel}</b>{storeId && <>・{storeName(storeId)}</>}</span><button type="button" onClick={() => void signOut(reportsAuth)}>登出帳號</button></div>
        {isAdminProfile ? <div className="sre-info">目前登入的是管理員帳號。請先登出，再由實際回報員工使用本人 App 帳號登入，確保紀錄歸屬正確。</div> : <>
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
          <section className="sre-history"><div className="sre-history-title"><h3>我的回報紀錄</h3><button type="button" onClick={() => { setBusy(true); setError(""); loadMine().catch((reason) => setError(reason?.message || "更新失敗")).finally(() => setBusy(false)); }} disabled={busy}>{busy ? "更新中…" : "重新整理"}</button></div>
            {rows.length ? rows.slice(0, 12).map((row) => <article key={row.id}><span>{row.kind === "scrap" ? "報廢品" : "物品損壞"}・{row.occurredDate?.replaceAll("-", "/")}</span><strong>{row.item}</strong><small>{statusName(row.status)}</small></article>) : <p>尚無回報紀錄</p>}
          </section>
        </>}
      </>}
    </section>
  </div>;
}
