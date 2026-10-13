// Store-scoped operational goals and their finite progress animation.
import React, { useEffect, useRef, useState } from "react";
import { MONTHLY_GOAL_STORES, monthlyGoalMonth, monthlyGoalProgress, resolveMonthlyGoalStore, validateMonthlyGoalInput } from "./monthlyStoreGoals";
import useMonthlyStoreGoals from "./useMonthlyStoreGoals";
import { combineMonthlyRevenue } from "./dailyStoreRevenue";
import DailyRevenueAdmin from "./DailyRevenueAdmin";
import "./MonthlyStoreGoals.css";

const money = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
const monthLabel = (month) => `${month?.slice(0, 4)} 年 ${Number(month?.slice(5, 7))} 月`;
const updateLabel = (timestamp) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(timestamp));

export function ToastGoalProgress({ progress, scope }) {
  const traveler = useRef(null), previous = useRef(null);
  const [walking, setWalking] = useState(false);
  const [reduced, setReduced] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(preference.matches);
    change();
    if (preference.addEventListener) { preference.addEventListener("change", change); return () => preference.removeEventListener("change", change); }
    preference.addListener?.(change); return () => preference.removeListener?.(change);
  }, []);
  useEffect(() => {
    const marker = traveler.current;
    const start = previous.current?.scope === scope ? previous.current.position : 0;
    previous.current = { scope, position: progress.position };
    setWalking(false);
    if (reduced || start === progress.position || typeof marker?.animate !== "function") return undefined;
    let active = true;
    const animation = marker.animate([{ left: `${start}%` }, { left: `${progress.position}%` }], { duration: 1920, easing: "ease-in-out" });
    setWalking(true);
    animation.finished.then(() => { if (active) setWalking(false); }, () => { if (active) setWalking(false); });
    return () => { active = false; animation.cancel(); };
  }, [scope, progress.position, reduced]);
  return <div className="monthly-goal-journey">
    <div className="monthly-goal-route" aria-hidden="true"><span ref={traveler} className="monthly-goal-traveler" style={{ left: `${progress.position}%` }} data-walking={walking} data-arrived={progress.achieved}>
      <span className="monthly-goal-arm left" /><span className="monthly-goal-arm right" /><span className="monthly-goal-toast"><span className="monthly-goal-cheeks" /></span><span className="monthly-goal-leg left" /><span className="monthly-goal-leg right" />
    </span></div>
    <div className="monthly-goal-track" role="progressbar" aria-label="本月營業額達成率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.position} aria-valuetext={`達成率 ${progress.percent}%`}><div style={{ width: `${progress.position}%` }} /></div>
  </div>;
}

export function MonthlyStoreGoalBoard({ storeValue, month, state: goalState, revenueState }) {
  const store = resolveMonthlyGoalStore(storeValue);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [store?.id, month]);
  let state = goalState, needsOpeningDate = false;
  if (goalState.status === "ready" && goalState.data && revenueState) {
    if (revenueState.status !== "ready") state = { ...revenueState, data: null };
    else try {
      const combined = combineMonthlyRevenue(goalState.data, revenueState.data);
      state = { ...goalState, data: combined.goal }; needsOpeningDate = combined.needsOpeningDate;
    } catch (_) { state = { status: "error", data: null, error: "營收累計暫時無法確認，請管理員查看每日紀錄。", retry: revenueState.retry }; }
  }
  const record = state.status === "ready" && state.data?.storeId === store?.id && state.data?.month === month ? state.data : null;
  const progress = needsOpeningDate ? null : monthlyGoalProgress(record);
  const noteId = `monthly-goal-notes-${store?.id || "unbound"}-${month}`;
  const pendingText = state.status === "loading" ? "正在讀取本月內容…" : state.status === "error" ? "本月資料暫時無法顯示" : state.status === "unbound" ? "請在已綁定門市的平板查看本店目標" : "本月尚未設定，請管理員在後台填寫";
  return <section className="monthly-goal-board" aria-label="本月營運重點">
    <header className="monthly-goal-heading"><h2>本月營運重點 <small>{monthLabel(month)}</small></h2>{store && <span>{store.name} · 本店業績</span>}</header>
    {state.status === "error" && <div className="monthly-goal-error" role="alert">{state.error}<button type="button" onClick={state.retry}>重新讀取</button></div>}
    <div className="monthly-goal-grid">
      <section className="monthly-goal-card" aria-label="營業額目標"><header><h3>營業額目標</h3><span className="monthly-goal-ratio">達成率 <strong>{progress ? `${progress.percent}%` : "—"}</strong></span></header>
        {record ? <><div className="monthly-goal-sales"><div><span>本月目標</span><strong>{money.format(record.target)}<small>元</small></strong></div><div><span>{needsOpeningDate ? "原先累計" : "目前累計"}</span><strong>{money.format(record.total)}<small>元</small></strong></div></div>
          {progress ? <><ToastGoalProgress progress={progress} scope={`${store.id}/${month}`} />
          <div className="monthly-goal-meta"><span>{progress.achieved ? "本月目標已達成！" : `距離目標還差 ${money.format(progress.remaining)} 元`}</span><span>更新：{updateLabel(record.updatedAt)}</span></div></> : <p className="daily-revenue-note">每日營收已留存；請管理員設定每日營收起算日期，再合併累計，避免重複計入原金額。</p>}</>
          : <p className="monthly-goal-empty" role={state.status === "loading" ? "status" : undefined}>{pendingText}</p>}
      </section>
      <section className="monthly-goal-card" aria-label="本月需注意事項"><header><h3>本月需注意事項 <small>{record ? `${record.notes.length} 項` : ""}</small></h3></header>
        {record ? <><ol id={noteId} className="monthly-goal-notes" data-expanded={expanded}>{(expanded ? record.notes : record.notes.slice(0, 3)).map((note, index) => <li key={index}><span>{index + 1}.</span><div>{note.important && <strong>重要</strong>}{note.text}</div></li>)}</ol>
          {record.notes.length ? <button className="monthly-goal-expand" type="button" aria-controls={noteId} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收合事項" : "查看完整內容"}</button> : <p className="monthly-goal-empty">本月沒有設定注意事項</p>}</>
          : <p className="monthly-goal-empty">{pendingText}</p>}
      </section>
    </div>
  </section>;
}

function createOperationId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) throw new Error("無法準備安全的儲存識別，請更新瀏覽器後再試。");
  return Array.from(window.crypto.getRandomValues(new Uint8Array(16))).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function MonthlyStoreGoalEditor({ canEdit, deviceId = "", adapter, revenueAdapter, initialMonth = monthlyGoalMonth() }) {
  const [open, setOpen] = useState(false), [storeId, setStoreId] = useState("storeA"), [month, setMonth] = useState(initialMonth);
  const state = useMonthlyStoreGoals({ enabled: open && canEdit, storeValue: storeId, month, adapter });
  const key = `${storeId}/${month}`;
  const [draft, setDraft] = useState({ key: "", target: "", total: "", notesText: "", revenueStartDate: "", expectedRevision: 0 });
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [unknown, setUnknown] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const lock = useRef(false);
  useEffect(() => { setDirty(false); setUnknown(false); setError(""); setMessage(""); setDraft({ key: "", target: "", total: "", notesText: "", revenueStartDate: "", expectedRevision: 0 }); }, [key]);
  useEffect(() => {
    if (state.status !== "ready" || dirty || saving || unknown) return;
    setDraft({ key, target: state.data ? String(state.data.target) : "", total: state.data ? String(state.data.total) : "0",
      notesText: (state.data?.notes || []).map((note) => `${note.important ? "！" : ""}${note.text}`).join("\n"),
      revenueStartDate: state.data?.revenueStartDate || (state.data?.total ? "" : `${month}-01`), expectedRevision: state.data?.revision || 0 });
  }, [state.status, state.data, key, dirty, saving, unknown]);
  if (!canEdit) return null;
  const ready = state.status === "ready" && draft.key === key;
  const reload = () => { setDirty(false); setUnknown(false); setError(""); setMessage(""); state.retry(); };
  const change = (field, value) => { setDirty(true); setMessage(""); setError(""); setDraft((current) => ({ ...current, [field]: value })); };
  const save = async (event) => {
    event.preventDefault();
    if (lock.current || !ready || unknown) return;
    let operationId;
    try { validateMonthlyGoalInput(draft); operationId = createOperationId(); } catch (failure) { setError(failure.message); return; }
    lock.current = true; setSaving(true); setError(""); setMessage("");
    try {
      const receipt = await adapter.save(draft, { storeId, month, expectedRevision: draft.expectedRevision, operationId, deviceId, canEdit });
      if (!receipt || receipt.storeId !== storeId || receipt.month !== month) throw new Error("儲存結果未確認。");
      setDirty(false); setDraft((current) => ({ ...current, expectedRevision: receipt.revision }));
      setMessage("已儲存，該門市平板會同步更新。");
      state.retry();
    } catch (_) {
      setUnknown(true); setError("儲存尚未確認，或內容已被更新。請重新讀取確認結果後再修改。");
    } finally { lock.current = false; setSaving(false); }
  };
  return <details className="monthly-goal-editor" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><strong>每月營運目標</strong><span>營業額目標・本月注意事項</span></summary>
    <div className="monthly-goal-editor-body">
      <p>已開放營收輸入權限的人員，下午 1:30 後下班時可登記每日營收；當天漏填時，管理員可在下方補登。門市平板只顯示本店。</p>
      <fieldset disabled={saving} className="monthly-goal-selectors"><label>目標門市<select aria-label="目標門市" value={storeId} onChange={(event) => setStoreId(event.target.value)}>{MONTHLY_GOAL_STORES.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>目標月份<input aria-label="目標月份" type="month" value={month} onInput={(event) => setMonth(event.currentTarget.value)} onChange={(event) => setMonth(event.target.value)} /></label></fieldset>
      {state.status === "loading" && <p role="status">讀取中…</p>}
      {state.status === "error" && <p role="alert" className="monthly-goal-error">{state.error}</p>}
      {dirty && ready && (state.data?.revision || 0) !== draft.expectedRevision && <p role="alert" className="monthly-goal-error">內容有新的更新，請重新讀取後再修改。</p>}
      <form onSubmit={save} noValidate>
        <fieldset disabled={!ready || saving || unknown} className="monthly-goal-form-fields"><div className="monthly-goal-selectors"><label>營業額目標（元）<input aria-label="營業額目標" type="number" min="1" max="999999999" step="1" inputMode="numeric" value={draft.key === key ? draft.target : ""} onChange={(event) => change("target", event.target.value)} /></label><label>期初累計營業額（元）<input aria-label="目前累計營業額" type="number" min="0" max="999999999" step="1" inputMode="numeric" value={draft.key === key ? draft.total : ""} onChange={(event) => change("total", event.target.value)} /></label></div>
          <label>每日營收起算日期<input aria-label="每日營收起算日期" type="date" value={draft.key === key ? draft.revenueStartDate : ""} onInput={(event) => change("revenueStartDate", event.currentTarget.value)} onChange={(event) => change("revenueStartDate", event.target.value)} /></label><p className="daily-revenue-info">期初累計填起算日期之前的金額，勿再把下方每日營收加進來。例如期初已含 10/12 營收，就選 10/13 起算；從零開始則選月初、期初填 0。</p>
          <label>本月需注意事項<textarea aria-label="本月需注意事項" rows={4} maxLength={800} value={draft.key === key ? draft.notesText : ""} onChange={(event) => change("notesText", event.target.value)} placeholder="每行一項，開頭加！可標示重要" /></label>
          <button type="submit" className="admin-primary-action">{saving ? "儲存中…" : "儲存本月目標"}</button>
        </fieldset>
      </form>
      {error && <p role="alert" className="monthly-goal-error">{error}</p>}{message && <p role="status" className="monthly-goal-success">{message}</p>}
      <button type="button" onClick={reload} disabled={saving} className="admin-secondary-action">重新讀取</button>
      {revenueAdapter && <DailyRevenueAdmin canEdit={canEdit} enabled={open} storeId={storeId} month={month} deviceId={deviceId} adapter={revenueAdapter} />}
    </div>
  </details>;
}
