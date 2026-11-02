import type { DocChapter } from './documentation-content';
import type { Locale } from './preferences';
import { translations } from './translations';
const cache = new Map<Locale, DocChapter[]>();
// Localized editions preserve the same chapter/section anchors and real UI figures.
// Prose is adapted for clarity; the English edition retains the expanded reference tables.
export function localizedChapters(chapters: DocChapter[], locale: Locale) {
  if (locale === 'en') return chapters;
  if (cache.has(locale)) return cache.get(locale)!;
  const messages = translations[locale] || {};
  const t = (key: string) => messages[key] || key;
  const localized = chapters.map((chapter) => ({
    ...chapter,
    title: t(chapter.title),
    group: t(chapter.group),
    summary: t(chapter.summary),
    sections: chapter.sections.map((section) => ({
      ...section,
      title: t(section.title),
      text: [messages['doc.' + section.id] || section.text?.join(' ') || ''],
      steps: undefined,
      table: undefined,
      note: undefined,
      caption: section.image
        ? t(section.title) + ' · ' + t('Interface shown in English')
        : undefined,
    })),
  }));
  cache.set(locale, localized);
  return localized;
}
