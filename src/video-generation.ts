import { motionSchema } from './motion';
import type { Capture } from './video-motion';
import { videoPoseConstraints } from './video-pose-constraints';
async function request(url: string, options?: RequestInit) {
    ;
    ;
    ;
    const response = await fetch('/api' + url, options);
    const text = await response.text();
    if (!text.trim())
        throw Error(`Generation service returned an empty response (HTTP ${response.status}).`);
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        throw Error(`Generation service returned an invalid response (HTTP ${response.status}).`);
    }
    if (!response.ok)
        throw Error(value.error || `Generation failed (HTTP ${response.status}).`);
    return value;
}
function pause(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const done = () => {
            signal.removeEventListener('abort', abort);
            resolve();
        };
        const timer = setTimeout(done, 1000);
        const abort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            reject(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted)
            abort();
    });
}
/** One constrained Kimodo pass. Keep the reviewed capture available when it fails. */
export async function generateFromVideo(capture: Capture, rootMotion: 'source' | 'inPlace', signal: AbortSignal, reference?: Blob) {
    signal.throwIfAborted();
    // Same full constraints check as the worker, before uploads or any paid submission.
    videoPoseConstraints(capture, capture.frames, rootMotion !== 'source');
    let id: string | undefined;
    try {
        // Do not abort this POST: first receive its ID so cancellation can stop the owned job.
        const job = await request('/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: 'A person performs a continuous movement following the reference body poses and their timing.',
                duration: capture.frames / capture.fps,
                seed: crypto.getRandomValues(new Uint32Array(1))[0] >>> 1,
                steps: 30,
                rootMotion,
                videoReference: capture,
            }),
        });
        id = job.id;
        for (;;) {
            signal.throwIfAborted();
            const status = await request('/jobs/' + id, { signal });
            if (status.status === 'completed') {
                const motion = motionSchema.parse(await request('/jobs/' + id + '/motion', { signal }));
                motion.generationId = id;
                if (motion.skeleton !== 'soma30' || motion.frames !== capture.frames)
                    throw Error('Kimodo returned an incompatible video animation.');
                // Use a readable strip name; provenance remains in the generation metadata.
                motion.prompt = capture.metadata.file.replace(/\.[^.]+$/, '') || 'Video emote';
                if (reference) {
                    await request('/jobs/' + id + '/reference-video', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: reference,
                        signal,
                    });
                    if (motion.generation?.video)
                        motion.generation.video.referenceAvailable = true;
                }
                signal.throwIfAborted();
                return motion;
            }
            if (status.status !== 'running')
                throw Error(status.error || 'Generation cancelled.');
            await pause(signal);
        }
    }
    catch (error) {
        if (signal.aborted && id) {
            // No JSON content type on an empty cancellation request.
            await request('/jobs/' + id + '/cancel', { method: 'POST' }).catch(() => { });
        }
        throw error;
    }
}
