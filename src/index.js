import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
const DutyPreview = process.env.NODE_ENV === 'development'
  && new URLSearchParams(window.location.search).get('demo') === 'daily-duty'
  ? React.lazy(() => import('./DailyDutyPreview')) : null;
const AdminPreview = process.env.NODE_ENV === 'development'
  && new URLSearchParams(window.location.search).get('demo') === 'admin-layout'
  ? React.lazy(() => import('./AdminLayoutPreview')) : null;
const MissedPunchPreview = process.env.NODE_ENV === 'development'
  && new URLSearchParams(window.location.search).get('demo') === 'missed-punch'
  ? React.lazy(() => import('./DirectMissedPunchPreview')) : null;
const GoalsPreview = process.env.NODE_ENV === 'development'
  && new URLSearchParams(window.location.search).get('demo') === 'monthly-goals'
  ? React.lazy(() => import('./MonthlyGoalPreview')) : null;
root.render(
  <React.StrictMode>
    {GoalsPreview ? <React.Suspense fallback={<p>讀取預覽中…</p>}><GoalsPreview /></React.Suspense>
      : MissedPunchPreview ? <React.Suspense fallback={<p>讀取預覽中…</p>}><MissedPunchPreview /></React.Suspense>
      : AdminPreview ? <React.Suspense fallback={<p>讀取預覽中…</p>}><AdminPreview /></React.Suspense>
      : DutyPreview ? <React.Suspense fallback={<p>讀取預覽中…</p>}><DutyPreview /></React.Suspense> : <App />}
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
