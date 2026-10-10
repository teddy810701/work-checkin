import React, { useCallback, useRef } from "react";
import DailyDutyEditor from "./DailyDutyEditor";
import { createManualDailyDutyAssignment, getDailyDutyCandidates } from "./dailyDuty";

const store = "西螺文昌店";
const employees = [
  { empId: "0819", name: "陳嫻亭", store }, { empId: "0826", name: "廖奕婷", store },
  { empId: "0830", name: "孫綵妤", store }, { empId: "1011", name: "陳翔汝", store },
  { empId: "0709", name: "廖梨霜", store }, { empId: "A0315", name: "廖宗富", store },
];
const schedule = Object.fromEntries(employees.map((employee) => [employee.empId, {
  working: true, store, isSupport: employee.empId === "A0315", supportStore: employee.empId === "A0315" ? "斗南站前店" : "",
}]));

// Development only. All changes stay in memory; no login, database write or push.
export default function DailyDutyPreview() {
  const days = useRef({
    "2026-10-09": { members: employees.filter((employee) => ["A0315", "0819"].includes(employee.empId)), updatedAt: 1000 },
    "2026-10-10": { members: employees.filter((employee) => ["0826", "0830"].includes(employee.empId)), updatedAt: 1000 },
  });
  const loadDay = useCallback(async (dateKey) => ({ schedule, assignments: { [store]: days.current[dateKey] || null } }), []);
  const saveAssignment = useCallback(async (input) => {
    const next = createManualDailyDutyAssignment({ ...input, candidates: getDailyDutyCandidates(employees, schedule, input.store), storeId: "storeA", actor: "preview" });
    days.current[input.dateKey] = next;
    return next;
  }, []);
  return <main style={{ maxWidth: 760, margin: "30px auto", padding: "0 16px" }}>
    <h1 style={{ color: "#174d38", fontSize: 26 }}>管理後台 · 值日生預覽</h1>
    <p style={{ color: "#82633a", marginBottom: 20 }}>模擬資料，不會更動正式名單或發送通知。</p>
    <DailyDutyEditor employees={employees} initialDate="2026-10-09" loadDay={loadDay} saveAssignment={saveAssignment} />
  </main>;
}
