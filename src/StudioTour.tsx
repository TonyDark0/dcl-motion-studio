import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from './i18n';
import './studio-tour.css';
type Step = {
    target: string;
    title: string;
    copy: string;
};
type Bounds = {
    left: number;
    top: number;
    width: number;
    height: number;
};
export const STUDIO_TOUR_KEY = 'dcl-studio-tour-v1';
export function studioTourSeen() {
    try {
        return localStorage.getItem(STUDIO_TOUR_KEY) === 'done';
    }
    catch {
        return false;
    }
}
export function StudioTour({ workflow, onClose, }: {
    workflow: 'text' | 'video';
    onClose: () => void;
}) {
    const t = useT();
    const [index, setIndex] = useState(0);
    const [highlight, setHighlight] = useState<Bounds | null>(null);
    const [position, setPosition] = useState({ left: 16, top: 16 });
    const dialog = useRef<HTMLElement>(null);
    const title = useRef<HTMLHeadingElement>(null);
    const steps: Step[] = [
        {
            target: 'avatar',
            title: 'Meet your avatar',
            copy: 'This is your preview space. Drag to look around and scroll to move closer. Your chosen avatar is for preview; your emote can be used with other Decentraland avatars too.',
        },
        workflow === 'text'
            ? {
                target: 'create',
                title: 'Start with an idea',
                copy: 'Describe the movement you want, choose its duration, then generate your emote. Be specific about the action. For a loop, enable Loop animation and add a starting pose reference.',
            }
            : {
                target: 'create',
                title: 'Bring your movement',
                copy: 'Choose Fast for a quicker capture or Pro for more detail. Select a video, trim the part you want, then review the tracking. You can correct points before accepting and generating your emote. Afterward, use this panel to smooth the body and hands.',
            },
        {
            target: 'views',
            title: 'Choose your view',
            copy: 'Switch between one or two views, and show the bones or movement controls when you need them. Source keeps the original travel. In place stays in one spot while keeping turns and jumps. In video projects, the second view can show your reference video.',
        },
        {
            target: 'playback',
            title: 'Preview the movement',
            copy: 'Play, pause, or return to the start here. Loop playback repeats the timeline so you can check the transition between the end and the beginning. It repeats your animation; it does not create a seamless loop by itself.',
        },
        {
            target: 'timeline',
            title: 'Build your timeline',
            copy: 'Your generated clips appear here. Body and hands use separate layers. Move or trim a clip, duplicate it, split it, or remove it. Use + Hands to add a hand pose template. The timeline is empty until you add your first animation.',
        },
        {
            target: 'adjust',
            title: 'Make small adjustments',
            copy: 'Choose a hand or foot and adjust its position or angle. Body and balance controls help refine the pose. You can reset these changes at any time. Expand this panel if the controls are hidden.',
        },
        {
            target: 'project',
            title: 'Keep your project organized',
            copy: 'Name your project here. Its creation mode stays below the name. The back arrow takes you to Projects and asks about saving changes before you leave.',
        },
        {
            target: 'finish',
            title: 'Save, customize and export',
            copy: 'Save keeps your editable project, with an automatic save every five minutes. Settings lets you change your avatar and replay this tour. When your emote is ready, Export emote downloads the rig and animation for Decentraland. A full GLB uses the studio’s default avatar.',
        },
    ];
    const step = steps[index];
    useLayoutEffect(() => {
        const studio = document.querySelector<HTMLElement>('.studio');
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const wasInert = studio?.inert;
        if (studio)
            studio.inert = true;
        return () => {
            if (studio)
                studio.inert = !!wasInert;
            const fallback = document.querySelector<HTMLElement>('[data-studio-tour="finish"] button');
            (previouslyFocused?.isConnected ? previouslyFocused : fallback)?.focus({
                preventScroll: true,
            });
        };
    }, []);
    useLayoutEffect(() => {
        const requested = document.querySelector<HTMLElement>(`[data-studio-tour="${step.target}"]`);
        const element = requested?.getClientRects().length
            ? requested
            : document.querySelector<HTMLElement>('.header');
        element?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        title.current?.focus({ preventScroll: true });
        let raf = 0;
        const measure = () => {
            if (!dialog.current)
                return;
            const screenWidth = document.documentElement.clientWidth, screenHeight = window.innerHeight;
            const rect = element?.getBoundingClientRect();
            const left = Math.max(4, (rect?.left || 0) - 6), top = Math.max(4, (rect?.top || 0) - 6);
            const right = Math.min(screenWidth - 4, (rect?.right || 0) + 6), bottom = Math.min(screenHeight - 4, (rect?.bottom || 0) + 6);
            const bounds = rect && right > left && bottom > top
                ? { left, top, width: right - left, height: bottom - top }
                : null;
            setHighlight(bounds);
            const card = dialog.current.getBoundingClientRect();
            const gap = 20;
            let x = (screenWidth - card.width) / 2, y = (screenHeight - card.height) / 2;
            if (bounds) {
                if (right + gap + card.width <= screenWidth - 16) {
                    x = right + gap;
                    y = top;
                }
                else if (left - gap - card.width >= 16) {
                    x = left - gap - card.width;
                    y = top;
                }
                else if (bottom + gap + card.height <= screenHeight - 16) {
                    x = left;
                    y = bottom + gap;
                }
                else if (top - gap - card.height >= 16) {
                    x = left;
                    y = top - gap - card.height;
                }
                else {
                    x = right - card.width - 16;
                    y = bottom - card.height - 16;
                }
            }
            setPosition({
                left: Math.max(16, Math.min(screenWidth - card.width - 16, x)),
                top: Math.max(16, Math.min(screenHeight - card.height - 16, y)),
            });
        };
        const schedule = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(measure);
        };
        const observer = new ResizeObserver(schedule);
        if (element)
            observer.observe(element);
        if (dialog.current)
            observer.observe(dialog.current);
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, true);
        measure();
        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule, true);
        };
    }, [index, step.target]);
    function close() {
        try {
            localStorage.setItem(STUDIO_TOUR_KEY, 'done');
        }
        catch {
            /* Private browsing. */
        }
        onClose();
    }
    return createPortal(<div className="studio-tour-overlay">
      <svg className="studio-tour-shade" width="100%" height="100%" aria-hidden="true">
        <defs>
          <mask id="studio-tour-cutout">
            <rect width="100%" height="100%" fill="white"/>
            {highlight && (<rect width={highlight.width} height={highlight.height} x={highlight.left} y={highlight.top} rx="12" fill="black"/>)}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="#08060eb8" mask="url(#studio-tour-cutout)"/>
        {highlight && (<rect x={highlight.left} y={highlight.top} width={highlight.width} height={highlight.height} rx="12" fill="none" stroke="#ff7199" strokeWidth="2"/>)}
      </svg>
      <section className="studio-tour-card" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="studio-tour-title" aria-describedby="studio-tour-description" style={position} onKeyDown={(event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
            }
            if (event.key === 'Tab') {
                const buttons = Array.from(dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                const first = buttons[0], last = buttons.at(-1)!;
                if (event.shiftKey &&
                    (document.activeElement === first || document.activeElement === title.current)) {
                    event.preventDefault();
                    last.focus();
                }
                else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        }}>
        <div className="studio-tour-top">
          <span>
            {t('STUDIO TOUR')} · {index + 1} / {steps.length}
          </span>
          <button type="button" onClick={close}>
            {t('Skip tutorial')}
          </button>
        </div>
        <h2 ref={title} tabIndex={-1} id="studio-tour-title">
          {t(step.title)}
        </h2>
        <p id="studio-tour-description">
          {t(step.copy)}
          {false}
        </p>
        <div className="studio-tour-progress" aria-hidden="true">
          {steps.map((_, i) => (<i key={i} className={i <= index ? 'active' : ''}/>))}
        </div>
        <div className="studio-tour-actions">
          <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            {t('Back')}
          </button>
          <button type="button" className="studio-tour-next" onClick={() => (index === steps.length - 1 ? close() : setIndex(index + 1))}>
            {t(index === steps.length - 1 ? 'Start creating' : 'Next')}{' '}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
    </div>, document.body);
}
