import React, { useState } from "react";
import { styles } from "./App";
import { MonthlyStoreGoalBoard, MonthlyStoreGoalEditor } from "./MonthlyGoalPanels";
import useMonthlyStoreGoals from "./useMonthlyStoreGoals";
import { buildMonthlyGoalUpdate, MONTHLY_GOAL_STORES } from "./monthlyStoreGoals";
import { buildDailyRevenueUpdate } from "./dailyStoreRevenue";
import { resolveMonthlyGoalStore } from "./monthlyStoreGoals";
import useDailyStoreRevenue from "./useDailyStoreRevenue";
import { CheckoutRevenueStage } from "./CheckoutRevenuePrompt";
import ManagementGoalViewer from "./ManagementGoalViewer";

const month = "2026-10";
const data = new Map();
const subscriptions = new Map();
const revenueData = new Map(), revenueSubscriptions = new Map();
const revenueAdapter = {
  async checkPermission(checkout) {
    return checkout.managerTitle ? { allowed: true, empId: checkout.empId, storeId: resolveMonthlyGoalStore(checkout.revenueStore).id, managerTitle: checkout.managerTitle } : { allowed: false };
  },
  subscribe(storeId, monthKey, success) {
    const key = `${storeId}/${monthKey}`, callbacks = revenueSubscriptions.get(key) || new Set();
    callbacks.add(success); revenueSubscriptions.set(key, callbacks); success(revenueData.get(key) || null);
    return () => callbacks.delete(success);
  },
  async save(input, context) {
    const key = `${context.storeId}/${context.month}`;
    const permission = context.mode === "employee" ? await this.checkPermission({ ...context, revenueStore: context.deviceStore, managerTitle: previewPermissionTitles.get(context.empId) }) : null;
    const record = buildDailyRevenueUpdate(revenueData.get(key) || null, input, { ...context, permission, actor: { uid: "isolated-revenue-preview", name: context.name || "管理員" }, now: Date.now() });
    revenueData.set(key, record); revenueSubscriptions.get(key)?.forEach((callback) => callback(record));
    const day = record.days[context.dateKey]; return { record: day, alreadyRecorded: day.lastOperationId !== context.operationId };
  },
};
const previewPermissionTitles = new Map();
const adapter = {
  subscribe(storeId, monthKey, success) {
    const key = `${storeId}/${monthKey}`, callbacks = subscriptions.get(key) || new Set();
    callbacks.add(success); subscriptions.set(key, callbacks); success(data.get(key) || null);
    return () => callbacks.delete(success);
  },
  async save(input, context) {
    const key = `${context.storeId}/${context.month}`;
    const record = buildMonthlyGoalUpdate(data.get(key) || null, input, { ...context, actor: { uid: "isolated-preview" }, now: Date.now() });
    data.set(key, record); subscriptions.get(key)?.forEach((callback) => callback(record)); return record;
  },
};
MONTHLY_GOAL_STORES.forEach((store, index) => data.set(`${store.id}/${month}`, buildMonthlyGoalUpdate(null,
  { target: index ? "400000" : "500000", total: index ? "246000" : "320000", revenueStartDate: "2026-10-12", notesText: "！出餐前確認餐點與訂單一致。\n主動介紹本月主推套餐。\n備料依當日需求，減少報廢。" },
  { storeId: store.id, month, expectedRevision: 0, operationId: `preview-initial-000${index}`, actor: { uid: "preview" }, now: Date.now() })));

// Development-only harness. No Auth calls, Firebase adapter, notifications,
// real punch actions or persisted business records are invoked by this page.
export default function MonthlyGoalPreview() {
  const [store, setStore] = useState(MONTHLY_GOAL_STORES[0]);
  const [managementMode, setManagementMode] = useState(new URLSearchParams(window.location.search).get("mode") === "management");
  const [managementViewStore, setManagementViewStore] = useState("storeA");
  const state = useMonthlyStoreGoals({ enabled: !managementMode, storeValue: store.id, month, adapter });
  const revenueState = useDailyStoreRevenue({ enabled: !managementMode, storeValue: store.id, month, adapter: revenueAdapter });
  const [checkout, setCheckout] = useState(null), [checkoutNumber, setCheckoutNumber] = useState(0);
  const simulateCheckout = (time, managerTitle = "店長") => { const empId = `DEMO-${checkoutNumber + 1}`; previewPermissionTitles.set(empId, managerTitle); setCheckoutNumber((number) => number + 1); setCheckout({ empId, name: managerTitle ? `示範${managerTitle}` : "示範一般員工", managerTitle, dateKey: "2026-10-12", checkoutAt: Date.parse(`2026-10-12T${time}:00+08:00`), revenueStore: store.name, deviceId: "isolated-preview-device", isAuthorizedDevice: true }); };
  return <>
    <div style={{ padding: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 12 }}>隔離測試：操作只更動示範資料 {MONTHLY_GOAL_STORES.map((item) => <button key={item.id} type="button" onClick={() => { setStore(item); setManagementMode(false); }}>{item.name}平板</button>)}<button onClick={() => { setCheckout(null); setManagementMode(true); }}>老闆手機／電腦</button>{!managementMode && <><button onClick={() => simulateCheckout("13:29")}>店長 13:29 下班</button><button onClick={() => simulateCheckout("13:30")}>店長 13:30 下班</button><button onClick={() => simulateCheckout("14:00", "代理店長")}>代理店長 14:00 下班</button><button onClick={() => simulateCheckout("14:00", "")}>一般員工 14:00 下班</button></>}</div>
    {checkout && <CheckoutRevenueStage key={`${checkout.empId}/${checkout.checkoutAt}`} checkout={checkout} adapter={revenueAdapter} revenueState={revenueState}><div style={styles.modalOverlay}><section style={styles.mealModalCard}><h2>下班員工餐登記（示範）</h2><p>營收步驟結束後，原有員工餐登記會繼續；這裡不保存真實餐費。</p><button onClick={() => setCheckout(null)}>沒有吃，完成示範</button></section></div></CheckoutRevenueStage>}
    <div className="checkin-page checkin-monthly-layout" style={styles.tabletPage}>
      <aside className="checkin-sidebar" style={styles.tabletSidebar}><div className="checkin-sidebar-logo" style={styles.sidebarLogoBox}><div style={styles.sidebarLogo}>MWD</div><div style={styles.sidebarBrand}>麥味登<br />打卡系統</div></div>{["查看班表", "請假／調假", "忘打卡申請", "員工餐", "積分系統", "公告"].map((label) => <button className="checkin-sidebar-nav" style={styles.sidebarNav} key={label} disabled>{label}</button>)}<button className="checkin-sidebar-admin" style={styles.sidebarAdminBtn} disabled>管理員</button></aside>
      <main className="checkin-main" style={styles.tabletMain}>
        <section className="checkin-header" style={styles.dashboardHeader}><div className="checkin-greeting"><div style={styles.dashboardHello}>早安，店長 👋</div><div style={styles.dashboardSub}>今天也一起加油！</div></div><div className="checkin-clock" style={styles.clockBox}><div style={styles.clockTime}>06:00:00</div><div style={styles.clockDate}>2026/10/12（一）</div></div><div className="checkin-header-actions" style={styles.headerActions}><button style={styles.refreshMiniBtn} disabled>重新整理</button><button style={styles.headerScheduleBtn} disabled>查看班表</button></div></section>
        {managementMode ? <ManagementGoalViewer canView deviceLabel="老闆電腦（示範已綁定）" storeId={managementViewStore}
          onStoreChange={setManagementViewStore} month={month} adapter={adapter} revenueAdapter={revenueAdapter} />
          : <MonthlyStoreGoalBoard storeValue={store.id} month={month} state={state} revenueState={revenueState} />}
        <section className="checkin-duty" style={styles.dailyDutyPanel}><div className="checkin-duty-header" style={styles.dailyDutyHeader}><div><div style={styles.dailyDutyEyebrow}>TODAY'S DUTY</div><div style={styles.dailyDutyTitle}>🧹 今日值日生</div></div><div style={styles.dailyDutyDate}>2026/10/12（一）</div></div><div className="checkin-duty-grid" style={styles.dailyDutyGrid}><div style={styles.dailyDutyStoreCard}><div style={styles.dailyDutyStoreName}>{store.name}</div><div style={styles.dailyDutyNames}>示範員工 A、示範員工 B</div></div></div></section>
        <section className="checkin-panel" style={styles.checkinPanel}><input style={styles.dashboardInput} placeholder="請輸入工號" disabled /><div className="checkin-action-grid" style={styles.dashboardButtonGrid}>{[["⬆ 上班打卡", "開始今天的工作", styles.dashboardBlueBtn], ["☕ 休息開始", "開始休息時間", styles.dashboardOrangeBtn], ["🍵 休息結束", "結束休息時間", styles.dashboardGreenBtn], ["⬇ 下班打卡", "下班時登記員工餐", styles.dashboardDarkBtn]].map(([label, text, color]) => <button key={label} disabled style={{ ...styles.dashboardActionBtn, ...color }}>{label}<span>{text}</span></button>)}</div></section>
        <section className="checkin-top-grid" style={styles.dashboardTopGrid}><div style={styles.latePanel}>今日遲到看板仍保留在下方</div><div style={styles.statsPanel}>今日出勤狀況仍保留在下方</div></section>
      </main>
    </div>
    <div className="admin-layout-page"><h2>同一套每月目標設定（僅示範）</h2><MonthlyStoreGoalEditor canEdit adapter={adapter} revenueAdapter={revenueAdapter} initialMonth={month} /></div>
  </>;
}
