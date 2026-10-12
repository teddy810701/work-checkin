import React from "react";
import { MonthlyStoreGoalBoard } from "./MonthlyGoalPanels";
import { MONTHLY_GOAL_STORES, resolveMonthlyGoalStore } from "./monthlyStoreGoals";
import useMonthlyStoreGoals from "./useMonthlyStoreGoals";
import useDailyStoreRevenue from "./useDailyStoreRevenue";

// Read-only viewer. The selection never reaches device bindings or punch actions.
export default function ManagementGoalViewer({ canView, storeId, onStoreChange, month, adapter, revenueAdapter, deviceLabel = "管理員" }) {
  const store = resolveMonthlyGoalStore(storeId);
  const enabled = canView === true && Boolean(store);
  const state = useMonthlyStoreGoals({ enabled, storeValue: store?.id, month, adapter });
  const revenueState = useDailyStoreRevenue({ enabled, storeValue: store?.id, month, adapter: revenueAdapter });
  if (!enabled) return null;
  return <section className="management-goal-viewer" aria-label="管理設備門市查看">
    <div className="management-goal-toolbar">
      <div><strong>門市業績查看</strong><small>{deviceLabel} · 可切換兩店</small></div>
      <div className="management-goal-switch" role="group" aria-label="查看門市">
        {MONTHLY_GOAL_STORES.map((item) => <button key={item.id} type="button" aria-pressed={store.id === item.id}
          onClick={() => onStoreChange(item.id)}>{item.name}</button>)}
      </div>
    </div>
    <p className="management-goal-hint">目前查看：{store.name}。切換只影響業績與注意事項，不會變更設備綁定或打卡門市。</p>
    <MonthlyStoreGoalBoard storeValue={store.id} month={month} state={state} revenueState={revenueState} />
  </section>;
}
