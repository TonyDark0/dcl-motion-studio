import { useEffect, useRef, useState } from 'react';
import { Captcha, type CaptchaAnswer } from './Captcha';
export function LocalProfile() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false),
    [ready, setReady] = useState(false),
    [name, setName] = useState(''),
    [captcha, setCaptcha] = useState<CaptchaAnswer>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const abort = new AbortController();
    void fetch('/api/session', { signal: abort.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error);
        return data;
      })
      .then((data) => {
        setName(data.user.name);
        setReady(true);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => {
      abort.abort();
      dialog.current?.close();
    };
  }, [open]);
  return (
    <>
      <button
        className="lp-profile-link"
        onClick={() => {
          setError('');
          setReady(false);
          setOpen(true);
        }}
      >
        Mi espacio
      </button>
      {open && (
        <dialog
          className="lp-profile-dialog"
          ref={dialog}
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else setOpen(false);
          }}
          onClose={() => setOpen(false)}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!captcha?.answer) return;
              setBusy(true);
              setError('');
              try {
                const r = await fetch('/api/session', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name, captcha }),
                });
                const data = await r.json();
                if (!r.ok) throw Error(data.error);
                setOpen(false);
              } catch (e) {
                setError(String(e));
                setRefresh((n) => n + 1);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="lp-profile-heading">
              <h2>Tu espacio creativo</h2>
              <button
                type="button"
                aria-label="Cerrar"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <p>
              Elige cómo quieres llamar a tu espacio. Es opcional: puedes usar la app sin completar
              este formulario.
            </p>
            <label>
              Tu nombre
              <input
                value={name}
                disabled={!ready || busy}
                required
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                autoComplete="nickname"
              />
            </label>
            {ready && <Captcha key={refresh} onChange={setCaptcha} />}
            <p className="lp-profile-small">
              Se guarda en esta instalación y se reconoce desde este navegador. No necesitas email,
              contraseña ni conectar una wallet.
            </p>
            {error && <p role="alert">{error}</p>}
            <button
              className="lp-cta"
              type="submit"
              disabled={!ready || busy || !name.trim() || !captcha?.answer}
            >
              {busy ? 'Guardando…' : 'Guardar nombre'}
            </button>
          </form>
        </dialog>
      )}
    </>
  );
}
