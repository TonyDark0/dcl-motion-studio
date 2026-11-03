import { describe, expect, it } from 'vitest';
import { chapters } from '../src/documentation-content';
import { localizedChapters } from '../src/localized-docs';
import { languages } from '../src/preferences';

describe('local documentation', () => {
  for (const [locale] of languages) {
    it(`retains complete instructions and local scope in ${locale}`, () => {
      const translated = localizedChapters(chapters, locale);
      chapters.forEach((chapter, c) =>
        chapter.sections.forEach((section, s) => {
          const actual = translated[c].sections[s];
          expect(actual.text?.length).toBe(section.text?.length);
          expect(actual.steps?.length).toBe(section.steps?.length);
          expect(actual.table?.headers.length).toBe(section.table?.headers.length);
          expect(actual.table?.rows.map((row) => row.length)).toEqual(
            section.table?.rows.map((row) => row.length),
          );
          expect(Boolean(actual.note)).toBe(Boolean(section.note));
        }),
      );
      const text = JSON.stringify(translated);
      expect(text).not.toMatch(
        /plan to release the project on GitHub|planned for release on GitHub|future GitHub release|browser-and-cloud demo|Use Rate animation/i,
      );
      expect(translated.find((c) => c.id === 'setup')?.sections[0].steps).toHaveLength(5);
    });
  }
});
