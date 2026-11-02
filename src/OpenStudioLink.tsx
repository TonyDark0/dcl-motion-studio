import { translate as tr } from './i18n';
import './open-studio-link.css';

export function OpenStudioLink() {
  return (
    <a className="open-studio-link" href="/app">
      <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
        <path d="M6 4.7c0-.8.9-1.3 1.6-.9l8 4.4a2 2 0 0 1 0 3.6l-8 4.4c-.7.4-1.6-.1-1.6-.9Z" />
      </svg>
      <span>{tr("Open studio")}</span>
    </a>
  );
}
