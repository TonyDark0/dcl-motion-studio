import { useEffect, useState } from 'react';
import { Captcha, type CaptchaAnswer } from './Captcha';
import { Button, Modal } from './ui';
import { useT } from './i18n';
import { useStudio } from './store';
export function LegacyProjects({ onRecovered }: { onRecovered: () => void }) {
  const t = useT(),
    locale = useStudio((s) => s.locale);
  const [count, setCount] = useState(0),
    [open, setOpen] = useState(false),
    [captcha, setCaptcha] = useState<CaptchaAnswer>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/legacy-projects', { signal: abort.signal })
      .then((r) => r.json())
      .then((data) => setCount(data.count || 0))
      .catch(() => {});
    return () => abort.abort();
  }, []);
  if (!count) return null;
  return (
    <>
      <p className="legacy-project-notice">
        {t('Projects from the previous installation are available.')}{' '}
        <button onClick={() => setOpen(true)}>{t('Recover projects')}</button>
      </p>
      <Modal open={open} onClose={() => !busy && setOpen(false)}>
        <Modal.Header>{t('Recover projects')}</Modal.Header>
        <Modal.Content>
          <p>
            {t(
              'Move the existing local projects into this browser’s space. This does not delete them.',
            )}
          </p>
          <Captcha key={retry} locale={locale} onChange={setCaptcha} />
          {error && <p role="alert">{error}</p>}
        </Modal.Content>
        <Modal.Actions>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button
            primary
            disabled={busy || !captcha?.answer}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await fetch('/api/legacy-projects/claim', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ captcha }),
                });
                const data = await r.json();
                if (!r.ok) throw Error(data.error);
                setCount(0);
                setOpen(false);
                onRecovered();
              } catch (e) {
                setError(String(e));
                setRetry((n) => n + 1);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('Recover projects')}
          </Button>
        </Modal.Actions>
      </Modal>
    </>
  );
}
