import type { DocChapter } from './documentation-content';
import type { Locale } from './preferences';
import { translations } from './translations';
// Translate individual fields so every locale retains the complete instructions.
// Missing translations fall back to the current source, never an older summary.
export function localizedChapters(chapters: DocChapter[], locale: Locale) {
  if (locale === 'en') return chapters;
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
      text: section.text?.map(t),
      steps: section.steps?.map(t),
      table: section.table && {
        headers: section.table.headers.map(t),
        rows: section.table.rows.map((row) => row.map(t)),
      },
      note: section.note && t(section.note),
      caption: section.caption && t(section.caption),
    })),
  }));
  return localized;
}
