function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 500);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Only repeat a lost capture request after the original worker has finished.
 * Generation submission is deliberately excluded: it creates a durable job.
 */
export async function visionRequest<T>(
  endpoint: 'frame' | 'calibrate' | 'pro-frame',
  body: unknown,
  signal: AbortSignal,
  onReconnect?: () => void,
) {
  const requestId = crypto.randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetch('/api/video/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Capture-Request': requestId },
        body: JSON.stringify(body),
        signal,
      });
      const text = await response.text();
      if (!text.trim())
        throw Error(`Tracking service returned an empty response (HTTP ${response.status}).`);
      let value: T & { error?: string };
      try {
        value = JSON.parse(text);
      } catch {
        throw Error(`Tracking service returned an invalid response (HTTP ${response.status}).`);
      }
      if (!value || typeof value !== 'object')
        throw Error('Tracking service returned invalid data.');
      if (!response.ok) throw Error(value.error || `Tracking failed (HTTP ${response.status}).`);
      return value;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      // HTTP/model failures already carry useful diagnostics; don't hide them.
      if (!(error instanceof TypeError)) throw error;
      if (attempt === 2)
        throw Error(
          endpoint === 'calibrate'
            ? 'The connection was interrupted while preparing your capture. Please retry.'
            : 'The connection was interrupted while following your movement. Please retry.',
        );
      onReconnect?.();
      await pause(signal);
      const until = Date.now() + 300_000;
      let unavailable = 0;
      while (Date.now() < until) {
        signal.throwIfAborted();
        try {
          const statusResponse = await fetch('/api/video/status', {
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          });
          if (statusResponse.ok) {
            const status = await statusResponse.json();
            unavailable = 0;
            if (!(endpoint === 'frame' ? status.busy : status.pro?.busy)) break;
          } else unavailable++;
        } catch (failure) {
          if (signal.aborted) throw signal.reason;
          unavailable++;
        }
        if (unavailable >= 6)
          throw Error('The capture service is unreachable. Restart the app and retry.');
        await pause(signal);
      }
      if (Date.now() >= until) throw Error('Capture is still busy. Wait a moment and try again.');
    }
  }
  throw Error('Capture could not reconnect.');
}
