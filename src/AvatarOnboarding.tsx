import { useEffect, useRef, useState } from 'react';
import { useStudio } from './store';
import { useT } from './i18n';
import { walletPattern, type CustomAvatar } from './custom-avatar-types';

export function AvatarOnboarding({ onComplete }: { onComplete: () => void }) {
  const s = useStudio();
  const t = useT();
  const [wallet, setWallet] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function preview(event: React.FormEvent) {
    event.preventDefault();
    const address = wallet.trim();
    if (!walletPattern.test(address)) {
      setError(t('Enter a valid wallet address (0x followed by 40 characters).'));
      return;
    }
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/avatar/' + address, { signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Could not load the custom avatar.');
      if (!controller.signal.aborted) {
        s.set({ customAvatar: result as CustomAvatar, avatarError: '' });
        onComplete();
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <div className="avatar-onboarding-backdrop">
      <section className="avatar-onboarding" aria-labelledby="avatar-onboarding-title">
        <span className="avatar-onboarding-kicker">{t('MAKE IT YOURS')}</span>
        <h2 id="avatar-onboarding-title">{t('Preview your avatar')}</h2>
        <p>{t('Enter your wallet to see your Decentraland avatar in the studio.')}</p>
        <form onSubmit={(event) => void preview(event)}>
          <label htmlFor="avatar-onboarding-wallet">{t('Wallet address')}</label>
          <div className="avatar-onboarding-field">
            <input
              id="avatar-onboarding-wallet"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={42}
              placeholder="0x…"
              value={wallet}
              onChange={(event) => setWallet(event.target.value)}
              disabled={loading}
            />
            <button type="submit" disabled={loading}>
              {loading ? t('Loading avatar…') : t('Preview my avatar')}
            </button>
          </div>
        </form>
        {error && <p className="avatar-onboarding-error" role="alert">{error}</p>}
        <button
          type="button"
          className="avatar-onboarding-default"
          disabled={loading}
          onClick={() => {
            s.set({ customAvatar: null, avatarError: '' });
            onComplete();
          }}
        >
          {t('Use default avatar instead')}
        </button>
        <small>{t('You can change your avatar later in Settings.')}</small>
      </section>
    </div>
  );
}
