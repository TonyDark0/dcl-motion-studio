import { useSyncExternalStore } from 'react';
export const languages = [
  ['en', 'English'],
  ['es', 'Español'],
  ['ja', '日本語'],
  ['de', 'Deutsch'],
  ['ru', 'Русский'],
  ['ar', 'العربية'],
  ['zh', '中文'],
] as const;
export type Locale = (typeof languages)[number][0];
export type ThemeChoice = 'dark' | 'light';
const listeners = new Set<() => void>();
function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
const savedLocale = read('dcl-motion-locale');
let state = {
  locale: (languages.some(([id]) => id === savedLocale) ? savedLocale : 'en') as Locale,
  theme: (read('dcl-studio-theme') === 'light' ? 'light' : 'dark') as ThemeChoice,
};
function apply() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = state.locale;
  document.documentElement.dir = state.locale === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.dataset.studioTheme = state.theme;
}
function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  apply();
  for (const listener of listeners) listener();
}
export const getPreferences = () => state;
export const subscribePreferences = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function setLocale(locale: Locale) {
  if (!languages.some(([id]) => id === locale)) return;
  try {
    localStorage.setItem('dcl-motion-locale', locale);
  } catch {
    /* Optional storage. */
  }
  update({ locale });
}
export function setTheme(theme: ThemeChoice) {
  try {
    localStorage.setItem('dcl-studio-theme', theme);
  } catch {
    /* Optional storage. */
  }
  update({ theme });
}
export const usePreferences = () =>
  useSyncExternalStore(subscribePreferences, getPreferences, getPreferences);
if (typeof window !== 'undefined') {
  apply();
  window.addEventListener('storage', (e) => {
    if (e.key === 'dcl-motion-locale')
      update({
        locale: (languages.some(([id]) => id === e.newValue) ? e.newValue : 'en') as Locale,
      });
    if (e.key === 'dcl-studio-theme') update({ theme: e.newValue === 'light' ? 'light' : 'dark' });
  });
}
