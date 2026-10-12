import React, { useState } from "react";
import DirectMissedPunchEntry from "./DirectMissedPunchEntry";
import { sendDirectMissedPunchRequest } from "./directMissedPunch";

const employees = [{ id: "demo-0001", empId: "0001", name: "示範員工", store: "西螺文昌店" }];
const nav = { border: 0, width: "100%", padding: "14px 12px", borderRadius: 16, background: "rgba(255,255,255,.10)", color: "#fff", fontSize: 15, fontWeight: 900, textAlign: "left", cursor: "pointer" };
export default function DirectMissedPunchPreview() {
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState({});
  const submit = (input) => sendDirectMissedPunchRequest(input, employees, {
    createIfAbsent: async (request) => {
      const created = !requests[request.id];
      if (created) setRequests((current) => ({ ...current, [request.id]: request }));
      return { created, request: requests[request.id] || request };
    },
  }, { device: "demo", deviceLabel: "隔離預覽" });
  return <div className="checkin-page" style={{ display: "grid", gridTemplateColumns: "170px minmax(0,1fr)", minHeight: "100vh", background: "#f1f7f3" }}>
    <aside className="checkin-sidebar" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "20px 14px", background: "linear-gradient(180deg,#064e3b,#047857)", color: "#fff", boxSizing: "border-box" }}>
      <div className="checkin-sidebar-logo" style={{ padding: "6px 4px 20px", fontWeight: 900 }}>MWD · 麥味登<br />打卡系統</div>
      <button className="checkin-sidebar-nav" style={nav}>📅 查看班表</button>
      <button className="checkin-sidebar-nav" style={nav}>📝 請假／調假</button>
      <DirectMissedPunchEntry employees={employees} open={open} onOpenChange={setOpen} onSubmit={submit} buttonStyle={nav} />
      <button className="checkin-sidebar-nav" style={nav}>🍱 員工餐</button>
      <button className="checkin-sidebar-nav" style={nav}>⭐ 積分系統</button>
      <button className="checkin-sidebar-nav" style={nav}>📢 公告</button>
    </aside>
    <main className="checkin-main" style={{ padding: 28, minWidth: 0, color: "#284936" }}>
      <h1 style={{ fontSize: 26 }}>左側新增「忘打卡申請」</h1>
      <p style={{ fontSize: 14, lineHeight: 1.8 }}>隔離預覽，使用示範工號 <strong>0001</strong>；送出只保存在這個畫面的記憶體，不會寫入正式打卡或發送通知。</p>
      <section style={{ marginTop: 28, padding: 24, background: "#fff", borderRadius: 20, border: "1px solid #dae7df", lineHeight: 1.8 }}>
        <strong>流程</strong><p>忘打卡申請 → 輸入工號 → 選擇漏打類型與實際時間 → 說明原因 → 送管理員審核。</p>
        <p>不會替員工打現在的卡，也不會自行更改出勤狀態。</p>
      </section>
      <section style={{ marginTop: 20, padding: 24, background: "#fff", borderRadius: 20, border: "1px solid #dae7df" }}>
        <h2 style={{ fontSize: 18 }}>模擬待審清單 · {Object.keys(requests).length} 筆</h2>
        {Object.values(requests).map((request) => <p key={request.id}>{request.name} · {request.missingType} · {request.requestDateTime.replace("T", " ")} · 待審核</p>)}
      </section>
    </main>
  </div>;
}
