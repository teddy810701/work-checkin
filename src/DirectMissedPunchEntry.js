import React, { useEffect, useRef, useState } from "react";
import { findMissedPunchEmployee, formatMissedPunchDateTime, MISSED_PUNCH_TYPES, validateDirectMissedPunch } from "./directMissedPunch";
import "./DirectMissedPunchEntry.css";

export default function DirectMissedPunchEntry({ employees, open, onOpenChange, onSubmit,
  canSubmit = true, initialEmpId = "", buttonStyle, getNow = Date.now }) {
  const [empId, setEmpId] = useState("");
  const [missingType, setMissingType] = useState("上班");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const locked = useRef(false);
  const inputRef = useRef(null);
  const buttonRef = useRef(null);
  const employee = findMissedPunchEmployee(employees, empId);
  useEffect(() => {
    if (!open) return;
    setEmpId(initialEmpId); setMissingType("上班"); setDate(formatMissedPunchDateTime(getNow()).slice(0, 10));
    setTime(""); setReason(""); setError(""); setResult(null); setSaving(false); locked.current = false;
    inputRef.current?.focus();
    // Reset only on a new open, not when live employee data refreshes during entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const close = () => {
    if (locked.current) return;
    onOpenChange(false); buttonRef.current?.focus();
  };
  const submit = async (event) => {
    event.preventDefault();
    if (locked.current) return;
    setError("");
    if (!canSubmit) { setError("這台設備尚未授權，請使用店內已授權的平板申請。"); return; }
    const input = { empId, missingType, dateTime: time ? `${date}T${time}` : "", reason };
    try { validateDirectMissedPunch(input, employees, getNow()); }
    catch (failure) { setError(failure.message); return; }
    locked.current = true; setSaving(true);
    try { setResult(await onSubmit(input)); }
    catch (failure) { setError(failure?.message || "送出失敗，請檢查網路後再試。填寫內容已保留。"); }
    finally { locked.current = false; setSaving(false); }
  };
  const keyboard = (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return <>
    <button ref={buttonRef} type="button" className="checkin-sidebar-nav" style={buttonStyle}
      onClick={() => onOpenChange(true)}>🕒 忘打卡申請</button>
    {open && <div className="direct-missed-overlay">
      <section role="dialog" aria-modal="true" aria-labelledby="direct-missed-title" className="direct-missed-dialog" onKeyDown={keyboard}>
        <header><div><p>ATTENDANCE REQUEST</p><h2 id="direct-missed-title">忘打卡申請</h2></div>
          <button type="button" onClick={close} disabled={saving} aria-label="關閉忘打卡申請">✕</button></header>
        {result ? <div className="direct-missed-success" role="status">
          <strong>{result.status === "approved" ? "這筆申請已核准" : result.alreadySent ? "這筆已申請，不會重複送出" : "申請已送出"}</strong>
          <p>申請已送到打卡系統管理員的待審清單。管理員核准後才會補登，不會直接改動你的打卡。</p>
          <button className="direct-missed-primary" type="button" onClick={close}>完成</button>
        </div> : <form onSubmit={submit} noValidate>
          <p className="direct-missed-hint">填寫漏打的類型、實際時間與原因，送管理員審核。</p>
          {!canSubmit && <p className="direct-missed-error" role="alert">這台設備尚未授權，請使用店內已授權的平板申請。</p>}
          <fieldset disabled={saving}>
            <label>工號<input ref={inputRef} aria-label="忘打卡工號" value={empId} autoComplete="off"
              placeholder="請輸入自己的工號" onChange={(event) => setEmpId(event.target.value)} /></label>
            {employee && <p className="direct-missed-employee" role="status">{employee.name} · {employee.store || "未填門市"}</p>}
            {empId.trim() && !employee && <p className="direct-missed-error">找不到這個工號，請確認後再送出。</p>}
            <label>忘打卡類型<select value={missingType} onChange={(event) => setMissingType(event.target.value)}>
              {MISSED_PUNCH_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select></label>
            <div className="direct-missed-datetime">
              <label>實際日期<input type="date" value={date} max={formatMissedPunchDateTime(getNow()).slice(0, 10)} onChange={(event) => setDate(event.target.value)} /></label>
              <label>實際時間<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
            </div>
            <label>忘打卡原因<textarea rows={3} value={reason} maxLength={300}
              placeholder="例如：早上忙著備料，忘記打上班卡" onChange={(event) => setReason(event.target.value)} /></label>
          </fieldset>
          {error && <p className="direct-missed-error" role="alert">{error}</p>}
          <p className="direct-missed-note">這裡只送出申請，不會打現在的卡，也不會更改員工狀態。</p>
          <div className="direct-missed-actions"><button type="button" onClick={close} disabled={saving}>取消</button>
            <button className="direct-missed-primary" type="submit" disabled={saving || !canSubmit}>{saving ? "送出中…" : "送出忘打卡申請"}</button></div>
        </form>}
      </section>
    </div>}
  </>;
}
