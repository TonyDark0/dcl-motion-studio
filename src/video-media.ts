export async function prepareTrackingVideo(file: File, start: number, duration: number, mode: 'fast' | 'pro', signal: AbortSignal) {
    const query = new URLSearchParams({ start: String(start), duration: String(duration), mode });
    let response: Response;
    response = await fetch(`/api/media/prepare?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
        signal,
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw Error(error.error || `Could not prepare the video (${response.status}).`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob), video = document.createElement('video');
    const dispose = () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
    };
    video.muted = true;
    video.preload = 'auto';
    try {
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => done(Error('Could not open the prepared video.')), 15000);
            const abort = () => done(new DOMException('Cancelled', 'AbortError'));
            function done(error?: Error) {
                clearTimeout(timeout);
                signal.removeEventListener('abort', abort);
                video.onloadeddata = null;
                video.onerror = null;
                error ? reject(error) : resolve();
            }
            video.onloadeddata = () => done();
            video.onerror = () => done(Error('Could not decode the prepared video.'));
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) {
                abort();
                return;
            }
            video.src = url;
        });
        return { video, blob, dispose };
    }
    catch (error) {
        dispose();
        throw error;
    }
}
