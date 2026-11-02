import { languages, type Locale } from './preferences';
import { AvatarControls } from './AvatarControls';
import { CustomAvatarSettings } from './CustomAvatarSettings';
import { AvatarOnboarding } from './AvatarOnboarding';
import { StudioTour, studioTourSeen } from './StudioTour';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Button, Modal, useThemeChoice } from './ui';
import Popover from '@mui/material/Popover';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { Viewport, activeRig, captureViewport } from './Viewport';
import { useStudio } from './store';
import { defaults, motionSchema, projectSchema, type Project } from './motion';
import type { AvatarRig } from './rig';
import { VideoPanel } from './VideoPanel';
import { ImagePosePanel } from './ImagePosePanel';
import { referenceRequest } from './pose-reference';
import { animationName } from './export-settings';
import { Timeline } from './TimelineEditor';
import { Projects, type ProjectSummary } from './Projects';
import { newProject } from './motion';
import { newTimeline } from './timeline';
import { useT } from './i18n';
import { rgbToHsv, hsvToRgb } from './color-picker';
import type { ConstraintCapability } from '../server/engine-capabilities';
type Health = {
    ok: boolean;
    engine: {
        configured: boolean;
        missing: string[];
        running: boolean;
        busy: boolean;
        constraints?: boolean;
    };
    config: {
        executable: string;
        model: string;
        text: string;
        device: 'cpu' | 'vulkan';
    };
};
type Job = {
    id: string;
    prompt: string;
    status: string;
    error?: string;
    progress?: string;
};
type ProjectAction = {
    id: string;
} | {
    name: string;
    workflow: 'text' | 'video';
} | {
    projects: true;
};
async function api(url: string, options?: RequestInit) {
    ;
    ;
    ;
    ;
    const headers = new Headers(options?.headers);
    if (options?.body != null && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    const r = await fetch('/api' + url, {
        ...options,
        headers,
    });
    const body = await r.json();
    if (!r.ok)
        throw Error(body.error || 'Error de conexión');
    return body;
}
function download(name: string, data: BlobPart, type: string) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function colorHex(value: [
    number,
    number,
    number
]) {
    return ('#' +
        value
            .map((n) => Math.round(Math.max(0, Math.min(1, n)) * 255)
            .toString(16)
            .padStart(2, '0'))
            .join(''));
}
function randomSeed(previous: number | null) {
    const value = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
    return value === previous ? (value + 1) & 0x7fffffff : value;
}
function Glyph({ name }: {
    name: string;
}) {
    return (<span className="glyph" aria-hidden="true">
      {({
            play: '▶',
            pause: 'Ⅱ',
            back: '↶',
            next: '↷',
            save: '↓',
            spark: '✦',
            eye: '◉',
            plus: '＋',
            settings: '⚙',
            folder: '▤',
            close: '×',
        } as Record<string, string>)[name] || name}
    </span>);
}
export function App() {
    const s = useStudio(), p = s.project;
    const t = useT();
    const { choice: themeChoice, setChoice: setThemeChoice } = useThemeChoice();
    const [generationDuration, setGenerationDuration] = useState(4);
    const [lockSeed, setLockSeed] = useState(false);
    const [lastGeneratedSeed, setLastGeneratedSeed] = useState<number | null>(null);
    const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
    const [customAvatarOpen, setCustomAvatarOpen] = useState(false);
    const [avatarOnboarding, setAvatarOnboarding] = useState(false);
    const [tourPending, setTourPending] = useState(false);
    const [tourOpen, setTourOpen] = useState(false);
    const [analyzingPose, setAnalyzingPose] = useState(false);
    const [constraintsCheck, setConstraintsCheck] = useState<(ConstraintCapability & {
        executable: string;
    }) | null>(null);
    const [checkingConstraints, setCheckingConstraints] = useState(false);
    const [workArea, setWorkArea] = useState<'projects' | 'text' | 'video'>('projects');
    const [controlsCollapsed, setControlsCollapsed] = useState(() => {
        try {
            return window.localStorage.getItem('dcl-controls-collapsed') === 'true';
        }
        catch {
            return false;
        }
    });
    const [timelineCollapsed, setTimelineCollapsed] = useState(false);
    const [projectAction, setProjectAction] = useState<ProjectAction | null>(null);
    const savedSnapshot = useRef<Project | null>(null);
    const saving = useRef(false);
    const [newProjectRequest, setNewProjectRequest] = useState(0);
    const lastThumbnail = useRef<string | null>(null);
    const [ready, setReady] = useState(false), [health, setHealth] = useState<Health | null>(null), [engineOpen, setEngineOpen] = useState(false), [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null), [busy, setBusy] = useState(false), [saved, setSaved] = useState('Unsaved'), [projectId, setProjectId] = useState<string>(() => crypto.randomUUID()), [jobs, setJobs] = useState<Job[]>([]), [library, setLibrary] = useState<ProjectSummary[]>([]), [projectsLoading, setProjectsLoading] = useState(false), [projectsError, setProjectsError] = useState(''), [diagnostics, setDiagnostics] = useState<AvatarRig['diagnostics'] | null>(null), [activeColor, setActiveColor] = useState<'skin' | 'hair' | null>(null), [cameraMode, setCameraMode] = useState<'single' | 'dual'>('single'), [cameraView, setCameraView] = useState<'free' | 'front' | 'left' | 'right' | 'back'>('free'), [engineDraft, setEngineDraft] = useState<Health['config']>({
        executable: '',
        model: '',
        text: '',
        device: 'vulkan',
    });
    const colorDock = useRef<HTMLDivElement>(null);
    const activated = useRef(new Set<string>());
    const lastRequestedSeed = useRef<number | null>(null);
    const notify = (message: string) => useStudio.getState().set({ message });
    useEffect(() => {
        if (tourPending &&
            ready &&
            !s.avatarLoading &&
            !avatarOnboarding &&
            workArea !== 'projects' &&
            !settingsAnchor) {
            setTourPending(false);
            setTourOpen(true);
        }
    }, [tourPending, ready, s.avatarLoading, avatarOnboarding, workArea, settingsAnchor]);
    const refresh = useCallback(async () => {
        try {
            const [h, j] = await Promise.all([api('/health'), api('/jobs')]);
            setHealth(h);
            setJobs(j);
        }
        catch {
            setHealth(null);
        }
    }, []);
    useEffect(() => {
        void refresh();
        const id = setInterval(() => {
            void refresh();
        }, 2500);
        return () => clearInterval(id);
    }, [refresh]);
    useEffect(() => {
        const sync = () => {
            const workflow = useStudio.getState().project.workflow;
            const target = window.location.hash === '#projects' ? 'projects' : workflow;
            setWorkArea(target);
            const canonical = target === 'projects'
                ? '#projects'
                : workflow === 'video'
                    ? '#video-to-motion'
                    : '#text-to-emote';
            if (window.location.hash !== canonical)
                window.history.replaceState(null, '', canonical);
        };
        window.addEventListener('hashchange', sync);
        return () => window.removeEventListener('hashchange', sync);
    }, []);
    useEffect(() => {
        try {
            window.localStorage.setItem('dcl-controls-collapsed', String(controlsCollapsed));
        }
        catch {
            // The panel stays usable when the browser disallows local storage.
        }
    }, [controlsCollapsed]);
    useEffect(() => {
        if (!s.message)
            return;
        const t = setTimeout(() => useStudio.getState().set({ message: '' }), 7000);
        return () => clearTimeout(t);
    }, [s.message]);
    useEffect(() => {
        const close = (event: PointerEvent) => {
            if (!colorDock.current?.contains(event.target as Node))
                setActiveColor(null);
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, []);
    useEffect(() => {
        const clearPreset = () => setCameraView('free');
        window.addEventListener('camera-view-free', clearPreset);
        return () => window.removeEventListener('camera-view-free', clearPreset);
    }, []);
    useEffect(() => {
        setSaved(p === savedSnapshot.current ? 'Saved locally' : 'Unsaved');
    }, [p]);
    useEffect(() => {
        if (p.motion?.skeleton === 'soma30')
            setLastGeneratedSeed(p.motion.seed);
    }, [p.motion]);
    useEffect(() => {
        for (const selector of ['#animation-timeline', '.right-panel', '.video-panel'])
            document.querySelector(selector)?.toggleAttribute('inert', !!s.preview);
    }, [s.preview]);
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (document.querySelector('.studio.projects-active'))
                return;
            if ((e.target as HTMLElement).closest('input,textarea,select,button,a,[role="button"],[role="dialog"],[contenteditable="true"]'))
                return;
            if (e.code === 'Space') {
                e.preventDefault();
                const state = useStudio.getState();
                if (state.preview) {
                    state.set({ previewPlaying: !state.previewPlaying });
                    return;
                }
                useStudio.getState().set({ playing: !useStudio.getState().playing });
            }
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                useStudio.getState().undo();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);
    async function loadJob(id: string) {
        try {
            const motion = motionSchema.parse(await api('/jobs/' + id + '/motion'));
            motion.generationId = id;
            s.change({
                motion,
                workflow: 'text',
                rootMotion: 'source',
                ...(motion.skeleton === 'soma30' ? { seed: motion.seed } : {}),
                preset: 'motion',
                duration: motion.frames / motion.fps,
                keyframes: [],
                controls: structuredClone(defaults),
                handMode: 'none',
                handReference: null,
            });
            if (motion.skeleton === 'soma30')
                setLastGeneratedSeed(motion.seed);
            s.set({
                time: useStudio
                    .getState()
                    .project.timeline?.strips.find((x) => x.id === useStudio.getState().selectedStrip)
                    ?.start ?? 0,
                playing: true,
            });
            notify(t('Animation added to timeline.'));
        }
        catch (e) {
            notify(String(e));
        }
    }
    useEffect(() => {
        for (const job of jobs) {
            if (job.status === 'completed' && activated.current.has(job.id)) {
                activated.current.delete(job.id);
                void loadJob(job.id);
            }
        }
    }, [jobs]);
    async function generate() {
        if (s.preview)
            return;
        setBusy(true);
        try {
            const seed = lockSeed && lastGeneratedSeed !== null
                ? lastGeneratedSeed
                : randomSeed(lastRequestedSeed.current);
            lastRequestedSeed.current = seed;
            const job = await api('/jobs', {
                method: 'POST',
                body: JSON.stringify({
                    prompt: p.prompt,
                    duration: generationDuration,
                    seed,
                    steps: 30,
                    loop: p.poseReferences.enabled,
                    rootMotion: p.rootMotion,
                    referencePoses: referenceRequest(p.poseReferences),
                }),
            });
            activated.current.add(job.id);
            notify(t('Generating motion with kimodo.cpp…'));
            await refresh();
        }
        catch (e) {
            notify(String(e));
        }
        finally {
            setBusy(false);
        }
    }
    async function save(automatic = false) {
        if (busy || s.preview || saving.current || workArea === 'projects')
            return false;
        saving.current = true;
        setBusy(true);
        try {
            const thumbnail = !s.preview && captureViewport ? captureViewport() : lastThumbnail.current || p.thumbnail;
            lastThumbnail.current = thumbnail;
            const snapshot = { ...p, thumbnail };
            await api('/projects/' + projectId, { method: 'PUT', body: JSON.stringify(snapshot) });
            await refreshProjects();
            savedSnapshot.current = p;
            setSaved(useStudio.getState().project === p ? 'Saved locally' : 'Unsaved');
            if (!automatic)
                notify(t('Project saved.'));
            return true;
        }
        catch (e) {
            notify(String(e));
            return false;
        }
        finally {
            saving.current = false;
            setBusy(false);
        }
    }
    const latestSave = useRef(save);
    latestSave.current = save;
    useEffect(() => {
        if (workArea === 'projects')
            return;
        const timer = setInterval(() => {
            if (useStudio.getState().project !== savedSnapshot.current)
                void latestSave.current(true);
        }, 5 * 60000);
        return () => clearInterval(timer);
    }, [workArea, projectId]);
    async function refreshProjects() {
        setProjectsLoading(true);
        try {
            setLibrary(await api('/projects'));
            setProjectsError('');
        }
        catch (error) {
            setProjectsError(String(error));
        }
        finally {
            setProjectsLoading(false);
        }
    }
    async function executeProjectAction(action: ProjectAction) {
        setBusy(true);
        try {
            if ('projects' in action) {
                setAvatarOnboarding(false);
                setTourOpen(false);
                setTourPending(false);
                const blank = newProject();
                blank.timeline = { ...newTimeline(blank), assets: [], strips: [], tracks: [] };
                s.load(blank);
                savedSnapshot.current = null;
                lastThumbnail.current = null;
                setProjectId(crypto.randomUUID());
                setWorkArea('projects');
                setProjectAction(null);
                setNewProjectRequest(0);
                window.location.hash = 'projects';
                await refreshProjects();
                return;
            }
            let project: Project, id: string;
            if ('id' in action) {
                id = action.id;
                project = projectSchema.parse(await api('/projects/' + id));
            }
            else {
                id = crypto.randomUUID();
                project = { ...newProject(), name: action.name, workflow: action.workflow };
                project.timeline = { ...newTimeline(project), assets: [], strips: [], tracks: [] };
                await api('/projects/' + id, { method: 'PUT', body: JSON.stringify(project) });
            }
            s.load(project);
            lastThumbnail.current = project.thumbnail;
            savedSnapshot.current = useStudio.getState().project;
            setProjectId(id);
            setSaved('Saved locally');
            setLastGeneratedSeed(project.motion?.skeleton === 'soma30' ? project.motion.seed : null);
            setLockSeed(false);
            setWorkArea(project.workflow);
            try {
                const needsAvatar = window.localStorage.getItem('dcl-avatar-onboarded-v1') !== 'done';
                setAvatarOnboarding(needsAvatar);
                setTourPending(!needsAvatar && !studioTourSeen());
            }
            catch {
                setAvatarOnboarding(true);
            }
            window.location.hash = project.workflow === 'video' ? 'video-to-motion' : 'text-to-emote';
            setProjectAction(null);
            await refreshProjects();
        }
        catch (error) {
            notify(String(error));
        }
        finally {
            setBusy(false);
        }
    }
    function requestProjectAction(action: ProjectAction) {
        if (saved === 'Unsaved' && (s.past.length || p.timeline?.strips.length))
            setProjectAction(action);
        else
            void executeProjectAction(action);
    }
    function openProject(id: string) {
        requestProjectAction({ id });
    }
    function createProject(name: string, workflow: 'text' | 'video') {
        requestProjectAction({ name, workflow });
    }
    async function renameProject(id: string, name: string) {
        await api('/projects/' + id, { method: 'PATCH', body: JSON.stringify({ name }) });
        if (id === projectId)
            s.change({ name });
        await refreshProjects();
    }
    async function deleteProject(id: string) {
        await api('/projects/' + id, { method: 'DELETE' });
        if (id === projectId) {
            const project = newProject();
            project.timeline = { ...newTimeline(project), assets: [], strips: [], tracks: [] };
            s.load(project);
            setProjectId(crypto.randomUUID());
            savedSnapshot.current = useStudio.getState().project;
        }
        await refreshProjects();
    }
    async function exportGLB(emote = false) {
        if (!activeRig)
            return;
        setExportAnchor(null);
        setBusy(true);
        s.set({ playing: false });
        try {
            const name = animationName(p.animationName);
            if (name !== p.animationName)
                s.change({ animationName: name });
            const buffer = await activeRig.export({ ...p, animationName: name }, emote);
            download(emote ? 'DCL_Emote.glb' : 'DCL_Avatar_Motion.glb', buffer, 'model/gltf-binary');
            notify(emote
                ? t('Emote baked. Verify acceptance in Decentraland.')
                : t('GLB exported with avatar and animation.'));
        }
        catch (e) {
            notify(String(e));
        }
        finally {
            setBusy(false);
        }
    }
    const selectedColor = activeColor === 'skin' ? p.skinColor : p.hairColor;
    const hsv = rgbToHsv(selectedColor);
    const setColor = (h: number, v: number) => {
        const value = hsvToRgb(h, hsv.s, v);
        s.change(activeColor === 'skin' ? { skinColor: value } : { hairColor: value });
    };
    const loading = jobs.find((j) => j.status === 'running');
    let referencesReady = true;
    try {
        referenceRequest(p.poseReferences);
    }
    catch {
        referencesReady = false;
    }
    return (<div className={'studio' +
            (controlsCollapsed ? ' controls-collapsed' : '') +
            (timelineCollapsed ? ' timeline-collapsed' : '') +
            (workArea === 'projects' ? ' projects-active' : '') +
            (s.preview ? ' has-preview' : '')}>
      <a className="skip-link" href="#editor-workspace">
        {t('Skip to editor')}
      </a>
      <header className="header">
        <div className="header-left">
          {' '}
          <a className="brand" href="/" aria-label={t('Back to home')} style={{ color: 'inherit', textDecoration: 'none' }}>
            <img className="brand-mark" src="/dcl-studio-mark.svg" alt="" aria-hidden="true"/>
            <span>
              DCL <b>MOTION</b>
              <small>STUDIO</small>
            </span>
            <span className="beta">Beta</span>
          </a>
          {workArea !== 'projects' && (<button className="back-projects" disabled={busy || !!loading} onClick={() => setProjectAction({ projects: true })} aria-label={t('Back to projects')} title={t('Back to projects')}>
              <ArrowBackIcon fontSize="small"/>
              <span>{t('Projects')}</span>
            </button>)}
        </div>
        {workArea !== 'projects' ? (<div className="project-name" data-studio-tour="project">
            <input aria-label={t('Project name')} value={p.name} onChange={(e) => s.change({ name: e.target.value })}/>
            <span>{t(p.workflow === 'video' ? 'Video to emote' : 'Text to emote')}</span>
          </div>) : (<div className="library-header-title">{t('Projects')}</div>)}
        <div className="header-actions" data-studio-tour="finish">
          {workArea !== 'projects' && (<>
              {false}
              <button className="settings-trigger" aria-label={t('Save')} title={t('Save')} disabled={busy || !!s.preview} onClick={() => void save()}>
                <SaveOutlinedIcon fontSize="small"/>
              </button>
            </>)}
          <button type="button" className="settings-trigger" aria-label={t('Settings')} title={t('Settings')} aria-haspopup="dialog" aria-expanded={!!settingsAnchor} onClick={(event) => setSettingsAnchor(event.currentTarget)}>
            <SettingsOutlinedIcon fontSize="small"/>
          </button>
          {workArea === 'projects' ? (<Button primary disabled={busy} onClick={() => setNewProjectRequest((n) => n + 1)}>
              {t('New project')}
            </Button>) : (<Button primary disabled={!ready || busy || !!s.preview || !p.timeline?.strips.length} aria-haspopup="dialog" aria-expanded={!!exportAnchor} onClick={(event) => setExportAnchor(event.currentTarget)}>
              <Glyph name="save"/> {t('Export')}
            </Button>)}
        </div>
      </header>
      <Popover open={!!exportAnchor} anchorEl={exportAnchor} onClose={() => setExportAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{
            paper: {
                className: 'studio-settings export-options',
                role: 'dialog',
                'aria-label': t('Export options'),
            },
        }}>
        <label className="settings-field">
          {t('Animation name')}
          <input aria-label={t('Animation name')} value={p.animationName} maxLength={100} onChange={(event) => s.change({ animationName: event.target.value })} onBlur={() => s.change({ animationName: animationName(p.animationName) })}/>
        </label>
        <p className="small subtle">
          {t('Name inside the animation, not the file.')}
          <br />
          {animationName(p.animationName)}
        </p>
        <Button fluid disabled={!ready || busy} onClick={() => exportGLB(true)}>
          {t('Export emote')}
        </Button>
        <p className="small subtle">{t('Rig and animation only · 30 fps · max 10 s · 1 MB')}</p>
        <Button fluid disabled={!ready || busy} onClick={() => exportGLB(false)}>
          {t('Export GLB')}
        </Button>
        <p className="small subtle">{t('Avatar mesh, rig and animation')}</p>
      </Popover>
      <Popover open={!!settingsAnchor} anchorEl={settingsAnchor} onClose={() => setSettingsAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{
            paper: {
                className: 'studio-settings',
                role: 'dialog',
                'aria-labelledby': 'studio-settings-title',
            },
        }}>
        <h2 id="studio-settings-title">{t('Settings')}</h2>
        <label className="settings-field">
          {t('Language')}
          <select aria-label={t('Language')} value={s.locale} onChange={(event) => s.setLocale(event.target.value as Locale)}>
            {languages.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="settings-field">
          {t('Theme')}
          <select aria-label={t('Theme')} value={themeChoice} onChange={(event) => setThemeChoice(event.target.value as 'dark' | 'light')}>
            <option value="dark">{t('Dark')}</option>
            <option value="light">{t('Light')}</option>
          </select>
        </label>
        <button className="custom-avatar-setting" onClick={() => {
            setSettingsAnchor(null);
            setCustomAvatarOpen(true);
        }}>
          <strong>{t('Custom avatar')}</strong>
          <small>{s.customAvatar ? s.customAvatar.name : t('Use a wallet address')}</small>
          <span aria-hidden="true">›</span>
        </button>
        {workArea !== 'projects' && (<button className="custom-avatar-setting" onClick={() => {
                setSettingsAnchor(null);
                setTourPending(true);
            }}>
            <strong>{t('Take a studio tour')}</strong>
            <small>{t('A quick guide to the editor')}</small>
            <span aria-hidden="true">›</span>
          </button>)}
        {(<div className="settings-engine">
            <span className="status-dot"/>
            <div>
              <strong>{t('Kimodo')}</strong>
              <small>
                {health?.engine.configured
                ? t('Kimodo configured')
                : health
                    ? t('Configure kimodo.cpp')
                    : t('Connecting to local service')}
              </small>
            </div>
            <button type="button" onClick={() => {
                if (health)
                    setEngineDraft(health.config);
                setSettingsAnchor(null);
                setEngineOpen(true);
            }}>
              {t('Configure')}
            </button>
          </div>)}
      </Popover>
      {workArea === 'projects' && (<Projects newRequest={newProjectRequest} items={library} loading={projectsLoading} error={projectsError} disabled={!!s.preview || !!loading || busy} onRefresh={() => {
                void refreshProjects();
            }} onOpen={openProject} onCreate={createProject} onRename={renameProject} onDelete={deleteProject}/>)}
      <aside className="left-panel panel" data-studio-tour="create">
        <div id="panel-video" role="tabpanel" aria-label={t('Video to emote')} hidden={workArea !== 'video'}>
          {workArea === 'video' && p.workflow === 'video' && (<VideoPanel key={projectId} projectId={projectId}/>)}
        </div>
        <div id="panel-text" role="tabpanel" aria-label={t('Text to emote')} hidden={workArea !== 'text'}>
          <label className="field-label" htmlFor="prompt">
            {t('Describe the emote')}
          </label>
          <textarea id="prompt" value={p.prompt} onChange={(e) => s.change({ prompt: e.target.value })} maxLength={2000} placeholder={t('A person waves with their hand…')}/>
          <div className="generation-options">
            <label className="field-label">
              {t('Duration')}
              <select aria-label={t('Duration')} value={generationDuration} onChange={(e) => setGenerationDuration(Number(e.target.value))}>
                <option value={1}>1s</option>
                <option value={2}>2s</option>
                <option value={3}>3s</option>
                <option value={4}>4s</option>
              </select>
            </label>
          </div>
          <div className="generation-checks">
            <label className="seed-lock" title={t(lastGeneratedSeed !== null
            ? 'Keep style from last generation'
            : 'Generate an animation first to lock its seed')}>
              <input type="checkbox" checked={lockSeed} disabled={lastGeneratedSeed === null} onChange={(event) => setLockSeed(event.target.checked)}/>
              <span>{t('Keep style')}</span>
            </label>
            <label className="seed-lock" title={t(health?.engine.constraints
            ? 'Uses the start image at both ends, then smooths the loop.'
            : 'Requires the Studio constraints build of Kimodo.')}>
              <input type="checkbox" checked={p.poseReferences.enabled} disabled={!health?.engine.constraints || busy || !!loading} onChange={(event) => s.change({
            poseReferences: { ...p.poseReferences, enabled: event.target.checked },
        })}/>
              <span>{t('Loop animation')}</span>
            </label>
          </div>
          {p.poseReferences.enabled && (<ImagePosePanel value={p.poseReferences} onChange={(poseReferences) => s.change({ poseReferences })} disabled={busy || !!loading} onBusyChange={setAnalyzingPose}/>)}
          <Button primary fluid disabled={!ready ||
            !health?.engine.configured ||
            busy ||
            !!loading ||
            analyzingPose ||
            !referencesReady ||
            !!s.preview ||
            (p.poseReferences.enabled && !health?.engine.constraints)} loading={!!loading} onClick={generate}>
            <Glyph name="spark"/> {loading ? t('Generating…') : t('Generate animation')}
          </Button>
          {loading && (<p role="status">
              {t('Generating…')}
            </p>)}
          {loading && (<Button basic fluid onClick={async () => {
                await api('/jobs/' + loading.id + '/cancel', { method: 'POST' });
                await refresh();
            }}>
              {t('Cancel generation')}
            </Button>)}
        </div>
      </aside>
      <main id="editor-workspace" className="workspace" tabIndex={-1}>
        <div className="viewport-wrap" data-studio-tour="avatar">
          <Viewport cameraMode={cameraMode} onReady={() => setReady(true)} onDiagnostics={setDiagnostics}/>
          {avatarOnboarding && (<AvatarOnboarding onComplete={() => {
                try {
                    window.localStorage.setItem('dcl-avatar-onboarded-v1', 'done');
                }
                catch {
                    /* private browsing */
                }
                setAvatarOnboarding(false);
                if (!studioTourSeen())
                    setTourPending(true);
            }}/>)}
          <div className="view-top">
            <div className="view-left" data-studio-tour="views">
              <div className="camera-switch viewport-control-row" role="group" aria-label={t('Camera views')}>
                <button className={cameraMode === 'single' ? 'active' : ''} title={t('One camera')} aria-label={t('One camera')} aria-pressed={cameraMode === 'single'} onClick={() => setCameraMode('single')}>
                  <span className="camera-icon camera-icon-single"/>
                </button>
                <button className={cameraMode === 'dual' ? 'active' : ''} title={t('Two cameras')} aria-label={t('Two cameras')} aria-pressed={cameraMode === 'dual'} onClick={() => setCameraMode('dual')}>
                  <span className="camera-icon camera-icon-dual"/>
                </button>
              </div>
              <div className="appearance-menu viewport-control-row" ref={colorDock} role="group" aria-label={t('Customize avatar')}>
                {(['skin', 'hair'] as const).map((color) => (<button key={color} className={'color-swatch ' + (activeColor === color ? 'active' : '')} style={{
                backgroundColor: colorHex(s.customAvatar
                    ? s.customAvatar[color]
                    : color === 'skin'
                        ? p.skinColor
                        : p.hairColor),
            }} data-tooltip={t(color === 'skin' ? 'Skin' : 'Hair')} title={t(s.customAvatar
                ? 'Colors from wallet profile'
                : color === 'skin'
                    ? 'Skin'
                    : 'Hair')} disabled={!!s.customAvatar} aria-label={t(color === 'skin' ? 'Skin' : 'Hair')} aria-expanded={activeColor === color} onClick={() => setActiveColor(activeColor === color ? null : color)}/>))}
                {activeColor && !s.customAvatar && (<div className="color-popover" role="group" aria-label={t(activeColor === 'skin' ? 'Skin color' : 'Hair color')}>
                    <input className="hue-strip" type="range" min={0} max={359} step={1} value={Math.round(hsv.h)} aria-label={t(activeColor === 'skin' ? 'Skin hue' : 'Hair hue')} onChange={(event) => setColor(Number(event.target.value), hsv.v)}/>
                    <input className="brightness-strip" type="range" min={0.05} max={1} step={0.005} value={hsv.v} style={{
                background: `linear-gradient(to top, #09090b, ${colorHex(hsvToRgb(hsv.h, hsv.s, 1))})`,
            }} aria-label={t(activeColor === 'skin' ? 'Skin brightness' : 'Hair brightness')} onChange={(event) => setColor(hsv.h, Number(event.target.value))}/>
                  </div>)}
              </div>
              <div className="view-tools viewport-control-row" role="group" aria-label={t('Bones and controls')}>
                <button className={s.skeleton ? 'active' : ''} aria-pressed={s.skeleton} onClick={() => s.set({ skeleton: !s.skeleton })}>
                  {t('Bones')}
                </button>
                <button className={s.handles ? 'active' : ''} aria-pressed={s.handles} onClick={() => s.set({ handles: !s.handles })}>
                  {t('Controls')}
                </button>
              </div>
              <div className="view-tools viewport-control-row motion-space-tools" role="group" aria-label={t('Motion mode')}>
                <button className={p.rootMotion === 'inPlace' ? 'active' : ''} aria-label={t('In place (game ready)')} title={t('Keeps turns and jumps, without moving across the floor.')} aria-pressed={p.rootMotion === 'inPlace'} onClick={() => s.change({ rootMotion: 'inPlace' })}>
                  {t('In place')}
                </button>
                <button className={p.rootMotion === 'source' ? 'active' : ''} aria-label={t('Source movement')} title={t('Keeps the approximate trajectory and turns captured from video or generated by Kimodo.')} aria-pressed={p.rootMotion === 'source'} onClick={() => s.change({ rootMotion: 'source' })}>
                  {t('Source')}
                </button>
              </div>
            </div>
          </div>
          {!ready && (<div className="loading-overlay">
              <span className="spinner"/> {t('Loading avatar…')}
            </div>)}
          <div className="view-bottom">
            <span className="view-caption">
              {t('PERSPECTIVE')} <span>·</span> {t('FLOOR')} 0.00 m
            </span>
            <div className="contacts">
              <span className={diagnostics?.left ? 'supported' : ''}>● {t('Left foot')}</span>
              <span className={diagnostics?.right ? 'supported' : ''}>● {t('Right foot')}</span>
            </div>
          </div>
          <div className="navigation-hint">{t('Drag to orbit · Wheel to zoom')}</div>
        </div>
        <div id="animation-timeline" className="timeline-shell" data-studio-tour="timeline">
          <Timeline ready={ready} collapsed={timelineCollapsed} onCollapse={() => setTimelineCollapsed((value) => !value)}/>
        </div>
      </main>
      <AvatarControls collapsed={controlsCollapsed} onCollapse={() => setControlsCollapsed(!controlsCollapsed)}/>
      {tourOpen && workArea !== 'projects' && (<StudioTour workflow={p.workflow} onClose={() => setTourOpen(false)}/>)}

      {s.message && (<div role="status" className="toast">
          {s.message}
          <button aria-label={t('Close notification')} onClick={() => s.set({ message: '' })}>
            ×
          </button>
        </div>)}
      <Modal open={!!projectAction} onClose={() => !busy && setProjectAction(null)}>
        <Modal.Header>{t('Unsaved changes')}</Modal.Header>
        <Modal.Content>
          <p>{t('Save your current project before switching?')}</p>
        </Modal.Content>
        <Modal.Actions>
          <Button disabled={busy} onClick={() => setProjectAction(null)}>
            {t('Cancel')}
          </Button>
          <Button disabled={busy} onClick={() => projectAction && executeProjectAction(projectAction)}>
            {t('Discard changes')}
          </Button>
          <Button primary disabled={busy} onClick={async () => {
            if ((await save()) && projectAction)
                await executeProjectAction(projectAction);
        }}>
            {t('Save and continue')}
          </Button>
        </Modal.Actions>
      </Modal>
      <CustomAvatarSettings open={customAvatarOpen} onClose={() => setCustomAvatarOpen(false)}/>
      <Modal open={engineOpen} onClose={() => setEngineOpen(false)} size="small">
        <Modal.Header>{t('Configure kimodo.cpp engine')}</Modal.Header>
        <Modal.Content>
          <p>
            {t('Connect a local kimodo.cpp installation with the SOMA-RP-v1.1 model and its text encoder. The source package does not include the weights.')}
          </p>
          <div className="engine-fields">
            {[
            ['executable', t('Executable kmd-generate'), 'C:/…/kmd-generate.exe'],
            ['model', t('SOMA model (.gguf)'), 'C:/…/kimodo-soma-rp-v1.1-f32.gguf'],
            ['text', t('Text encoder (.gguf or folder)'), 'C:/…/llm2vec-text-bundle'],
        ].map(([k, label, placeholder]) => (<label key={k}>
                {label}
                <input value={engineDraft[k as 'executable' | 'model' | 'text']} placeholder={placeholder} onChange={(e) => setEngineDraft({ ...engineDraft, [k]: e.target.value })}/>
              </label>))}
            <label>
              {t('Device')}
              <select value={engineDraft.device} onChange={(e) => setEngineDraft({ ...engineDraft, device: e.target.value as 'cpu' | 'vulkan' })}>
                <option value="vulkan">GPU · Vulkan</option>
                <option value="cpu">CPU</option>
              </select>
            </label>
          </div>
          <p className="small subtle">
            {t('File presence does not guarantee the model will load. Runtime errors appear in history.')}
          </p>
          <section aria-label="Studio Constraints">
            <h3>Studio Constraints</h3>
            <p className="small subtle">
              {t('Check the local engine for pose, path and loop constraints.')}
            </p>
            {constraintsCheck && (<div role="status" className="small">
                {t({
                ready: 'Studio Constraints is ready.',
                unsupported: 'This build does not support Studio Constraints.',
                unavailable: 'Windows could not run Studio Constraints. Check application-control approval and required runtime files.',
                missing: 'Studio Constraints is not installed.',
            }[constraintsCheck.status])}
                {constraintsCheck.status === 'unavailable' && (<details>
                    <summary>{t('Technical details')}</summary>
                    <p style={{ overflowWrap: 'anywhere' }}>{constraintsCheck.executable}</p>
                    <p style={{ overflowWrap: 'anywhere' }}>{constraintsCheck.detail}</p>
                  </details>)}
              </div>)}
            <Button disabled={checkingConstraints || !!loading} onClick={async () => {
            setCheckingConstraints(true);
            try {
                setConstraintsCheck(await api('/engine/check-constraints', { method: 'POST', body: '{}' }));
            }
            catch (e) {
                notify(String(e));
            }
            finally {
                setCheckingConstraints(false);
            }
        }}>
              {t(checkingConstraints ? 'Checking…' : 'Check installation')}
            </Button>
            {constraintsCheck?.status === 'ready' && (<Button disabled={checkingConstraints || !!loading} onClick={async () => {
                setCheckingConstraints(true);
                try {
                    const result = await api('/engine/use-constraints', {
                        method: 'POST',
                        body: '{}',
                    });
                    setEngineDraft(result.config);
                    await refresh();
                    notify(t('Studio Constraints activated.'));
                }
                catch (e) {
                    setConstraintsCheck(null);
                    notify(String(e));
                }
                finally {
                    setCheckingConstraints(false);
                }
            }}>
                {t('Use Studio Constraints')}
              </Button>)}
          </section>
        </Modal.Content>
        <Modal.Actions>
          <Button onClick={() => setEngineOpen(false)}>{t('Close')}</Button>
          <Button primary onClick={async () => {
            try {
                await api('/engine', { method: 'PUT', body: JSON.stringify(engineDraft) });
                await refresh();
                notify(t('Configuration saved.'));
                setEngineOpen(false);
            }
            catch (e) {
                notify(String(e));
            }
        }}>
            {t('Save configuration')}
          </Button>
        </Modal.Actions>
      </Modal>
    </div>);
}
