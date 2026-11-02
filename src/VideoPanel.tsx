import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal } from './ui';
import LinearProgress from '@mui/material/LinearProgress';
import { containedVideo } from './video-review-layout';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { cameraCalibrationSchema, compileCapture, samFrameSchema, type CameraCalibration, type Capture, type Observation, type SamFrame, } from './video-motion';
import { defaults } from './motion';
import { useStudio } from './store';
import { useT } from './i18n';
import { generateFromVideo } from './video-generation';
import { videoPoseConstraints, VideoTrackingError } from './video-pose-constraints';
import { REFERENCE_POSE_STRIDE } from './pose-sampling';
import { prepareTrackingVideo } from './video-media';
import { samObservation } from './sam-observation';
import { visionRequest } from './vision-request';
import { CAPTURE_DETAIL, REVIEW_BODY, unpackPoints } from './capture-landmarks';
import { VideoResultPanel } from './VideoResultPanel';
import { elapsedLabel } from './video-result';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import LastPageIcon from '@mui/icons-material/LastPage';
import UndoIcon from '@mui/icons-material/Undo';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
type CaptureMode = 'fast' | 'pro';
const maxCaptureSeconds = 10;
type PointId = `body:${number}` | `detail:${number}`;
type Review = {
    observations: Observation[];
    duration: number;
    reference: Blob;
    captureMs: number;
};
type Drag = {
    id: PointId;
    frame: number;
    x: number;
    y: number;
    original: Observation;
};
const BODY_LINKS = [
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [11, 23],
    [12, 24],
    [23, 24],
    [23, 25],
    [25, 27],
    [27, 29],
    [29, 31],
    [24, 26],
    [26, 28],
    [28, 30],
    [30, 32],
];
const HAND_LINKS = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [0, 5],
    [5, 6],
    [6, 7],
    [7, 8],
    [0, 9],
    [9, 10],
    [10, 11],
    [11, 12],
    [0, 13],
    [13, 14],
    [14, 15],
    [15, 16],
    [0, 17],
    [17, 18],
    [18, 19],
    [19, 20],
];
function base64(bytes: Uint8Array) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192)
        text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
}
async function trackFrame(rgb: Uint8Array, signal: AbortSignal, onReconnect?: () => void) {
    const detail = await visionRequest<{
        points: number[];
        layout?: string;
    }>('frame', { rgb: base64(rgb), bodyHands: true }, signal, onReconnect);
    if (detail.layout === 'body-hands-v1' && detail.points?.length === CAPTURE_DETAIL.length * 4)
        return unpackPoints(detail.points, CAPTURE_DETAIL, 133);
    if (!Array.isArray(detail.points) || detail.points.length !== 133 * 4)
        throw Error('Tracking returned incomplete data.');
    return detail.points;
}
function jpegFrame(video: HTMLVideoElement, maxSide = 960) {
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { jpeg: canvas.toDataURL('image/jpeg', 0.9).split(',')[1], scale };
}
async function calibrateFrame(frame: ReturnType<typeof jpegFrame>, signal: AbortSignal, onReconnect?: () => void) {
    const data = await visionRequest<CameraCalibration>('calibrate', { jpeg: frame.jpeg }, signal, onReconnect);
    return cameraCalibrationSchema.parse(data);
}
async function trackProFrame(frame: ReturnType<typeof jpegFrame>, crop: [
    number,
    number,
    number,
    number
], calibration: CameraCalibration, signal: AbortSignal, onReconnect?: () => void) {
    const bbox = crop.map((n) => n * frame.scale) as [
        number,
        number,
        number,
        number
    ];
    const data = await visionRequest<SamFrame>('pro-frame', { jpeg: frame.jpeg, bbox, calibration }, signal, onReconnect);
    return samFrameSchema.parse(data);
}
function copyObservation(value: Observation): Observation {
    return {
        ...value,
        ...(value.corrected
            ? { corrected: { body: [...value.corrected.body], detail: [...value.corrected.detail] } }
            : {}),
        body: [...value.body],
        detail: [...value.detail],
        ...(value.normalized ? { normalized: [...value.normalized] } : {}),
        ...(value.crop ? { crop: [...value.crop] as [
                number,
                number,
                number,
                number
            ] } : {}),
        ...(value.sam
            ? {
                sam: {
                    ...value.sam,
                    keypoints3d: [...value.sam.keypoints3d],
                    keypoints2d: [...value.sam.keypoints2d],
                    ...(value.sam.cameraTranslation
                        ? { cameraTranslation: [...value.sam.cameraTranslation] }
                        : {}),
                },
            }
            : {}),
    };
}
function nearestFrame(observations: Observation[], time: number) {
    let best = 0, distance = Infinity;
    observations.forEach((o, i) => {
        const d = Math.abs(o.time - time);
        if (d < distance) {
            best = i;
            distance = d;
        }
    });
    return best;
}
function scoreColor(score: number, corrected = false) {
    if (corrected)
        return '#62b8ff';
    return score >= 0.55 ? '#68ddbf' : score >= 0.25 ? '#ffc857' : '#ff647c';
}
function detailNormalized(o: Observation, joint: number, width: number, height: number) {
    if (!o.crop)
        return null;
    const [x, y, w, h] = o.crop, p = joint * 4;
    return {
        x: (x + (o.detail[p] / 288) * w) / width,
        y: (y + (o.detail[p + 1] / 384) * h) / height,
        score: o.detail[p + 3] || 0,
    };
}
function applyDelta(o: Observation, id: PointId, dx: number, dy: number, width: number, height: number) {
    const [kind, text] = id.split(':') as [
        'body' | 'detail',
        string
    ], joint = Number(text);
    if (kind === 'body' && o.normalized) {
        o.normalized[joint * 4] += dx;
        o.normalized[joint * 4 + 1] += dy;
        o.body[joint * 4] += dx * 1.7;
        o.body[joint * 4 + 1] += dy * 1.7;
        o.body[joint * 4 + 3] = 1;
        o.normalized[joint * 4 + 3] = 1;
    }
    else if (kind === 'detail' && o.crop) {
        const [cx, cy, cw, ch] = o.crop, p = joint * 4;
        const x = cx + (o.detail[p] / 288) * cw + dx * width, y = cy + (o.detail[p + 1] / 384) * ch + dy * height;
        o.detail[p] = ((x - cx) / cw) * 288;
        o.detail[p + 1] = ((y - cy) / ch) * 384;
        o.detail[p + 3] = 1;
    }
    o.corrected ||= { body: [], detail: [] };
    if (!o.corrected[kind].includes(joint))
        o.corrected[kind].push(joint);
}
export function VideoPanel({ projectId }: {
    projectId: string;
}) {
    const currentProjectId = useRef(projectId);
    currentProjectId.current = projectId;
    const studio = useStudio(), video = useRef<HTMLVideoElement>(null), canvas = useRef<HTMLCanvasElement>(null), captureCanvas = useRef<HTMLCanvasElement>(null), input = useRef<HTMLInputElement>(null), drag = useRef<Drag | null>(null);
    const t = useT();
    const detector = useRef<PoseLandmarker | null>(null), controller = useRef<AbortController | null>(null);
    const [open, setOpen] = useState(false);
    const [overlay, setOverlay] = useState(true);
    const [videoPlaying, setVideoPlaying] = useState(false);
    const [progressValue, setProgressValue] = useState<number | null>(null);
    const [mode, setMode] = useState<CaptureMode>('fast');
    const [file, setFile] = useState<File | null>(null), [url, setUrl] = useState(''), [length, setLength] = useState(0);
    const [start, setStart] = useState(0), [duration, setDuration] = useState(3), [running, setRunning] = useState(false), [generating, setGenerating] = useState(false);
    const [progress, setProgress] = useState(''), [available, setAvailable] = useState(false), [proAvailable, setProAvailable] = useState(false), [error, setError] = useState('');
    const [review, setReview] = useState<Review | null>(null), [frame, setFrame] = useState(0);
    const [validation, setValidation] = useState<{
        review: Review;
        file: File;
        capture?: Capture;
        error?: string;
        issue?: VideoTrackingError;
    } | null>(null);
    // Debounce edits without ever allowing a stale validation to enable submission.
    useEffect(() => {
        if (!review || !file)
            return;
        const timer = setTimeout(() => {
            try {
                const capture = compileCapture(review.observations, review.duration, file.name);
                capture.metadata.poseStride = REFERENCE_POSE_STRIDE;
                capture.metadata.captureMs = review.captureMs;
                videoPoseConstraints(capture, capture.frames);
                setValidation({ review, file, capture });
            }
            catch (error) {
                setValidation({
                    review,
                    file,
                    error: error instanceof Error ? error.message : String(error),
                    issue: error instanceof VideoTrackingError ? error : undefined,
                });
            }
        }, 150);
        return () => clearTimeout(timer);
    }, [review, file]);
    const checked = validation?.review === review && validation?.file === file ? validation : null;
    const [selected, setSelected] = useState<PointId | null>(null), [edited, setEdited] = useState(new Set<string>());
    const [lastDelta, setLastDelta] = useState<{
        id: PointId;
        frame: number;
        dx: number;
        dy: number;
    } | null>(null);
    const [range, setRange] = useState(1);
    const [reviewZoom, setReviewZoom] = useState(1);
    const [reviewPan, setReviewPan] = useState({ x: 0, y: 0 });
    const panDrag = useRef<{
        x: number;
        y: number;
        origin: {
            x: number;
            y: number;
        };
    } | null>(null);
    const zoomStage = useRef<HTMLDivElement>(null);
    function changeZoom(value: number, pointer?: {
        x: number;
        y: number;
    }) {
        const zoom = Math.max(1, Math.min(4, value));
        setReviewZoom(zoom);
        if (zoom === 1) {
            setReviewPan({ x: 0, y: 0 });
        }
        else {
            const rect = zoomStage.current?.getBoundingClientRect();
            if (rect)
                setReviewPan((p) => {
                    const ratio = zoom / reviewZoom;
                    const x = pointer ? pointer.x - rect.left - rect.width / 2 : 0;
                    const y = pointer ? pointer.y - rect.top - rect.height / 2 : 0;
                    return {
                        x: Math.max((-rect.width * (zoom - 1)) / 2, Math.min((rect.width * (zoom - 1)) / 2, x - (x - p.x) * ratio)),
                        y: Math.max((-rect.height * (zoom - 1)) / 2, Math.min((rect.height * (zoom - 1)) / 2, y - (y - p.y) * ratio)),
                    };
                });
        }
    }
    useEffect(() => {
        const stage = zoomStage.current;
        if (!stage || !review)
            return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            if (running)
                return;
            const delta = event.deltaY *
                (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
            changeZoom(reviewZoom * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002), {
                x: event.clientX,
                y: event.clientY,
            });
        };
        stage.addEventListener('wheel', wheel, { passive: false });
        return () => stage.removeEventListener('wheel', wheel);
    }, [review, reviewZoom, running]);
    const [pointGroup, setPointGroup] = useState<'all' | 'body' | 'hands'>('all');
    const [elapsed, setElapsed] = useState(0);
    const phaseStarted = useRef(0);
    const originalReview = useRef<Observation[]>([]);
    const correctionHistory = useRef<Array<{
        observations: Observation[];
        edited: Set<string>;
    }>>([]);
    const [canUndoCorrection, setCanUndoCorrection] = useState(false);
    useEffect(() => {
        if (!running)
            return;
        const update = () => setElapsed(performance.now() - phaseStarted.current);
        update();
        const timer = setInterval(update, 500);
        return () => clearInterval(timer);
    }, [running]);
    const activeMode: CaptureMode = mode;
    useEffect(() => {
        fetch('/api/video/status')
            .then((r) => r.json())
            .then((s) => {
            setAvailable(s.available);
            setProAvailable(!!s.pro?.samAvailable && !!s.pro?.mogeAvailable && !!s.pro?.runtime);
        })
            .catch(() => { });
        return () => {
            controller.current?.abort();
            detector.current?.close();
        };
    }, []);
    useEffect(() => () => {
        if (url)
            URL.revokeObjectURL(url);
    }, [url]);
    const issueFrames = useMemo(() => review
        ? review.observations
            .map((o, i) => {
            const bodyLow = REVIEW_BODY.filter((j) => (o.body[j * 4 + 3] || 0) < 0.35).length;
            const handsLow = Array.from({ length: 42 }, (_, j) => j + 91).filter((j) => (o.detail[j * 4 + 3] || 0) < 0.25).length;
            // A single essential joint can block generation; never show its
            // missing raw evidence as an entirely reliable review frame.
            return bodyLow > 0 || handsLow > 6 ? i : -1;
        })
            .filter((i) => i >= 0)
        : [], [review]);
    const draw = useCallback(() => {
        if (!review || !video.current || !canvas.current)
            return;
        const element = video.current, surface = canvas.current, rect = surface.getBoundingClientRect(), dpr = devicePixelRatio || 1;
        if (surface.width !== Math.round(rect.width * dpr) ||
            surface.height !== Math.round(rect.height * dpr)) {
            surface.width = Math.round(rect.width * dpr);
            surface.height = Math.round(rect.height * dpr);
        }
        const ctx = surface.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);
        const fit = containedVideo(element.videoWidth, element.videoHeight, rect.width, rect.height);
        ctx.setTransform(dpr, 0, 0, dpr, dpr * fit.left, dpr * fit.top);
        const index = nearestFrame(review.observations, Math.max(0, element.currentTime - start)), o = review.observations[index];
        const corrected = (id: PointId) => edited.has(`${index}:${id}`);
        const body = (j: number) => o.normalized
            ? {
                x: o.normalized[j * 4],
                y: o.normalized[j * 4 + 1],
                score: o.normalized[j * 4 + 3] || 0,
            }
            : null;
        const detail = (j: number) => detailNormalized(o, j, element.videoWidth, element.videoHeight);
        const line = (a: {
            x: number;
            y: number;
            score: number;
        } | null, b: {
            x: number;
            y: number;
            score: number;
        } | null, color = '#7890a3') => {
            if (!a || !b)
                return;
            ctx.strokeStyle = color;
            ctx.globalAlpha = Math.max(0.25, Math.min(a.score, b.score));
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(a.x * fit.width, a.y * fit.height);
            ctx.lineTo(b.x * fit.width, b.y * fit.height);
            ctx.stroke();
            ctx.globalAlpha = 1;
        };
        if (pointGroup !== 'hands')
            BODY_LINKS.forEach(([a, b]) => line(body(a), body(b)));
        if (pointGroup !== 'body')
            for (const offset of [91, 112])
                HAND_LINKS.forEach(([a, b]) => line(detail(offset + a), detail(offset + b), '#b17bcb'));
        [
            [17, 18],
            [18, 19],
            [20, 21],
            [21, 22],
        ].forEach(([a, b]) => {
            if (pointGroup !== 'hands')
                line(detail(a), detail(b), '#d09c64');
        });
        if (pointGroup !== 'hands')
            for (const j of REVIEW_BODY) {
                const p = body(j);
                if (!p)
                    continue;
                const id = `body:${j}` as PointId;
                ctx.fillStyle = scoreColor(p.score, corrected(id));
                ctx.beginPath();
                ctx.arc(p.x * fit.width, p.y * fit.height, selected === id ? 5 : 3, 0, Math.PI * 2);
                ctx.fill();
            }
        const detailIds = Array.from({ length: 42 }, (_, j) => 91 + j).concat([17, 18, 19, 20, 21, 22]);
        detailIds.forEach((j) => {
            if ((pointGroup === 'body' && j >= 91) || (pointGroup === 'hands' && j < 91))
                return;
            const p = detail(j);
            if (!p)
                return;
            const id = `detail:${j}` as PointId;
            ctx.fillStyle = scoreColor(p.score, corrected(id));
            ctx.beginPath();
            ctx.arc(p.x * fit.width, p.y * fit.height, selected === id ? 5 : 3, 0, Math.PI * 2);
            ctx.fill();
        });
        const other = captureCanvas.current;
        if (other) {
            const size = other.getBoundingClientRect(), target = containedVideo(element.videoWidth, element.videoHeight, size.width, size.height);
            if (other.width !== Math.round(size.width * dpr) ||
                other.height !== Math.round(size.height * dpr)) {
                other.width = Math.round(size.width * dpr);
                other.height = Math.round(size.height * dpr);
            }
            const context = other.getContext('2d')!;
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            context.clearRect(0, 0, size.width, size.height);
            context.drawImage(surface, fit.left * dpr, fit.top * dpr, fit.width * dpr, fit.height * dpr, target.left, target.top, target.width, target.height);
        }
        setFrame((current) => (current === index ? current : index));
    }, [review, start, mode, selected, edited, pointGroup, reviewZoom, reviewPan]);
    useEffect(() => {
        if (!review)
            return;
        let raf = 0;
        const loop = () => {
            draw();
            raf = requestAnimationFrame(loop);
        };
        loop();
        return () => cancelAnimationFrame(raf);
    }, [review, draw]);
    function pointAt(o: Observation, id: PointId) {
        if (!video.current)
            return null;
        const [kind, n] = id.split(':'), j = Number(n);
        return kind === 'body' && o.normalized
            ? { x: o.normalized[j * 4], y: o.normalized[j * 4 + 1], score: o.normalized[j * 4 + 3] || 0 }
            : detailNormalized(o, j, video.current.videoWidth, video.current.videoHeight);
    }
    function editablePoints(o: Observation) {
        const ids: PointId[] = REVIEW_BODY.map((j) => `body:${j}` as PointId);
        ids.push(...[...Array(42)].map((_, j) => `detail:${91 + j}` as PointId));
        ids.push(...[17, 18, 19, 20, 21, 22].map((j) => `detail:${j}` as PointId));
        return ids.filter((id) => pointGroup === 'all' ||
            (pointGroup === 'hands'
                ? id.startsWith('detail:') && Number(id.split(':')[1]) >= 91
                : id.startsWith('body:') || Number(id.split(':')[1]) < 91));
    }
    function pointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
        if (running || e.button !== 0 || !review || !canvas.current)
            return;
        const rect = e.currentTarget.getBoundingClientRect(), fit = containedVideo(video.current!.videoWidth, video.current!.videoHeight, rect.width, rect.height), x = (e.clientX - rect.left - fit.left) / fit.width, y = (e.clientY - rect.top - fit.top) / fit.height;
        if (x < 0 || x > 1 || y < 0 || y > 1)
            return;
        let best: PointId | null = null, distance = 14;
        for (const id of editablePoints(review.observations[frame])) {
            const p = pointAt(review.observations[frame], id);
            if (!p)
                continue;
            const d = Math.hypot((p.x - x) * fit.width, (p.y - y) * fit.height);
            if (d < distance) {
                best = id;
                distance = d;
            }
        }
        if (!best)
            return;
        e.stopPropagation();
        rememberCorrection();
        setSelected(best);
        drag.current = { id: best, frame, x, y, original: copyObservation(review.observations[frame]) };
        e.currentTarget.setPointerCapture(e.pointerId);
        video.current?.pause();
    }
    function pointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
        if (!review || !drag.current || !canvas.current || !video.current)
            return;
        const rect = e.currentTarget.getBoundingClientRect();
        const fit = containedVideo(video.current.videoWidth, video.current.videoHeight, rect.width, rect.height);
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left - fit.left) / fit.width)), y = Math.max(0, Math.min(1, (e.clientY - rect.top - fit.top) / fit.height)), dx = x - drag.current.x, dy = y - drag.current.y;
        const next = [...review.observations], value = copyObservation(drag.current.original);
        applyDelta(value, drag.current.id, dx, dy, video.current.videoWidth, video.current.videoHeight);
        next[drag.current.frame] = value;
        setReview({ ...review, observations: next });
        setLastDelta({ id: drag.current.id, frame: drag.current.frame, dx, dy });
        setEdited((prev) => new Set(prev).add(`${drag.current!.frame}:${drag.current!.id}`));
    }
    function pointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
    }
    function propagate(direction: -1 | 1) {
        if (!review || !lastDelta || !video.current)
            return;
        const next = review.observations.map(copyObservation), changed: string[] = [];
        const [kind, number] = lastDelta.id.split(':');
        const anchorTime = review.observations[lastDelta.frame].time;
        for (let step = 1; step < next.length; step++) {
            const index = lastDelta.frame + step * direction;
            if (index < 0 || index >= next.length)
                break;
            const distance = Math.abs(next[index].time - anchorTime);
            if (distance >= range)
                break;
            if (next[index].corrected?.[kind as 'body' | 'detail'].includes(Number(number)))
                continue;
            const weight = (1 + Math.cos((Math.PI * distance) / range)) / 2;
            applyDelta(next[index], lastDelta.id, lastDelta.dx * weight, lastDelta.dy * weight, video.current.videoWidth, video.current.videoHeight);
            changed.push(`${index}:${lastDelta.id}`);
        }
        if (!changed.length)
            return;
        rememberCorrection();
        setEdited((prev) => new Set([...prev, ...changed]));
        setReview({ ...review, observations: next });
    }
    function jumpIssue() {
        if (!review || !issueFrames.length || !video.current)
            return;
        const next = issueFrames.find((i) => i > frame) ?? issueFrames[0];
        video.current.currentTime = start + review.observations[next].time;
        setFrame(next);
        video.current.pause();
    }
    function rememberCorrection() {
        if (!review)
            return;
        correctionHistory.current = [
            ...correctionHistory.current,
            { observations: review.observations, edited },
        ].slice(-40);
        setCanUndoCorrection(true);
    }
    function undoCorrection() {
        const previous = correctionHistory.current.pop();
        if (!previous || !review)
            return;
        setReview({ ...review, observations: previous.observations });
        setEdited(previous.edited);
        setLastDelta(null);
        setCanUndoCorrection(correctionHistory.current.length > 0);
    }
    function resetPoint() {
        if (!selected || !review)
            return;
        const base = originalReview.current[frame];
        if (!base)
            return;
        rememberCorrection();
        const [kind, text] = selected.split(':'), j = Number(text);
        const value = copyObservation(review.observations[frame]);
        const field = kind === 'body' ? 'body' : 'detail';
        value[field].splice(j * 4, 4, ...base[field].slice(j * 4, j * 4 + 4));
        if (field === 'body' && value.normalized && base.normalized)
            value.normalized.splice(j * 4, 4, ...base.normalized.slice(j * 4, j * 4 + 4));
        if (value.corrected)
            value.corrected[field] = value.corrected[field].filter((n) => n !== j);
        const next = [...review.observations];
        next[frame] = value;
        setReview({ ...review, observations: next });
        setEdited((prev) => {
            const next = new Set(prev);
            next.delete(`${frame}:${selected}`);
            return next;
        });
        setLastDelta(null);
    }
    function seekFrame(index: number) {
        if (!review || !video.current)
            return;
        const i = Math.max(0, Math.min(review.observations.length - 1, index));
        video.current.pause();
        video.current.currentTime = start + review.observations[i].time;
        setFrame(i);
    }
    async function process() {
        if (!file || !video.current)
            return;
        const abort = new AbortController();
        let prepared: Awaited<ReturnType<typeof prepareTrackingVideo>> | undefined;
        controller.current = abort;
        setRunning(true);
        phaseStarted.current = performance.now();
        setError('');
        setReview(null);
        setEdited(new Set());
        studio.set({ playing: false });
        const observations: Observation[] = [];
        const reconnecting = () => setProgress(t('Restoring the connection…'));
        try {
            const span = Math.min(duration, length - start, maxCaptureSeconds);
            if (span < 2)
                throw Error(t('Choose a segment of at least 2 seconds.'));
            setProgressValue(null);
            setProgress(t('Preparing your video…'));
            prepared = await prepareTrackingVideo(file, start, span, activeMode, abort.signal);
            const element = prepared.video;
            setProgress(t('Getting ready to follow your movement…'));
            if (!detector.current)
                detector.current = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('/mediapipe'), {
                    baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate: 'CPU' },
                    runningMode: 'VIDEO',
                    numPoses: 1,
                    minPoseDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                });
            const work = document.createElement('canvas');
            work.width = 288;
            work.height = 384;
            const ctx = work.getContext('2d', { willReadFrequently: true })!;
            const sampleFps = activeMode === 'pro' ? 24 : 15, lastTime = (Math.round(span * 30) - 1) / 30, count = Math.ceil(lastTime * sampleFps) + 1, clock = performance.now();
            let calibration: CameraCalibration | undefined;
            for (let i = 0; i < count; i++) {
                abort.signal.throwIfAborted();
                const time = Math.min(lastTime, i / sampleFps), seek = Math.min(element.duration - 0.02, time);
                if (Math.abs(element.currentTime - seek) > 0.001)
                    await new Promise<void>((resolve, reject) => {
                        const timer = setTimeout(() => done(Error(t('Could not decode the frame.'))), 10000), onSeek = () => done(), onAbort = () => done(new DOMException('Cancelled', 'AbortError'));
                        function done(failure?: Error) {
                            clearTimeout(timer);
                            element.removeEventListener('seeked', onSeek);
                            abort.signal.removeEventListener('abort', onAbort);
                            failure ? reject(failure) : resolve();
                        }
                        element.addEventListener('seeked', onSeek, { once: true });
                        abort.signal.addEventListener('abort', onAbort, { once: true });
                        element.currentTime = seek;
                    });
                const result = detector.current.detectForVideo(element, clock + time * 1000);
                const proFrame = activeMode === 'pro' ? jpegFrame(element, 1440) : null;
                if (proFrame && !calibration) {
                    setProgress(t('Finding the floor and your position…'));
                    calibration = await calibrateFrame(proFrame, abort.signal, reconnecting);
                }
                let normalized = result.landmarks[0], world = result.worldLandmarks[0];
                let fallbackSam: SamFrame | undefined;

                if ((!normalized || normalized.filter((p) => p.visibility > 0.4).length < 12) &&
                    proFrame &&
                    calibration) {
                    // Pro must not discard a frame just because the auxiliary 2D tracker lost it.
                    fallbackSam = await trackProFrame(proFrame, [0, 0, element.videoWidth, element.videoHeight], calibration, abort.signal, reconnecting);
                    ({ normalized, world } = samObservation(fallbackSam));
                }
                if (!normalized) {
                    setProgress(t('Checking a difficult moment…'));
                    setProgressValue(((i + 1) / count) * 100);
                    continue;
                }
                // Let Pro recover occluded poses from the full frame on the worker.
                const visible = normalized.filter((p) => p.visibility > 0.4);
                if ((visible.length < 12 || !world))
                    continue;
                const x0 = Math.min(...visible.map((p) => p.x)) * element.videoWidth, x1 = Math.max(...visible.map((p) => p.x)) * element.videoWidth;
                const y0 = Math.min(...visible.map((p) => p.y)) * element.videoHeight, y1 = Math.max(...visible.map((p) => p.y)) * element.videoHeight;
                let w = (x1 - x0) * 1.25, h = (y1 - y0) * 1.25;
                if (!Number.isFinite(w + h) || w < 2 || h < 2)
                    continue;
                if (w / h > 0.75)
                    h = w / 0.75;
                else
                    w = h * 0.75;
                const crop: [
                    number,
                    number,
                    number,
                    number
                ] = [
                    (x0 + x1) / 2 - w / 2,
                    (y0 + y1) / 2 - h / 2,
                    w,
                    h,
                ];
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, 288, 384);
                ctx.save();
                ctx.setTransform(288 / w, 0, 0, 384 / h, (-crop[0] * 288) / w, (-crop[1] * 384) / h);
                ctx.drawImage(element, 0, 0);
                ctx.restore();
                const rgba = ctx.getImageData(0, 0, 288, 384).data, rgb = new Uint8Array(288 * 384 * 3);
                for (let j = 0; j < 288 * 384; j++)
                    rgb.set(rgba.subarray(j * 4, j * 4 + 3), j * 3);
                setProgress(t('Following your body and hands…'));
                setProgressValue(((i + 1) / count) * 100);
                ;
                const [points, sam] = await Promise.all([
                    trackFrame(rgb, abort.signal, reconnecting),
                    fallbackSam
                        ? Promise.resolve(fallbackSam)
                        : proFrame && calibration
                            ? trackProFrame(proFrame, crop, calibration, abort.signal, reconnecting)
                            : Promise.resolve(undefined),
                ]);
                observations.push({
                    time,
                    aspectRatio: element.videoWidth / element.videoHeight,
                    body: world.flatMap((p, j) => [
                        p.x,
                        p.y,
                        p.z,
                        Math.min(p.visibility, normalized[j].visibility),
                    ]),
                    normalized: normalized.flatMap((p) => [p.x, p.y, p.z, p.visibility]),
                    detail: points,
                    crop: crop.map((n, j) => n *
                        (j % 2 === 0
                            ? video.current!.videoWidth / element.videoWidth
                            : video.current!.videoHeight / element.videoHeight)) as [
                        number,
                        number,
                        number,
                        number
                    ],
                    ...(sam ? { sam } : {}),
                    ...(calibration ? { calibration } : {}),
                });
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            abort.signal.throwIfAborted();
            ;
            if (observations.length < count * 0.6)
                throw Error(t('Insufficient tracking. Use one visible person and a fixed camera.'));
            originalReview.current = observations;
            correctionHistory.current = [];
            setCanUndoCorrection(false);
            setReview({
                observations,
                duration: span,
                reference: prepared.blob,
                captureMs: performance.now() - phaseStarted.current,
            });
            setProgress(t('Review your movement before continuing.'));
            if (video.current) {
                video.current.currentTime = start;
                video.current.pause();
            }
        }
        catch (e) {
            setError(abort.signal.aborted
                ? t('Capture cancelled.')
                : t(e instanceof Error ? e.message : String(e)));
        }
        finally {
            prepared?.dispose();
            setRunning(false);
            detector.current?.close();
            detector.current = null;
            controller.current = null;
        }
    }
    async function accept() {
        if (!review || !file)
            return;
        if (running)
            return;
        if (!checked?.capture)
            return;
        const abort = new AbortController(), targetProject = projectId;
        controller.current = abort;
        setRunning(true);
        phaseStarted.current = performance.now();
        setError('');
        try {
            setProgressValue(null);
            setProgress(t('Refining your movement…'));
            await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
            abort.signal.throwIfAborted();
            const capture = checked.capture;
            const room = (count: number) => {
                const tl = useStudio.getState().project.timeline!;
                if (tl.assets.length + count > 32 ||
                    tl.strips.length + count > 64 ||
                    tl.tracks.length + count > 64)
                    throw Error(t('Make room for a Body layer and a Hands layer before generating.'));
            };
            room(2);
            setGenerating(true);
            setProgressValue(null);
            setProgress(t('Creating your emote…'));
            video.current?.pause();
            const rootMotion = 'source' as const;
            const motion = await generateFromVideo(capture, rootMotion, abort.signal, review.reference);
            const videoResult = {
                generationId: motion.generationId!,
                referenceAvailable: true,
                processing: motion.generation?.video?.processing || {
                    captureMs: review.captureMs,
                    generationMs: performance.now() - phaseStarted.current,
                    totalMs: review.captureMs + performance.now() - phaseStarted.current,
                },
            };
            capture.generationId = motion.generationId;
            if (currentProjectId.current !== targetProject)
                throw Error(t('The active project changed. Review the video again in the intended project.'));
            room(2);
            studio.change({
                motion,
                videoResult,
                smoothing: 0,
                preset: 'motion',
                workflow: 'video',
                rootMotion,
                duration: motion.frames / 30,
                keyframes: [],
                handMode: 'none',
                handReference: null,
                controls: { ...structuredClone(defaults), handIK: true, ground: false },
            });
            studio.addHands({ handMode: 'reference', handReference: capture });
            studio.set({ time: 0, playing: true, message: t('Animation added to timeline.') });
            setReview(null);
            setProgress('');
            setOpen(false);
            setUrl('');
            setFile(null);
            setSelected(null);
            originalReview.current = [];
            correctionHistory.current = [];
        }
        catch (e) {
            setError(abort.signal.aborted
                ? t('Generation cancelled. Your tracking is ready to retry.')
                : String(e));
            setProgress(t('Review your movement before continuing.'));
        }
        finally {
            setRunning(false);
            setGenerating(false);
            controller.current = null;
        }
    }
    function changeStart(value: number) {
        const next = Math.max(0, Math.min(Math.max(0, length - 2), value));
        setStart(next);
        setDuration(Math.min(duration, length - next));
        if (video.current)
            video.current.currentTime = next;
    }
    function close() {
        if (running)
            return;
        video.current?.pause();
        setOpen(false);
    }
    return (<section className="video-panel">
      <label className="capture-engine-field">
        <span>{t('Capture engine')}</span>
        <select aria-label={t('Capture engine')} value={mode} disabled={running || !!review} onChange={(e) => setMode(e.target.value as CaptureMode)}>
          <option value="fast">Fast</option>
          <option value="pro" disabled={!proAvailable}>
            Pro
          </option>
        </select>
      </label>
      <p className="small subtle">
        {t(mode === 'pro'
            ? 'More detail for complex movements.'
            : 'A quicker way to capture simple movements.')}
      </p>
      {!proAvailable && (<p className="small subtle">{t('Pro is not available on this device yet.')}</p>)}
      <input ref={input} type="file" accept="video/*" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
                setFile(f);
                setUrl(URL.createObjectURL(f));
                setStart(0);
                setLength(0);
                setDuration(3);
                setReview(null);
                changeZoom(1);
                setSelected(null);
                setError('');
                setProgress('');
                setOverlay(true);
                setOpen(true);
            }
            e.target.value = '';
        }}/>
      <Button primary fluid disabled={running} onClick={() => input.current?.click()}>
        {t('Select video')}
      </Button>
      {file && (<Button basic fluid onClick={() => setOpen(true)}>
          {t('Review video')}
        </Button>)}
      <p className="small subtle">
        {t('Choose a clip, review the movement, then create your emote.')}
      </p>
      <VideoResultPanel />
      <Modal size="large" open={open} onClose={close}>
        <Modal.Header>{t(review ? 'Review movement' : 'Prepare your video')}</Modal.Header>
        <Modal.Content>
          <div className="video-capture-dialog" aria-busy={running}>
            {url && length === 0 && !error && (<div className="capture-progress" role="status">
                <span>{t('Opening your video…')}</span>
                <LinearProgress aria-label={t('Opening your video…')}/>
              </div>)}
            {running && (<div className="capture-progress" role="status">
                <span>{progress}</span>
                <time aria-label={t('Elapsed time')}>{elapsedLabel(elapsed)}</time>
                <LinearProgress aria-label={progress} variant={progressValue === null ? 'indeterminate' : 'determinate'} value={progressValue ?? undefined}/>
                {progressValue !== null && <small>{Math.round(progressValue)}%</small>}
              </div>)}
            {error && (<p role="alert" className="tracking-error">
                {error}
              </p>)}
            {review &&
            !running &&
            (!checked ? (<p role="status">{t('Checking tracking before generation…')}</p>) : checked.error ? (<div role="alert" className="tracking-error">
                  <p>{t(checked.error)}</p>
                  <p>{t('Correct the tracking or trim the clip before generating.')}</p>
                  {checked.issue && (<Button basic onClick={() => {
                        const issue = checked.issue!;
                        const time = issue.frame / 30;
                        const nearest = review.observations.reduce((best, observation, i) => Math.abs(observation.time - time) <
                            Math.abs(review.observations[best].time - time)
                            ? i
                            : best, 0);
                        seekFrame(nearest);
                        if (issue.joints.length)
                            setSelected(`body:${issue.joints[0]}`);
                    }}>
                      {t('Show tracking issue')}
                    </Button>)}
                </div>) : null)}
            <div className={'capture-panes ' + (review ? 'has-tracking' : '')}>
              <div className="capture-pane">
                <div className="capture-pane-title">
                  <strong>{t('Video')}</strong>
                  {review && (<small className="review-mouse-hint">
                      {Math.round(reviewZoom * 100)}% ·{' '}
                      {t('Scroll to zoom · Drag background to move · Double-click to reset')}
                    </small>)}
                  {review && (<label className="check">
                      <input type="checkbox" checked={overlay} disabled={running} onChange={(e) => setOverlay(e.target.checked)}/>
                      {t('Show points')}
                    </label>)}
                </div>
                <div ref={zoomStage} className={'tracking-video capture-stage ' + (reviewZoom > 1 ? 'is-panning' : '')} onDoubleClick={() => changeZoom(1)} onPointerDown={(e) => {
            if (reviewZoom <= 1 || !review || running || drag.current)
                return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            panDrag.current = { x: e.clientX, y: e.clientY, origin: reviewPan };
            video.current?.pause();
        }} onPointerMove={(e) => {
            if (!panDrag.current)
                return;
            const rect = e.currentTarget.getBoundingClientRect(), d = panDrag.current;
            setReviewPan({
                x: Math.max((-rect.width * (reviewZoom - 1)) / 2, Math.min((rect.width * (reviewZoom - 1)) / 2, d.origin.x + e.clientX - d.x)),
                y: Math.max((-rect.height * (reviewZoom - 1)) / 2, Math.min((rect.height * (reviewZoom - 1)) / 2, d.origin.y + e.clientY - d.y)),
            });
        }} onPointerUp={(e) => {
            panDrag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
        }} onPointerCancel={() => {
            panDrag.current = null;
        }}>
                  <div className="review-zoom-surface" style={{
            transform: review
                ? 'translate(' +
                    reviewPan.x +
                    'px,' +
                    reviewPan.y +
                    'px) scale(' +
                    reviewZoom +
                    ')'
                : undefined,
        }}>
                    {url && (<video ref={video} src={url} muted playsInline controls={!review} preload="auto" onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} onError={() => setError(t('Could not open this video. Try another file.'))} aria-label={t('Reference video')} onLoadedMetadata={(e) => {
                const value = e.currentTarget.duration;
                if (Number.isFinite(value)) {
                    setLength(value);
                    setDuration((current) => Math.min(current, value));
                }
            }} onTimeUpdate={(e) => {
                const end = start + (review?.duration ?? duration);
                if (e.currentTarget.currentTime >= end + 0.02) {
                    e.currentTarget.pause();
                    e.currentTarget.currentTime = review
                        ? start + review.observations.at(-1)!.time
                        : start;
                }
                else if (e.currentTarget.currentTime < start - 0.02)
                    e.currentTarget.currentTime = start;
            }}/>)}
                    {review && (<canvas ref={canvas} aria-label={t('Editable tracking overlay')} style={{
                visibility: overlay ? 'visible' : 'hidden',
                pointerEvents: overlay && !running ? 'auto' : 'none',
            }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}/>)}
                  </div>
                </div>
              </div>
              {review && (<div className="capture-pane">
                  <div className="capture-pane-title">
                    <strong>{t('Captured movement')}</strong>
                    <small>{(review.observations[frame]?.time ?? 0).toFixed(2)}s</small>
                  </div>
                  <div className="capture-stage capture-data">
                    <canvas ref={captureCanvas} aria-label={t('Editable captured movement')} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}/>
                  </div>
                </div>)}
            </div>
            {file && !review && (<fieldset className="video-trim" disabled={running}>
                <div className="video-trim-heading">
                  <strong>{t('Choose the part to use')}</strong>
                  <span>
                    {start.toFixed(1)}s – {(start + duration).toFixed(1)}s
                  </span>
                </div>
                <div className="trim-strip" style={{
                '--trim-start': (length ? (start / length) * 100 : 0) + '%',
                '--trim-end': (length ? ((start + duration) / length) * 100 : 100) + '%',
            } as React.CSSProperties}>
                  <i />
                </div>
                <div className="trim-fields">
                  <label>
                    {t('Start')}
                    <input aria-label={t('Video start')} type="number" min={0} max={Math.max(0, length - 2)} step={0.1} value={start} onChange={(e) => changeStart(Number(e.target.value))}/>
                  </label>
                  <input aria-label={t('Trim start')} type="range" min={0} max={Math.max(0, length - 2)} step={1 / 30} value={start} onChange={(e) => changeStart(Number(e.target.value))}/>
                  <label>
                    {t('Duration')}
                    <input aria-label={t('Capture duration')} type="number" min={2} max={Math.min(maxCaptureSeconds, length - start)} step={0.1} value={duration} onChange={(e) => setDuration(Math.max(2, Math.min(maxCaptureSeconds, length - start, Number(e.target.value))))}/>
                  </label>
                  <input aria-label={t('Trim end')} type="range" min={Math.min(length, start + 2)} max={Math.min(length, start + maxCaptureSeconds)} step={1 / 30} value={start + duration} onChange={(e) => setDuration(Number(e.target.value) - start)}/>
                </div>
                <p className="small subtle">
                  {t('Use 2–10 seconds with one person fully visible.')}
                </p>
              </fieldset>)}
            {review && (<fieldset className="tracking-review" disabled={running} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <div className="review-player" aria-label={t('Review playback')}>
                  <button type="button" aria-label={t('Go to start')} title={t('Go to start')} onClick={() => seekFrame(0)}>
                    <FirstPageIcon />
                  </button>
                  <button type="button" aria-label={t('Previous frame')} title={t('Previous frame')} onClick={() => seekFrame(frame - 1)}>
                    <SkipPreviousIcon />
                  </button>
                  <button type="button" aria-label={t(videoPlaying ? 'Pause video' : 'Play video')} title={t(videoPlaying ? 'Pause video' : 'Play video')} onClick={() => {
                const element = video.current;
                if (!element)
                    return;
                if (videoPlaying)
                    element.pause();
                else {
                    if (element.currentTime >= start + review.observations.at(-1)!.time - 0.01)
                        element.currentTime = start;
                    void element.play().catch(() => { });
                }
            }}>
                    {videoPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                  </button>
                  <button type="button" aria-label={t('Next frame')} title={t('Next frame')} onClick={() => seekFrame(frame + 1)}>
                    <SkipNextIcon />
                  </button>
                  <button type="button" aria-label={t('Go to end')} title={t('Go to end')} onClick={() => seekFrame(review.observations.length - 1)}>
                    <LastPageIcon />
                  </button>
                  <time>
                    {(review.observations[frame]?.time || 0).toFixed(2)} /{' '}
                    {review.duration.toFixed(2)}s
                  </time>
                  <label>
                    {t('Speed')}{' '}
                    <select aria-label={t('Review speed')} defaultValue={1} onChange={(e) => {
                if (video.current)
                    video.current.playbackRate = Number(e.target.value);
            }}>
                      <option value={0.5}>0.5×</option>
                      <option value={1}>1×</option>
                      <option value={2}>2×</option>
                    </select>
                  </label>
                  <small>
                    {t('Capture')} {elapsedLabel(review.captureMs)}
                  </small>
                </div>
                <div className="review-heading">
                  <strong>{t('Review tracking')}</strong>
                  <span>
                    {frame + 1}/{review.observations.length}
                  </span>
                </div>
                <input className="review-scrubber" aria-label={t('Tracking frame')} type="range" min={0} max={review.observations.length - 1} value={frame} onChange={(e) => {
                const i = Number(e.target.value);
                setFrame(i);
                if (video.current) {
                    video.current.pause();
                    video.current.currentTime = start + review.observations[i].time;
                }
            }}/>
                <div className="confidence-strip">
                  {review.observations.map((_, i) => (<i key={i} className={issueFrames.includes(i) ? 'issue' : ''}/>))}
                </div>
                <div className="tracking-legend">
                  <span className="good">● {t('Reliable')}</span>
                  <span className="warning">● {t('Review')}</span>
                  <span className="bad">● {t('Low confidence')}</span>
                  <span className="manual">● {t('Manual')}</span>
                </div>
                <p className="small subtle">
                  {selected
                ? t('Drag a point in either view to correct the movement.')
                : t('Select and drag any tracking point to correct it.')}
                </p>
                <div className="correction-tools">
                  <label>
                    {t('Show')}{' '}
                    <select aria-label={t('Edit points')} value={pointGroup} onChange={(e) => {
                setPointGroup(e.target.value as typeof pointGroup);
                setSelected(null);
            }}>
                      <option value="all">{t('Body and hands')}</option>
                      <option value="body">{t('Body')}</option>
                      <option value="hands">{t('Hands')}</option>
                    </select>
                  </label>
                  <button type="button" aria-label={t('Undo correction')} title={t('Undo correction')} disabled={!canUndoCorrection} onClick={undoCorrection}>
                    <UndoIcon />
                  </button>
                  <button type="button" aria-label={t('Reset point')} title={t('Reset point')} disabled={!selected || !edited.has(`${frame}:${selected}`)} onClick={resetPoint}>
                    <RestartAltIcon />
                  </button>
                  <details className="nearby-correction">
                    <summary>{t('Apply to nearby frames')}</summary>
                    <div>
                      <label>
                        {t('Apply correction nearby')}{' '}
                        <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
                          <option value={0.5}>0.5 s</option>
                          <option value={1}>1 s</option>
                          <option value={2}>2 s</option>
                        </select>
                      </label>
                      <Button basic disabled={!lastDelta} onClick={() => propagate(-1)}>
                        ← {t('Backward')}
                      </Button>
                      <Button basic disabled={!lastDelta} onClick={() => propagate(1)}>
                        {t('Forward')} →
                      </Button>
                    </div>
                  </details>
                </div>
                {issueFrames.length > 0 && (<Button basic onClick={jumpIssue}>
                    {t('Review next issue')}
                  </Button>)}
              </fieldset>)}

            {!available && (<p role="status" className="small subtle">
                {t('Getting capture ready…')}
              </p>)}
          </div>
        </Modal.Content>
        <Modal.Actions>
          {running ? (<Button basic onClick={() => controller.current?.abort()}>
              {t(generating ? 'Cancel generation' : 'Cancel capture')}
            </Button>) : (<>
              <Button basic onClick={close}>
                {t('Close')}
              </Button>
              {review ? (<>
                  <Button basic onClick={() => {
                    setReview(null);
                    setSelected(null);
                    setProgress('');
                }}>
                    {t('Edit clip')}
                  </Button>
                  <Button primary disabled={!checked?.capture} onClick={accept}>
                    {t('Accept and generate')}
                  </Button>
                </>) : (<Button primary disabled={!available || length < 2 || duration < 2 || !!studio.preview} onClick={process}>
                  {t('Analyze tracking')}
                </Button>)}
            </>)}
        </Modal.Actions>
      </Modal>
    </section>);
}

