import './schema-config';
import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
const Studio = lazy(() => import('./Studio'));
const Documentation = lazy(() => import('./Documentation'));
const isDocs = /^\/docs\/?$/.test(window.location.pathname);
createRoot(document.getElementById('root')!).render(
  isDocs ? (
    <Suspense fallback={<div className="studio-entry">Loading documentation…</div>}>
      <Documentation />
    </Suspense>
  ) : (
    <Suspense
      fallback={
        <div className="studio-entry">
          <p>Loading studio…</p>
        </div>
      }
    >
      <Studio />
    </Suspense>
  ),
);
