import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import DirectMissedPunchEntry from "./DirectMissedPunchEntry";

const now = () => Date.parse("2026-10-12T09:00:00+08:00");
const employees = [{ id: "demo", empId: "0001", name: "示範員工", store: "西螺文昌店" }];
let root, host;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); global.IS_REACT_ACT_ENVIRONMENT = false; });
function Harness({ onSubmit, canSubmit = true }) {
  const [open, setOpen] = useState(false);
  return <DirectMissedPunchEntry employees={employees} open={open} onOpenChange={setOpen} onSubmit={onSubmit} canSubmit={canSubmit} getNow={now} />;
}
const click = (node) => act(() => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const fill = (selector, value) => act(() => {
  const node = host.querySelector(selector);
  const prototype = node.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
});
const submit = async () => { await act(async () => { host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };
const start = (onSubmit, canSubmit = true) => { act(() => root.render(<Harness onSubmit={onSubmit} canSubmit={canSubmit} />)); click(host.querySelector("button")); };
const complete = () => { fill('[aria-label="忘打卡工號"]', "0001"); fill('input[type="time"]', "05:30"); fill("textarea", "忘記打卡"); };

test("sidebar opens an accessible form and focuses the employee ID", () => {
  start(jest.fn());
  expect(host.querySelector('[role="dialog"]').getAttribute("aria-modal")).toBe("true");
  expect(document.activeElement.getAttribute("aria-label")).toBe("忘打卡工號");
  expect(host.querySelectorAll("option")).toHaveLength(4);
  expect(host.textContent).toContain("只送出申請");
});
test("unknown ID, missing fields, and future time fail inline without submitting", async () => {
  const save = jest.fn(); start(save); await submit();
  expect(host.querySelector('[role="alert"]').textContent).toContain("工號");
  complete(); fill('input[type="time"]', "10:00"); await submit();
  expect(host.querySelector('[role="alert"]').textContent).toContain("未來");
  expect(save).not.toHaveBeenCalled();
});
test("valid request sends selected values and shows approval-only success", async () => {
  const save = jest.fn().mockResolvedValue({ status: "pending", alreadySent: false }); start(save); complete();
  const select = host.querySelector("select");
  act(() => { select.value = "下班"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await submit();
  expect(save).toHaveBeenCalledWith({ empId: "0001", missingType: "下班", dateTime: "2026-10-12T05:30", reason: "忘記打卡" });
  expect(host.textContent).toContain("申請已送出"); expect(host.textContent).toContain("核准後才會補登");
});
test("unauthorized device cannot submit but sees an explanation", async () => {
  const save = jest.fn(); start(save, false); complete(); await submit();
  expect(host.textContent).toContain("設備尚未授權"); expect(host.querySelector('[type="submit"]').disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();
});
test("a failed submission retains filled fields and can be retried", async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error("網路失敗")).mockResolvedValueOnce({ status: "pending" });
  start(save); complete(); await submit();
  expect(host.querySelector('[role="alert"]').textContent).toBe("網路失敗");
  expect(host.querySelector("textarea").value).toBe("忘記打卡");
  await submit(); expect(save).toHaveBeenCalledTimes(2); expect(host.textContent).toContain("申請已送出");
});
test("rapid double submission is locked while saving", async () => {
  let resolve; const save = jest.fn(() => new Promise((done) => { resolve = done; }));
  start(save); complete();
  act(() => { host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(save).toHaveBeenCalledTimes(1); expect(host.querySelector("fieldset").disabled).toBe(true);
  await act(async () => resolve({ status: "pending" }));
});
test("Escape closes the form and returns focus to the sidebar entry", () => {
  start(jest.fn());
  act(() => host.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement.textContent).toContain("忘打卡申請");
});
