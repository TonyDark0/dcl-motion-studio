import { useEffect, useRef, useState } from 'react';
import { useStudio } from './store';
import { useT } from './i18n';
import { comparisonAt } from './video-comparison';
export function ReferenceVideoView() {
    const project = useStudio((s) => s.project), selected = useStudio((s) => s.selectedStrip), time = useStudio((s) => s.time), playing = useStudio((s) => s.playing);
    const clip = comparisonAt(project, selected, time), video = useRef<HTMLVideoElement>(null), t = useT();
    const [ready, setReady] = useState(''), [failed, setFailed] = useState('');
    useEffect(() => {
        const element = video.current;
        if (!element || !clip || ready !== clip.id)
            return;
        const sync = () => {
            element.playbackRate = clip.speed;
            if (!element.seeking && Math.abs(element.currentTime - clip.time) > (playing ? 0.12 : 0.001))
                element.currentTime = clip.time;
            if (playing) {
                if (element.paused)
                    void element.play().catch(() => { });
            }
            else
                element.pause();
        };
        sync();
        // A seek can be clamped while the browser is still loading its first range.
        // Retry against the unchanged paused timeline once the data arrives.
        const timer = playing ? undefined : setInterval(sync, 100);
        return () => clearInterval(timer);
    }, [clip?.id, clip?.time, clip?.speed, playing, ready]);
    return (<div className="reference-video-view">
      {clip ? (<>
          <video key={clip.id} ref={video} src={`/api/jobs/${clip.id}/reference-video`} muted playsInline preload="auto" aria-label={t('Timeline reference video')} onLoadedData={() => setReady(clip.id)} onError={() => setFailed(clip.id)}/>
          <span className="reference-video-caption">{clip.name.replace(/^Hands · /, '')}</span>
          {failed === clip.id && (<p className="reference-video-empty">{t('The reference video is unavailable.')}</p>)}
        </>) : (<p className="reference-video-empty">
          {t('Play a video emote to compare it with its reference.')}
        </p>)}
    </div>);
}
