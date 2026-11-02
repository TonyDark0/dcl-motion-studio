import { z } from 'zod';
// Configure before constructing schemas. The demo CSP permits WASM but not JS eval.
if (import.meta.env.VITE_STUDIO_CLOUD === 'true') z.config({ jitless: true });
