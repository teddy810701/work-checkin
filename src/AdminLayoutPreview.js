import React, { useCallback, useRef, useState } from "react";
import AdminWorkspace, { AdminSection, EmployeeScheduleCard, AdminHelp } from "./AdminWorkspace";
import DailyDutyEditor from "./DailyDutyEditor";
import { createManualDailyDutyAssignment, getDailyDutyCandidates } from "./dailyDuty";

const stores = ["西螺文昌店", "斗南站前店"];
const employees = [
  ["0205", "林晏資", 0], ["0709", "廖梨霜", 0], ["0819", "陳嫻亭", 0], ["0826", "廖奕婷", 0],
  ["0830", "孫綵妤", 0], ["1011", "陳翔汝", 0], ["1120", "蔡梅楨", 1], ["A0315", "廖宗富", 0],
].map(([empId, name, storeIndex]) => ({ empId, name, store: stores[storeIndex] }));
const taipeiDate = (date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(date);
const today = taipeiDate(new Date());
const tomorrow = taipeiDate(new Date(Date.now() + 86400000));
const initialSchedule = Object.fromEntries(employees.map((employee) => [employee.empId, {
  working: true, startTime: "05:30", endTime: "14:00", isSupport: employee.empId === "A0315", supportStore: employee.empId === "A0315" ? stores[1] : "",
}]));

function Card({ title, className, badge, children }) {
  return <div className={`admin-preview-card ${className || ""}`}>
    <div className="admin-panel-header"><h3 className="admin-panel-title">{title}</h3>{badge && <span className="admin-preview-badge">{badge}</span>}</div>{children}
  </div>;
}

// Isolated UI preview: all interactions only update local component state.
// No Firebase adapter, login, database writes, push, real approvals or exports.
export default function AdminLayoutPreview() {
  const [scheduleDate, setScheduleDate] = useState(tomorrow);
  const [publishStore, setPublishStore] = useState(stores[0]);
  const [employeeStore, setEmployeeStore] = useState("全部");
  const [schedule, setSchedule] = useState(initialSchedule);
  const assignments = useRef({});
  const [announcement, setAnnouncement] = useState("");
  const [voice, setVoice] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(["請假申請", "補打卡申請"]);
  const [anomalies, setAnomalies] = useState(1);
  const notify = (text) => setMessage(`模擬：${text}（未更動正式資料或送出通知）`);
  const updateSchedule = (id, field, value) => setSchedule((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  const loadDay = useCallback(async (dateKey) => ({
    schedule,
    assignments: assignments.current[dateKey] || { [stores[0]]: { members: employees.filter((employee) => ["1011", "0709"].includes(employee.empId)) } },
  }), [schedule]);
  const saveAssignment = useCallback(async (input) => {
    const saved = createManualDailyDutyAssignment({ ...input, actor: "preview", storeId: input.store === stores[0] ? "storeA" : "storeB", candidates: getDailyDutyCandidates(employees, schedule, input.store) });
    assignments.current[input.dateKey] = { ...assignments.current[input.dateKey], [input.store]: saved };
    return saved;
  }, [schedule]);
  return <main className="admin-page admin-layout-page">
    <header className="admin-header">
      <div><div style={{ fontWeight: 800 }}>管理後台</div><div>排班、審核與紀錄，各就各位</div></div>
      <span className="admin-preview-mode">預覽模式</span>
    </header>
    <div className="admin-preview-notice">版面預覽・這裡使用模擬資料，操作不會修改正式班表、送出通知或發布網站。</div>
    {message && <div className="admin-preview-notice" role="status">{message}</div>}
    <AdminWorkspace pendingCount={pending.length} anomalyCount={anomalies}>
      <AdminSection id="daily">
        <Card title="班表發布" className="admin-schedule-panel" badge={publishStore}>
          <label>班表日期<input aria-label="班表日期" type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></label>
          <label>發布門市<select aria-label="發布門市" value={publishStore} onChange={(event) => setPublishStore(event.target.value)}>{stores.map((store) => <option key={store}>{store}</option>)}</select></label>
          <p className="admin-preview-note">點開員工調整上班時間，確認後再發布。</p>
          <button className="admin-primary-action" onClick={() => notify(`${publishStore} ${scheduleDate} 班表已儲存`)}>儲存班表</button>
          <button className="admin-secondary-action" onClick={() => notify("已產生班表分享文字")}>複製班表連結給 LINE 群組</button>
          <AdminHelp>正式系統仍會依原本規則通知有變動的員工；晚上 10:00 提醒尚未按「收到」的人。這次只調整版面。</AdminHelp>
        </Card>
        <Card title="員工名單與排班" className="admin-employees-panel" badge={`${employees.length} 位員工`}>
          <button className="admin-secondary-action admin-small-action" onClick={() => notify("開啟新增員工")}>＋ 新增員工</button>
          <div className="admin-preview-filter" aria-label="員工門市篩選">{["全部", ...stores].map((store) => <button key={store} aria-pressed={employeeStore === store} onClick={() => setEmployeeStore(store)}>{store}</button>)}</div>
          <div className="admin-employee-list">{employees.filter((employee) => employeeStore === "全部" || employee.store === employeeStore).map((employee) => {
            const item = schedule[employee.empId];
            return <EmployeeScheduleCard key={employee.empId} name={employee.name} description={`${employee.empId} ・ ${employee.store}`} status="示範排班"
              scheduleLabel={item.working ? `${item.startTime}–${item.endTime}${item.isSupport ? "・支援" : ""}` : "休假"}>
              <div>
                <label style={{ display: "flex", flexDirection: "row", alignItems: "center" }}><input type="checkbox" aria-label={`${employee.name}排班`} checked={item.working} onChange={(event) => updateSchedule(employee.empId, "working", event.target.checked)} style={{ width: 17, minHeight: 17 }} />當天上班</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label>上班時間<input aria-label={`${employee.name}上班時間`} type="time" value={item.startTime} disabled={!item.working} onChange={(event) => updateSchedule(employee.empId, "startTime", event.target.value)} /></label>
                  <label>下班時間<input aria-label={`${employee.name}下班時間`} type="time" value={item.endTime} disabled={!item.working} onChange={(event) => updateSchedule(employee.empId, "endTime", event.target.value)} /></label>
                </div>
                <button className="admin-secondary-action" onClick={() => notify(`開啟${employee.name}的編輯畫面`)}>編輯員工</button>
              </div>
            </EmployeeScheduleCard>;
          })}</div>
          <p className="admin-preview-note">每位員工預設收合，點名字才展開排班與編輯欄位。</p>
        </Card>
        <div className="admin-duty-panel"><DailyDutyEditor employees={employees} initialDate={today} loadDay={loadDay} saveAssignment={saveAssignment} /></div>
      </AdminSection>
      <AdminSection id="pending">
        <Card title="請假／調假申請" badge={pending.includes("請假申請") ? "1 件待審" : "已處理"}>
          {pending.includes("請假申請") ? <div className="admin-preview-review"><strong>示範員工 A · 請假申請</strong><p>{tomorrow}・個人事務</p><button className="admin-secondary-action" onClick={() => setPending((items) => items.filter((item) => item !== "請假申請"))}>模擬核准申請</button></div> : <p className="admin-preview-note">目前沒有待審的請假申請。</p>}
        </Card>
        <Card title="系統異常中心" badge={`${anomalies} 件異常`}>
          {anomalies ? <div className="admin-preview-review"><strong>示範平板 · 連線狀態待確認</strong><p>異常處理集中顯示，不占用排班頁面。</p><button className="admin-secondary-action" onClick={() => setAnomalies(0)}>模擬確認已處理</button></div> : <p className="admin-preview-note">目前沒有待處理異常。</p>}
        </Card>
        <Card title="異常／忘打卡紀錄" className="admin-exceptions-panel" badge={pending.includes("補打卡申請") ? "1 件待審" : "已處理"}>
          {pending.includes("補打卡申請") ? <div className="admin-preview-review"><strong>示範員工 B · 補上班打卡</strong><p>{today} 05:30・忘記上班打卡</p><button className="admin-secondary-action" onClick={() => setPending((items) => items.filter((item) => item !== "補打卡申請"))}>模擬核准補登</button></div> : <p className="admin-preview-note">目前沒有待審的補打卡申請。</p>}
        </Card>
      </AdminSection>
      <AdminSection id="communications">
        <Card title="每日員工公告" className="admin-announcement-panel">
          <label>公告日期<input aria-label="公告日期" type="date" defaultValue={today} /></label>
          <label>公告內容<textarea aria-label="公告內容" rows={5} value={announcement} onChange={(event) => setAnnouncement(event.target.value)} placeholder="輸入今天要給員工看的公告" /></label>
          <button className="admin-primary-action" onClick={() => notify("每日公告已儲存")}>儲存當日公告</button>
          <AdminHelp>員工下班打卡並完成員工餐登記後，系統會顯示當天公告。公告內容清空後儲存可刪除該日公告。</AdminHelp>
        </Card>
        <Card title="遠端平板語音播報" className="admin-remote-voice-panel">
          <label>播報內容<textarea aria-label="遠端語音內容" rows={5} value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="輸入要讓公司平板說出的內容" /></label>
          <label>播報店別<select aria-label="播報店別"><option>兩間店</option>{stores.map((store) => <option key={store}>{store}</option>)}</select></label>
          <label>播放次數<select aria-label="播放次數"><option>播放 1 次</option><option>播放 2 次</option><option>播放 3 次</option></select></label>
          <button className="admin-primary-action" onClick={() => notify("語音播報預覽")}>立即語音播報</button>
          <AdminHelp>公司平板保持打卡頁開啟且已啟用聲音，才能接收播報。</AdminHelp>
        </Card>
      </AdminSection>
      <AdminSection id="reports">
        <Card title="資料匯出" className="admin-export-panel">
          <label>月報表月份<input aria-label="月報表月份" type="month" defaultValue={today.slice(0, 7)} /></label>
          {["匯出薪資核對版 Excel", "薪資核定版（公式版）", "匯出全部打卡 CSV"].map((label) => <button key={label} className="admin-secondary-action" onClick={() => notify(`${label}：預覽不會下載真實資料`)}>{label}</button>)}
        </Card>
        <Card title="歷史班表" className="admin-history-panel"><AdminHelp label={`${today} · 點開查看`}><p>林晏資｜05:30–14:00</p><p>陳翔汝｜05:30–14:00</p><p>廖宗富｜05:30–14:00・支援斗南</p></AdminHelp></Card>
        <Card title="打卡紀錄" className="admin-record-panel" badge="模擬資料">
          <label>查詢<input aria-label="查詢打卡紀錄" placeholder="搜尋員工姓名或工號" /></label>
          {["林晏資", "廖梨霜", "陳翔汝"].map((name, index) => <div className="admin-preview-review" key={name}><strong>{name}</strong><p>{today} · 上班 · 05:{String(28 + index).padStart(2, "0")}</p></div>)}
          <AdminHelp label="封存與清除"><button className="admin-secondary-action" onClick={() => notify("封存與清除僅為版面示範，未執行刪除")}>封存並清除上個月</button></AdminHelp>
        </Card>
      </AdminSection>
      <AdminSection id="devices">
        <Card title="設備設定" className="admin-device-panel"><p className="admin-preview-note">已授權設備列表</p>{stores.map((store) => <div className="admin-preview-review" key={store}><strong>{store}</strong><p>示範門市平板 · 已授權</p></div>)}<label>綁定門市<select aria-label="綁定門市">{stores.map((store) => <option key={store}>{store}</option>)}</select></label><button className="admin-secondary-action" onClick={() => notify("設備綁定僅為版面示範")}>綁定這台設備</button></Card>
        <Card title="遠端重新整理打卡頁面" className="admin-refresh-panel"><label>重新整理店別<select aria-label="重新整理店別"><option>兩間店</option>{stores.map((store) => <option key={store}>{store}</option>)}</select></label><button className="admin-secondary-action" onClick={() => notify("遠端重新整理僅為版面示範")}>遠端重新整理</button><AdminHelp>只有需要重新載入門市平板時才操作，避免中斷正在輸入的內容。</AdminHelp></Card>
      </AdminSection>
    </AdminWorkspace>
  </main>;
}
