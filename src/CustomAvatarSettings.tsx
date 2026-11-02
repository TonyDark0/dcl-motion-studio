import { useRef, useState } from 'react';
import { Modal, Button } from './ui';
import { useStudio } from './store';
import { useT } from './i18n';
import { walletPattern, type CustomAvatar } from './custom-avatar-types';

export function CustomAvatarSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStudio(),
    t = useT();
  const [wallet, setWallet] = useState(s.customAvatar?.wallet || '');
  const request = useRef<AbortController | null>(null);
  async function load() {
    const address = wallet.trim();
    if (!walletPattern.test(address)) {
      s.set({ avatarError: 'Enter a valid wallet address (0x followed by 40 characters).' });
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    s.set({ avatarLoading: true, avatarError: '' });
    try {
      const response = await fetch('/api/avatar/' + address, { signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Could not load the custom avatar.');
      if (!controller.signal.aborted) s.set({ customAvatar: result as CustomAvatar });
    } catch (error) {
      if (!controller.signal.aborted)
        s.set({ avatarLoading: false, avatarError: (error as Error).message });
    }
  }
  return (
    <Modal open={open} onClose={onClose} size="small">
      <Modal.Header>{t('Custom avatar')}</Modal.Header>
      <Modal.Content>
        <p className="small subtle">
          {t(
            'Preview your Decentraland avatar and equipped wearables using its public wallet address.',
          )}
        </p>
        <form
          id="custom-avatar-form"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <label className="settings-field">
            {t('Wallet address')}
            <input
              aria-label={t('Wallet address')}
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              maxLength={42}
              disabled={s.avatarLoading}
            />
          </label>
        </form>
        <p className="small subtle">
          {t(
            'For preview only. Emote export includes the rig; full GLB export uses the default avatar.',
          )}
        </p>
        {s.avatarError && (
          <p role="alert" className="custom-avatar-error">
            {t(s.avatarError)}
          </p>
        )}
        <div aria-live="polite" className="small custom-avatar-status">
          {s.avatarLoading ? (
            t('Loading custom avatar…')
          ) : s.customAvatar && !s.avatarError ? (
            <>
              <strong>{s.customAvatar.name}</strong>
              <br />
              {t('Custom avatar active')}
              {s.customAvatar.warnings.map((w) => (
                <p key={w}>{t(w)}</p>
              ))}
            </>
          ) : (
            t('Default avatar active')
          )}
        </div>
      </Modal.Content>
      <Modal.Actions>
        <Button
          onClick={() => {
            request.current?.abort();
            s.set({ customAvatar: null, avatarLoading: false, avatarError: '' });
          }}
        >
          {t('Use default avatar')}
        </Button>
        <Button onClick={onClose}>{t('Close')}</Button>
        <Button primary type="submit" form="custom-avatar-form" loading={s.avatarLoading}>
          {t('Load avatar')}
        </Button>
      </Modal.Actions>
    </Modal>
  );
}
