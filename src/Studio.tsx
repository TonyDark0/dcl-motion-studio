import { useEffect, useState } from 'react';
import { App } from './App';
import { StudioTheme } from './ui';
import './style.css';
import './ui-standards.css';
export default function Studio() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    document.title = 'DCL Motion Studio · Local';
    const abort = new AbortController();
    setError('');
    // Create the local browser session before parallel project requests.
    void fetch('/api/session', { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw Error('Could not open your local workspace.');
        setReady(true);
      })
      .catch((error) => { if (!abort.signal.aborted) setError(String(error)); });
    return () => abort.abort();
  }, [retry]);
  if (!ready) return (
    <div className="studio-entry"><div>
      <h1>DCL Motion Studio</h1>
      <p role={error ? 'alert' : 'status'}>{error || 'Opening your local workspace…'}</p>
      {error && <button onClick={() => setRetry((n) => n + 1)}>Try again</button>}
    </div></div>
  );
  return <StudioTheme><App /></StudioTheme>;
}
