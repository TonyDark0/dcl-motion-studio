import { useEffect, useState } from 'react';
import { Button, Modal } from './ui';
import { useT } from './i18n';
import { LegacyProjects } from './LegacyProjects';

export type ProjectSummary = {
  id: string;
  name: string;
  updated: string;
  workflow: 'text' | 'video';
  thumbnail: string | null;
};
export function Projects({
  newRequest,
  items,
  loading,
  error,
  disabled,
  onRefresh,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: {
  newRequest: number;
  items: ProjectSummary[];
  loading: boolean;
  error: string;
  disabled: boolean;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onCreate: (name: string, workflow: 'text' | 'video') => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
}) {
  const t = useT();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<'new' | ProjectSummary | null>(null);
  const [name, setName] = useState('');
  const [workflow, setWorkflow] = useState<'text' | 'video'>('text');
  const [renaming, setRenaming] = useState(false);
  const [failure, setFailure] = useState('');
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  useEffect(onRefresh, []);
  useEffect(() => {
    if (newRequest) {
      setName('');
      setFailure('');
      setDialog('new');
    }
  }, [newRequest]);
  const visible = items.filter(
    (item) =>
      (filter === 'all' || item.workflow === filter) &&
      item.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section
      id="projects-workspace"
      role="tabpanel"
      className="projects-workspace"
      aria-label={t('Projects')}
    >
      <div className="projects-heading">
        <div>
          <h1>{t('Projects')}</h1>
          <p>{t('Your local animation projects.')}</p>
        </div>
      </div>
      <LegacyProjects onRecovered={onRefresh} />
      <div className="projects-toolbar">
        <input
          type="search"
          aria-label={t('Search projects')}
          placeholder={t('Search projects')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label={t('Filter projects')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">{t('All projects')}</option>
          <option value="text">{t('Text to emote')}</option>
          <option value="video">{t('Video to emote')}</option>
        </select>
        <div role="group" aria-label={t('Project view')}>
          <button aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
            {t('Preview')}
          </button>
          <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
            {t('List')}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert">
          {error} <button onClick={onRefresh}>{t('Retry')}</button>
        </p>
      )}
      {loading ? (
        <p role="status">{t('Loading projects…')}</p>
      ) : !visible.length ? (
        <p className="projects-empty">{t('No projects yet. Create a project to begin.')}</p>
      ) : (
        <div className={`project-collection ${view}`}>
          {visible.map((item) => (
            <article className="project-card" key={item.id}>
              <button
                className="project-open"
                disabled={disabled}
                onClick={() => onOpen(item.id)}
                aria-label={`${t('Open project')}: ${item.name}`}
              >
                {view === 'grid' && (
                  <div className="project-thumbnail">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" />
                    ) : (
                      <span aria-hidden="true">◇</span>
                    )}
                  </div>
                )}
                <div className="project-card-info">
                  <strong>{item.name}</strong>
                  <small>
                    {t(item.workflow === 'text' ? 'Text to emote' : 'Video to emote')} ·{' '}
                    {new Date(item.updated).toLocaleDateString()}
                  </small>
                </div>
              </button>
              <button
                className="project-rename"
                disabled={disabled}
                aria-label={`${t('Rename')}: ${item.name}`}
                onClick={() => {
                  setName(item.name);
                  setFailure('');
                  setDialog(item);
                }}
              >
                {t('Rename')}
              </button>
              <button
                className="project-delete"
                disabled={disabled}
                aria-label={t('Delete project') + ': ' + item.name}
                onClick={() => {
                  setFailure('');
                  setDeleting(item);
                }}
              >
                {t('Delete')}
              </button>
            </article>
          ))}
        </div>
      )}
      {disabled && (
        <p className="subtle">
          {t('Finish reviewing the current animation before opening another project.')}
        </p>
      )}
      <Modal open={!!deleting} onClose={() => !renaming && setDeleting(null)}>
        <Modal.Header>{t('Delete project')}</Modal.Header>
        <Modal.Content>
          <p>
            {t('Delete this saved project?')} <strong>{deleting?.name}</strong>
          </p>
          {failure && <p role="alert">{failure}</p>}
        </Modal.Content>
        <Modal.Actions>
          <Button disabled={renaming} onClick={() => setDeleting(null)}>
            {t('Cancel')}
          </Button>
          <Button
            primary
            disabled={renaming}
            onClick={async () => {
              if (!deleting) return;
              setRenaming(true);
              try {
                await onDelete(deleting.id);
                setDeleting(null);
              } catch (e) {
                setFailure(String(e));
              } finally {
                setRenaming(false);
              }
            }}
          >
            {t('Delete')}
          </Button>
        </Modal.Actions>
      </Modal>
      <Modal open={!!dialog} onClose={() => !renaming && setDialog(null)}>
        <Modal.Header>{t(dialog === 'new' ? 'New project' : 'Rename project')}</Modal.Header>
        <Modal.Content>
          <label className="field-label">
            {t('Project name')}
            <input
              autoFocus
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {dialog === 'new' && (
            <label className="field-label">
              {t('Workflow')}
              <select
                value={workflow}
                onChange={(e) => setWorkflow(e.target.value as 'text' | 'video')}
              >
                <option value="text">{t('Text to emote')}</option>
                <option value="video">{t('Video to emote')}</option>
              </select>
            </label>
          )}
          {failure && <p role="alert">{failure}</p>}
        </Modal.Content>
        <Modal.Actions>
          <Button onClick={() => setDialog(null)} disabled={renaming}>
            {t('Cancel')}
          </Button>
          <Button
            primary
            disabled={!name.trim() || renaming}
            onClick={async () => {
              if (dialog === 'new') {
                onCreate(name.trim(), workflow);
                setDialog(null);
              } else if (dialog) {
                setRenaming(true);
                try {
                  await onRename(dialog.id, name.trim());
                  setDialog(null);
                } catch (e) {
                  setFailure(String(e));
                } finally {
                  setRenaming(false);
                }
              }
            }}
          >
            {t(dialog === 'new' ? 'Create project' : 'Rename')}
          </Button>
        </Modal.Actions>
      </Modal>
    </section>
  );
}
