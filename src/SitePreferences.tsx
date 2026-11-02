import { languages, setLocale, setTheme, usePreferences, type Locale } from './preferences';
import { useT } from './i18n';
import './site-preferences.css';
export function SitePreferences() {
  const { locale, theme } = usePreferences();
  const t = useT();
  return (
    <div className="site-preferences">
      <button
        type="button"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={t(theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')}
        title={t(theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          {theme === 'dark' ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
            </>
          ) : (
            <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />
          )}
        </svg>
      </button>
      <select
        aria-label={t('Language')}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        {languages.map(([id, name]) => (
          <option key={id} value={id} lang={id}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
