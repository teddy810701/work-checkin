import React, { Children, useRef, useState } from "react";
import "./AdminWorkspace.css";

export const ADMIN_TABS = [
  { id: "daily", label: "日常管理", icon: "▦", title: "排班與員工", description: "先選日期與門市，再調整員工班表、發布班表。" },
  { id: "pending", label: "待辦與異常", icon: "✓", title: "待辦與異常", description: "審核申請與處理異常，集中在這裡。" },
  { id: "communications", label: "公告與播報", icon: "◉", title: "公告與播報", description: "發布每日公告，或讓門市平板播報訊息。" },
  { id: "reports", label: "紀錄與報表", icon: "▤", title: "紀錄與報表", description: "查詢打卡紀錄、歷史班表與匯出月報表。" },
  { id: "devices", label: "設備設定", icon: "⚙", title: "設備設定", description: "管理已授權平板與遠端重新整理。" },
];

export function AdminSection({ children }) { return <>{children}</>; }

export default function AdminWorkspace({ children, pendingCount = 0, anomalyCount = 0 }) {
  const [active, setActive] = useState("daily");
  const tabRefs = useRef([]);
  const panels = Children.toArray(children);
  const current = ADMIN_TABS.find((tab) => tab.id === active);
  const navigate = (event, index) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % ADMIN_TABS.length;
    if (event.key === "ArrowLeft") next = (index + ADMIN_TABS.length - 1) % ADMIN_TABS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = ADMIN_TABS.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    setActive(ADMIN_TABS[next].id);
    tabRefs.current[next]?.focus();
  };
  return <div className="admin-workspace">
    <nav className="admin-workspace-nav" role="tablist" aria-label="後台功能分類">
      {ADMIN_TABS.map((tab, index) => <button
        key={tab.id} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab"
        id={`admin-tab-${tab.id}`} aria-controls={`admin-section-${tab.id}`} aria-selected={active === tab.id}
        tabIndex={active === tab.id ? 0 : -1} onClick={() => setActive(tab.id)} onKeyDown={(event) => navigate(event, index)}
      >
        <span className="admin-tab-icon" aria-hidden="true">{tab.icon}</span><span>{tab.label}</span>
        {tab.id === "pending" && pendingCount > 0 && <span className="admin-count admin-count-pending" aria-label={`${pendingCount} 件待審`}>{pendingCount}</span>}
        {tab.id === "pending" && anomalyCount > 0 && <span className="admin-count admin-count-anomaly" aria-label={`${anomalyCount} 件異常`}>{anomalyCount}</span>}
      </button>)}
    </nav>
    <p className="admin-workspace-nav-hint">左右滑動可查看更多分類</p>
    <div className="admin-workspace-context">
      <div><h2>{current.title}</h2><p>{current.description}</p></div>
      {active === "pending" && <div className="admin-status-legend"><span>待審 {pendingCount}</span><span>異常 {anomalyCount}</span></div>}
    </div>
    {/* Keep inactive panels mounted so drafts, disclosure state and forms survive tab changes. */}
    {panels.map((panel) => <section key={panel.props.id} id={`admin-section-${panel.props.id}`} role="tabpanel"
      aria-labelledby={`admin-tab-${panel.props.id}`} hidden={active !== panel.props.id} tabIndex={0}>
      <div className={`admin-tab-grid admin-${panel.props.id}-grid`}>{panel.props.children}</div>
    </section>)}
  </div>;
}

export function EmployeeScheduleCard({ name, description, status, scheduleLabel, children }) {
  return <details className="admin-employee-disclosure">
    <summary>
      <span className="admin-employee-identity"><strong>{name}</strong><small>{description}</small></span>
      <span className="admin-employee-summary-status"><span>{scheduleLabel}</span><small>{status}</small></span>
      <span className="admin-employee-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="admin-employee-content">{children}</div>
  </details>;
}

export function AdminHelp({ children, label = "操作說明" }) {
  return <details className="admin-help"><summary>{label}</summary><div>{children}</div></details>;
}
