import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server.node";
import { readFileSync } from "fs";
import { createRequire } from "module";
import AdminWorkspace, { AdminSection, EmployeeScheduleCard, ADMIN_TABS } from "./AdminWorkspace";
import AdminLayoutPreview from "./AdminLayoutPreview";

let host, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); global.IS_REACT_ACT_ENVIRONMENT = false; });
const click = (element) => act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const sections = (extra) => ADMIN_TABS.map((tab) => <AdminSection key={tab.id} id={tab.id}><input aria-label={`${tab.id}草稿`} defaultValue="" />{extra}</AdminSection>);

test("defaults to daily management with five tabs and hidden inactive panels", () => {
  act(() => root.render(<AdminWorkspace>{sections()}</AdminWorkspace>));
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(5);
  expect(host.querySelector('#admin-tab-daily').getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('#admin-section-daily').hidden).toBe(false);
  expect(host.querySelector('#admin-section-devices').hidden).toBe(true);
});

test("tab changes keep forms and mounted children intact", () => {
  const mount = jest.fn();
  function Marker() { useEffect(() => { mount(); }, []); return null; }
  act(() => root.render(<AdminWorkspace>{sections(<Marker />)}</AdminWorkspace>));
  const draft = host.querySelector('[aria-label="daily草稿"]');
  draft.value = "尚未儲存的班表";
  click(host.querySelector('#admin-tab-communications'));
  expect(host.querySelector('#admin-section-daily').hidden).toBe(true);
  expect(host.querySelector('#admin-section-communications').hidden).toBe(false);
  click(host.querySelector('#admin-tab-daily'));
  expect(host.querySelector('[aria-label="daily草稿"]')).toBe(draft);
  expect(draft.value).toBe("尚未儲存的班表");
  expect(mount).toHaveBeenCalledTimes(5);
});

test("keyboard arrows and Home/End select and focus tabs", () => {
  act(() => root.render(<AdminWorkspace>{sections()}</AdminWorkspace>));
  act(() => host.querySelector('#admin-tab-daily').dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true })));
  expect(document.activeElement.id).toBe('admin-tab-pending');
  act(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'End', bubbles:true })));
  expect(document.activeElement.id).toBe('admin-tab-devices');
  act(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Home', bubbles:true })));
  expect(document.activeElement.id).toBe('admin-tab-daily');
});

test("counts are data-driven and disappear when nothing is pending", () => {
  act(() => root.render(<AdminWorkspace pendingCount={2} anomalyCount={1}>{sections()}</AdminWorkspace>));
  expect(host.querySelector('[aria-label="2 件待審"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="1 件異常"]')).not.toBeNull();
  act(() => root.render(<AdminWorkspace pendingCount={0} anomalyCount={0}>{sections()}</AdminWorkspace>));
  expect(host.querySelectorAll('.admin-count')).toHaveLength(0);
});

test("employees are collapsed natively without dropping their controls", () => {
  const html = renderToStaticMarkup(<EmployeeScheduleCard name="示範員工" description="0001" status="未打卡" scheduleLabel="05:30–14:00"><input aria-label="上班時間" /></EmployeeScheduleCard>);
  host.innerHTML = html;
  const card = host.querySelector('details');
  expect(card.open).toBe(false);
  expect(card.querySelector('summary').textContent).toContain('示範員工');
  expect(card.querySelector('[aria-label="上班時間"]')).not.toBeNull();
});

test("real panels appear exactly once in their intended category", () => {
  const projectRequire = createRequire(require.resolve('react-scripts/package.json'));
  const parser = projectRequire('@babel/parser');
  const traverse = projectRequire('@babel/traverse').default;
  const source = readFileSync(`${__dirname}/App.js`, 'utf8');
  const ast = parser.parse(source, { sourceType:'module', plugins:['jsx'] });
  const found = {};
  traverse(ast, { JSXElement(path) {
    const c = path.node.openingElement.attributes.find((attribute) => attribute.name?.name === 'className');
    if (!c?.value?.value?.startsWith('admin-') || !c.value.value.endsWith('-panel')) return;
    const section = path.findParent((parent) => parent.node.type === 'JSXElement' && parent.node.openingElement.name.name === 'AdminSection');
    if (!section) return;
    const id = section.node.openingElement.attributes.find((attribute) => attribute.name?.name === 'id').value.value;
    if (found[c.value.value]) throw new Error(`Duplicate ${c.value.value}`);
    found[c.value.value] = id;
  } });
  expect(found).toEqual({
    'admin-schedule-panel':'daily', 'admin-employees-panel':'daily', 'admin-duty-panel':'daily',
    'admin-leave-panel':'pending', 'admin-system-anomalies-panel':'pending', 'admin-exceptions-panel':'pending',
    'admin-announcement-panel':'communications', 'admin-remote-voice-panel':'communications',
    'admin-export-panel':'reports', 'admin-history-panel':'reports', 'admin-record-panel':'reports',
    'admin-device-panel':'devices', 'admin-refresh-panel':'devices',
  });
});

test("preview renders with sample data and has no live-service adapter", () => {
  const html = renderToStaticMarkup(<AdminLayoutPreview />);
  expect(html).toContain('模擬資料');
  expect(html).toContain('預覽模式');
  const source = readFileSync(`${__dirname}/AdminLayoutPreview.js`, 'utf8');
  expect(source).not.toMatch(/from\s+["'](?:\.\/firebase|firebase\/)/);
  expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|signInAnonymously|onValue|runTransaction)\s*\(/);
});
