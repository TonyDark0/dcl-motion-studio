import messages from './locales/messages.json';
import type { Locale } from './preferences';
export const translations: Partial<Record<Locale, Record<string, string>>> = messages;
