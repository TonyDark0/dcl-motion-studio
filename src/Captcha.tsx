import { useEffect, useRef, useState } from 'react';
import './community.css';
import { translate as t } from './i18n';
export type CaptchaAnswer = { id: string; answer: string } | null;
type Challenge = {
  id: string;
  provider: 'local-arithmetic' | 'turnstile';
  question?: string;
  siteKey?: string;
};
type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let scriptLoading: Promise<void> | undefined;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  return (scriptLoading ||= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      scriptLoading = undefined;
      reject(Error('Verification unavailable'));
    };
    document.head.appendChild(script);
  }));
}
export function Captcha({
  onChange,
  locale = 'en',
}: {
  onChange: (answer: CaptchaAnswer) => void;
  locale?: import('./preferences').Locale;
}) {
  const [challenge, setChallenge] = useState<Challenge | null>(null),
    [answer, setAnswer] = useState(''),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    onChange(null);
    setChallenge(null);
    setAnswer('');
    setError('');
    void fetch('/api/captcha', { signal: abort.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error);
        return data;
      })
      .then(setChallenge)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [refresh, onChange]);
  useEffect(() => {
    if (challenge?.provider !== 'turnstile') return;
    let alive = true,
      widget: string | undefined;
    void loadTurnstile()
      .then(() => {
        if (!alive || !host.current) return;
        widget = window.turnstile!.render(host.current, {
          sitekey: challenge.siteKey,
          action: 'studio',
          cData: challenge.id,
          language: locale,
          theme: 'auto',
          callback: (token: string) => onChange({ id: challenge.id, answer: token }),
          'expired-callback': () => onChange(null),
          'error-callback': () => {
            onChange(null);
            setError(t('Verification failed. Try again.'));
          },
        });
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [challenge, locale, onChange]);
  return (
    <div className="studio-captcha">
      <div className="captcha-heading">
        <span>{t('Verification')}</span>
        <button
          type="button"
          onClick={() => setRefresh((n) => n + 1)}
          aria-label={t('Refresh challenge')}
          title={t('Refresh challenge')}
        >
          ↻
        </button>
      </div>
      {challenge?.provider === 'local-arithmetic' && (
        <label className="captcha-question">
          <span>
            {t('What is')} <b>{challenge.question}</b>?
          </span>
          <input
            aria-label={t('Your answer')}
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              onChange({ id: challenge.id, answer: e.target.value.trim() });
            }}
          />
        </label>
      )}
      {challenge?.provider === 'turnstile' && <div ref={host} />}
      {!challenge && !error && <p role="status">{t('Loading verification…')}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
