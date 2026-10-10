import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server.node';
import App from './App';
import DailyDutyEditor from './DailyDutyEditor';

// Replace the obsolete CRA template assertion with real, offline startup checks.
// Server rendering does not run effects or sign in to production Firebase.
test('shows connection status before authentication without exposing administrator controls', () => {
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('系統連線中');
  expect(html).not.toContain('儲存值日生');
});

test('duty editor starts in a read-only loading state and does not call the data adapter', () => {
  const loadDay = jest.fn();
  const saveAssignment = jest.fn();
  const html = renderToStaticMarkup(<DailyDutyEditor employees={[]} initialDate="2026-10-09" loadDay={loadDay} saveAssignment={saveAssignment} />);
  expect(html).toContain('值日生管理');
  expect(html).toContain('讀取中');
  expect(html).toContain('disabled=""');
  expect(loadDay).not.toHaveBeenCalled();
  expect(saveAssignment).not.toHaveBeenCalled();
});

test('duty management is collapsed by default with one native expandable heading', () => {
  const html = renderToStaticMarkup(<DailyDutyEditor employees={[]} initialDate="2026-10-09" loadDay={jest.fn()} saveAssignment={jest.fn()} />);
  const container = document.createElement('div');
  container.innerHTML = html;
  const panel = container.querySelector('details.duty-editor');
  expect(panel.open).toBe(false);
  expect(panel.querySelector(':scope > summary').textContent).toContain('值日生管理');
  expect(panel.querySelector(':scope > .duty-editor-body form')).not.toBeNull();
  expect(panel.querySelector('.duty-editor-history')).not.toBeNull();
});
