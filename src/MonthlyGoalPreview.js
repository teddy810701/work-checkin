import React, { useState } from "react";
import { styles } from "./App";
import { MonthlyStoreGoalBoard, MonthlyStoreGoalEditor } from "./MonthlyGoalPanels";
import useMonthlyStoreGoals from "./useMonthlyStoreGoals";
import { buildMonthlyGoalUpdate, MONTHLY_GOAL_STORES } from "./monthlyStoreGoals";

const month = "2026-10";
const data = new Map();
const subscriptions = new Map();
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
  { target: index ? "400000" : "500000", total: index ? "246000" : "320000", notesText: "！出餐前確認餐點與訂單一致。\n主動介紹本月主推套餐。\n備料依當日需求，減少報廢。" },
  { storeId: store.id, month, expectedRevision: 0, operationId: `preview-initial-000${index}`, actor: { uid: "preview" }, now: Date.now() })));

// Development-only harness. No Auth calls, Firebase adapter, notifications,
// real punch actions or persisted business records are invoked by this page.
export default function MonthlyGoalPreview() {
  const [store, setStore] = useState(MONTHLY_GOAL_STORES[0]);
  const state = useMonthlyStoreGoals({ enabled: true, storeValue: store.id, month, adapter });
  return <>
    <div style={{ padding: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 12 }}>隔離測試：操作只更動示範資料 {MONTHLY_GOAL_STORES.map((item) => <button key={item.id} type="button" onClick={() => setStore(item)}>{item.name}平板</button>)}</div>
    <div className="checkin-page checkin-monthly-layout" style={styles.tabletPage}>
      <aside className="checkin-sidebar" style={styles.tabletSidebar}><div className="checkin-sidebar-logo" style={styles.sidebarLogoBox}><div style={styles.sidebarLogo}>MWD</div><div style={styles.sidebarBrand}>麥味登<br />打卡系統</div></div>{["查看班表", "請假／調假", "忘打卡申請", "員工餐", "積分系統", "公告"].map((label) => <button className="checkin-sidebar-nav" style={styles.sidebarNav} key={label} disabled>{label}</button>)}<button className="checkin-sidebar-admin" style={styles.sidebarAdminBtn} disabled>管理員</button></aside>
      <main className="checkin-main" style={styles.tabletMain}>
        <section className="checkin-header" style={styles.dashboardHeader}><div className="checkin-greeting"><div style={styles.dashboardHello}>早安，店長 👋</div><div style={styles.dashboardSub}>今天也一起加油！</div></div><div className="checkin-clock" style={styles.clockBox}><div style={styles.clockTime}>06:00:00</div><div style={styles.clockDate}>2026/10/12（一）</div></div><div className="checkin-header-actions" style={styles.headerActions}><button style={styles.refreshMiniBtn} disabled>重新整理</button><button style={styles.headerScheduleBtn} disabled>查看班表</button></div></section>
        <MonthlyStoreGoalBoard storeValue={store.id} month={month} state={state} />
        <section className="checkin-duty" style={styles.dailyDutyPanel}><div className="checkin-duty-header" style={styles.dailyDutyHeader}><div><div style={styles.dailyDutyEyebrow}>TODAY'S DUTY</div><div style={styles.dailyDutyTitle}>🧹 今日值日生</div></div><div style={styles.dailyDutyDate}>2026/10/12（一）</div></div><div className="checkin-duty-grid" style={styles.dailyDutyGrid}><div style={styles.dailyDutyStoreCard}><div style={styles.dailyDutyStoreName}>{store.name}</div><div style={styles.dailyDutyNames}>示範員工 A、示範員工 B</div></div></div></section>
        <section className="checkin-panel" style={styles.checkinPanel}><input style={styles.dashboardInput} placeholder="請輸入工號" disabled /><div className="checkin-action-grid" style={styles.dashboardButtonGrid}>{[["⬆ 上班打卡", "開始今天的工作", styles.dashboardBlueBtn], ["☕ 休息開始", "開始休息時間", styles.dashboardOrangeBtn], ["🍵 休息結束", "結束休息時間", styles.dashboardGreenBtn], ["⬇ 下班打卡", "下班時登記員工餐", styles.dashboardDarkBtn]].map(([label, text, color]) => <button key={label} disabled style={{ ...styles.dashboardActionBtn, ...color }}>{label}<span>{text}</span></button>)}</div></section>
        <section className="checkin-top-grid" style={styles.dashboardTopGrid}><div style={styles.latePanel}>今日遲到看板仍保留在下方</div><div style={styles.statsPanel}>今日出勤狀況仍保留在下方</div></section>
      </main>
    </div>
    <div className="admin-layout-page"><h2>同一套每月目標設定（僅示範）</h2><MonthlyStoreGoalEditor canEdit adapter={adapter} initialMonth={month} /></div>
  </>;
}
