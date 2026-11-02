import { translate as tr } from './i18n';
import { usePreferences } from './preferences';
import { SitePreferences } from './SitePreferences';
import { useEffect, useRef, useState } from 'react';
import { chapters as sourceChapters } from './documentation-content';
import { localizedChapters } from './localized-docs';
import './documentation.css';
import { OpenStudioLink } from './OpenStudioLink';
function locationChapter() {
  return location.hash.slice(1).split('/')[0] || 'start';
}
export default function Documentation() {
  const { locale } = usePreferences();
  const chapters = localizedChapters(sourceChapters, locale);
  const [id, setId] = useState(locationChapter),
    [query, setQuery] = useState(''),
    [menu, setMenu] = useState(false),
    [enlarged, setEnlarged] = useState<{ image: string; caption: string } | null>(null);
  const main = useRef<HTMLElement>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const chapter = chapters.find((c) => c.id === id) || chapters[0],
    index = chapters.indexOf(chapter);
  const filtered = chapters.filter((c) =>
    JSON.stringify(c).toLowerCase().includes(query.toLowerCase().trim()),
  );
  useEffect(() => {
    const change = () => {
      setId(locationChapter());
      setMenu(false);
      const section = location.hash.slice(1).split('/')[1];
      if (section) requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView());
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    document.title = chapter.title + ' · DCL Motion Studio Docs';
    const section = location.hash.slice(1).split('/')[1];
    if (section) requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView());
    else {
      window.scrollTo(0, 0);
      main.current?.focus({ preventScroll: true });
    }
  }, [chapter]);
  useEffect(() => {
    if (enlarged) dialog.current?.showModal();
    else dialog.current?.close();
  }, [enlarged]);
  return (
    <div className="docs">
      <a
        className="docs-skip"
        href="#docs-article"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
      >
        {tr('Skip to article')}
      </a>
      <header className="docs-header">
        <a href="/" className="docs-brand">
          <img className="docs-brand-mark" src="/dcl-studio-mark.svg" alt="" aria-hidden="true" />
          <span className="docs-wordmark">
            DCL MOTION<small>STUDIO</small>
          </span>
        </a>
        <a href="/docs" className="docs-badge">
          {tr('Documentation')}
          <span>{tr('Beta')}</span>
        </a>
        <SitePreferences />
        <OpenStudioLink />
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <button className="docs-menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            {tr('Browse documentation')}
            <span>{menu ? '−' : '+'}</span>
          </button>
          <div className={menu ? 'docs-navigation is-open' : 'docs-navigation'}>
            <label className="docs-search">
              {tr('Find a topic')}
              <input
                type="search"
                placeholder={tr('Search documentation…')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <nav aria-label={tr('Documentation chapters')}>
              {[...new Set(chapters.map((c) => c.group))].map((group) => (
                <div key={tr(group)}>
                  <h2>{tr(group)}</h2>
                  {filtered
                    .filter((c) => c.group === group)
                    .map((c) => (
                      <a
                        key={c.id}
                        href={'#' + c.id}
                        aria-current={c.id === chapter.id ? 'page' : undefined}
                        onClick={() => setMenu(false)}
                      >
                        {tr(c.title)}
                      </a>
                    ))}
                </div>
              ))}
            </nav>
            {!filtered.length && (
              <p role="status">{tr('No topics found. Try “hands”, “loop”, or “export”.')}</p>
            )}
            <a className="docs-home" href="/">
              {tr('← Back to Studio')}
            </a>
          </div>
        </aside>
        <main ref={main} tabIndex={-1} id="docs-article" className="docs-article">
          <div className="docs-breadcrumb">
            {tr('Documentation /')}
            {tr(chapter.group)}
          </div>
          <h1>{tr(chapter.title)}</h1>
          <p className="docs-intro">{tr(chapter.summary)}</p>
          <div className="docs-rule" />
          {chapter.sections.map((section) => (
            <section id={section.id} key={section.id}>
              <h2>
                <a
                  href={'#' + chapter.id + '/' + section.id}
                  onClick={() =>
                    setTimeout(
                      () =>
                        document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth' }),
                      0,
                    )
                  }
                >
                  {tr(section.title)}
                  <span aria-hidden="true"> #</span>
                </a>
              </h2>
              {section.text?.map((text) => (
                <p key={tr(text)}>{tr(text)}</p>
              ))}
              {section.steps && (
                <ol className="docs-steps">
                  {section.steps.map((step) => (
                    <li key={tr(step)}>{tr(step)}</li>
                  ))}
                </ol>
              )}
              {section.table && (
                <div className="docs-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {section.table.headers.map((h) => (
                          <th scope="col" key={tr(h)}>
                            {tr(h)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.table.rows.map((row) => (
                        <tr key={row[0]}>
                          {row.map((cell, i) => (
                            <td key={i}>{tr(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {section.code && (
                <pre>
                  <code>{section.code}</code>
                </pre>
              )}
              {section.note && (
                <aside className="docs-note">
                  <strong>{tr('Good to know')}</strong>
                  <p>{tr(section.note)}</p>
                </aside>
              )}
              {section.image && (
                <figure>
                  <button
                    className="docs-image"
                    style={{ maxWidth: section.imageWidth || 1440 }}
                    aria-label={
                      'Enlarge ' +
                      (section.illustration ? 'illustration' : 'screenshot') +
                      ': ' +
                      section.title
                    }
                    onClick={() =>
                      setEnlarged({ image: section.image!, caption: section.caption! })
                    }
                  >
                    <img
                      src={'/docs/images/' + section.image}
                      alt={tr(section.caption || section.title)}
                      loading="lazy"
                      width={section.imageWidth || 1440}
                      height={section.imageHeight || 1000}
                    />
                    <span>{tr('View full size ↗')}</span>
                  </button>
                  <figcaption>{tr(section.caption || section.title)}</figcaption>
                </figure>
              )}
            </section>
          ))}
          <nav className="docs-pagination" aria-label={tr('Article navigation')}>
            {index > 0 ? (
              <a href={'#' + chapters[index - 1].id}>
                <small>{tr('← Previous')}</small>
                {tr(chapters[index - 1].title)}
              </a>
            ) : (
              <span />
            )}
            {index < chapters.length - 1 && (
              <a href={'#' + chapters[index + 1].id}>
                <small>{tr('Next →')}</small>
                {tr(chapters[index + 1].title)}
              </a>
            )}
          </nav>
          <p className="docs-version">
            {tr('Current beta workflow · Screenshots from the running studio')}
          </p>
        </main>
        <aside className="docs-toc">
          <span>{tr('On this page')}</span>
          {chapter.sections.map((s) => (
            <a
              href={'#' + chapter.id + '/' + s.id}
              key={s.id}
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' })}
            >
              {tr(s.title)}
            </a>
          ))}
        </aside>
      </div>
      <dialog
        ref={dialog}
        className="docs-lightbox"
        onCancel={() => setEnlarged(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setEnlarged(null);
        }}
      >
        {enlarged && (
          <>
            <button autoFocus onClick={() => setEnlarged(null)} aria-label={tr('Close screenshot')}>
              ✕
            </button>
            <img src={'/docs/images/' + enlarged.image} alt={enlarged.caption} />
            <p>{enlarged.caption}</p>
          </>
        )}
      </dialog>
    </div>
  );
}
