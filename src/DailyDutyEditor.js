import React, { useEffect, useMemo, useState } from "react";
import { getDailyDutyCandidates, getDailyDutyMembers } from "./dailyDuty";
import "./DailyDutyEditor.css";

export const DUTY_STORES = ["西螺文昌店", "斗南站前店"];

// The data adapter is injected so the preview/tests never connect to production.
export default function DailyDutyEditor({ employees, initialDate, loadDay, saveAssignment }) {
  const [dateKey, setDateKey] = useState(initialDate);
  const [store, setStore] = useState(DUTY_STORES[0]);
  const [day, setDay] = useState(null);
  const [ids, setIds] = useState(["", ""]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setDay(null);
    setIds(["", ""]);
    setReason("");
    setError("");
    setMessage("");
    setLoading(true);
    if (!dateKey) { setLoading(false); return undefined; }
    loadDay(dateKey).then((result) => {
      if (!active) return;
      setDay(result);
      const assigned = getDailyDutyMembers(result.assignments?.[store]);
      setIds([assigned[0]?.empId || "", assigned[1]?.empId || ""]);
    }).catch(() => { if (active) setError("讀取值日生失敗，請按重新讀取再試。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dateKey, store, reload, loadDay]);

  const candidates = useMemo(() => getDailyDutyCandidates(employees, day?.schedule, store), [employees, day, store]);
  const assignment = day?.assignments?.[store];
  const members = getDailyDutyMembers(assignment);
  const revisions = Object.values(assignment?.revisions || {}).sort((a, b) => (b.at || 0) - (a.at || 0));
  const disabled = busy || loading || !day;
  const save = async (event) => {
    event.preventDefault();
    if (disabled) return;
    setError("");
    setMessage("");
    if (!reason.trim()) { setError("請填寫更換原因，例如：提前離班，由其他人替補。"); return; }
    const selectedEmpIds = ids.filter(Boolean);
    if (!selectedEmpIds.length || new Set(selectedEmpIds).size !== selectedEmpIds.length) {
      setError("請選擇 1 至 2 位不同的值日生。"); return;
    }
    setBusy(true);
    try {
      const saved = await saveAssignment({ dateKey, store, selectedEmpIds, reason, existing: assignment });
      setDay((current) => ({ ...current, assignments: { ...current.assignments, [store]: saved } }));
      setMessage("已儲存值日生，輪值紀錄已更新；不會重發通知。");
      setReason("");
    } catch (failure) {
      setError(failure?.message || "儲存失敗，請稍後再試。");
    } finally { setBusy(false); }
  };

  return (
    <section className="duty-editor" aria-labelledby="duty-editor-title">
      <div className="duty-editor-heading">
        <div><span className="duty-editor-eyebrow">DAILY DUTY</span><h2 id="duty-editor-title">🧹 值日生管理</h2></div>
        <button type="button" className="duty-editor-secondary" disabled={busy || loading} onClick={() => setReload((value) => value + 1)}>重新讀取</button>
      </div>
      <p>調店後會自動檢查名單；提前離班或臨時替補，可在這裡更換並保留紀錄。</p>
      <form onSubmit={save}>
        <div className="duty-editor-fields">
          <label>值日日期<input aria-label="值日日期" type="date" value={dateKey} disabled={busy} onChange={(event) => setDateKey(event.target.value)} required /></label>
          <label>門市<select aria-label="值日門市" value={store} disabled={busy} onChange={(event) => setStore(event.target.value)}>{DUTY_STORES.map((name) => <option key={name}>{name}</option>)}</select></label>
        </div>
        <div className="duty-editor-current">目前名單：{loading ? "讀取中…" : members.map((member) => member.name || member.empId).join("、") || "尚未安排"}</div>
        <div className="duty-editor-fields">
          {ids.map((id, index) => (
            <label key={index}>值日生 {index + 1}{index === 1 ? "（選填）" : ""}
              <select aria-label={`值日生 ${index + 1}`} value={id} disabled={disabled} onChange={(event) => setIds((current) => current.map((value, slot) => slot === index ? event.target.value : value))}>
                <option value="">{index === 0 ? "請選擇" : "不指定第二位"}</option>
                {id && !candidates.some((person) => person.empId === id) && <option value={id} disabled>{members.find((person) => person.empId === id)?.name || id}（當天未在本店上班，請更換）</option>}
                {candidates.map((person) => <option key={person.empId} value={person.empId}>{person.name}（{person.empId}）</option>)}
              </select>
            </label>
          ))}
        </div>
        {!loading && day && !candidates.length && <p className="duty-editor-warning">這天沒有在本門市上班的人員，請先核對班表。</p>}
        <label>更換原因<input aria-label="更換原因" value={reason} disabled={disabled} maxLength={200} placeholder="例如：嫻亭提前離班，由奕婷、綵妤替補" onChange={(event) => setReason(event.target.value)} /></label>
        {error && <div role="alert" className="duty-editor-warning">{error}</div>}
        {message && <div role="status" className="duty-editor-success">{message}</div>}
        <button className="duty-editor-save" disabled={disabled || !candidates.length}>{busy ? "儲存中…" : "儲存值日生"}</button>
      </form>
      <details className="duty-editor-history">
        <summary>更換紀錄（{revisions.length}）</summary>
        {!revisions.length ? <p>目前沒有更換紀錄。</p> : revisions.map((entry, index) => (
          <div className="duty-editor-revision" key={`${entry.at}-${index}`}>
            <strong>{new Date(entry.at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}</strong>
            <div>{(entry.previousMembers || []).map((person) => person.name || person.empId).join("、") || "尚未安排"} → {(entry.nextMembers || []).map((person) => person.name || person.empId).join("、") || "尚未安排"}</div>
            <p>{entry.reason}</p>
          </div>
        ))}
      </details>
    </section>
  );
}
